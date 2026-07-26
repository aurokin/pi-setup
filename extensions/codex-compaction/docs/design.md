# Codex server-side compaction

Pi compacts by asking an LLM to write a text summary of old turns. OpenAI's
Responses service can instead return an **opaque artifact** that only it can
read, and replaying that artifact restores the compacted context far more
faithfully than prose does. Codex uses this; pi does not.

This extension adds it for `openai-codex/*` models.

## The protocol

There is no compaction endpoint. A compaction request is an ordinary streaming
Responses request with three differences:

1. `input` ends with `{"type": "compaction_trigger"}`
2. the request carries `x-codex-beta-features: remote_compaction_v2`
3. the stream returns **exactly one** output item of
   `{"type": "compaction", "encrypted_content": "..."}`, then `response.completed`

Replaying that item as an input restores the context.

Source: codex `codex-rs/core/src/compact_remote_v2.rs` and
`protocol/src/models.rs`. The trigger's wire name is pinned by codex's own serde
test, `serializes_compaction_trigger_without_payload`.

### Verified, not assumed

Measured against the live service before any of this was written:

| Check | Result |
| --- | --- |
| Compaction request | HTTP 200, one `compaction` item, 1,164–1,508 bytes |
| Replay recall | 6/6 facts from a 1,508-byte artifact |
| Control, no artifact | 0/6 — "I don't have access to any earlier conversation" |
| Replay cost | 192 input tokens standing in for six messages |

`e2e/codex-compaction.test.ts` keeps those claims honest and skips when codex
auth is absent. It lives outside `npm test` because it costs money and fails for
reasons that have nothing to do with this repo.

## Why the payload is snapshotted, not rebuilt

The compaction request needs the session's exact model, instructions, tools, and
reasoning config. Rebuilding those would be a second source of truth that drifts
from pi's on every pi release.

Instead `before_provider_request` snapshots pi's own outgoing payload, and the
compaction request is that payload with the trigger appended. Verified live: the
hook fires for this provider carrying `model`, `store`, `stream`, `instructions`,
`input`, `include`, `prompt_cache_key`, `tool_choice`, `parallel_tool_calls`,
`tools`, and `reasoning` — everything needed.

This is the main reason this extension is a fraction of the size of the one it
was modelled on.

## Why the swap is marker-based

After compaction, pi rebuilds context as `[compactionSummary, ...kept]` and the
provider layer turns that summary into some input item. That mapping is pi's
private business.

Rather than reproduce it, the summary text is tagged with `⟦codex-compaction:id⟧`
and `before_provider_request` replaces whichever input item carries the marker.
That survives pi changing where the summary lands, and degrades to changing
nothing when the marker is absent.

## Both representations are kept

The portable text summary is still generated and stored, alongside the artifact.
The two run concurrently so compaction is not twice as slow.

The artifact is an optimisation for compatible turns. The summary is what keeps
the session readable, forkable, and usable after switching to a non-codex model —
and the artifact is refused across models, because it is opaque and
server-decrypted, so replaying one model's artifact into another is silent
context corruption rather than an error.

## Three ways this can substitute the wrong artifact

Each of these swaps a good text summary for context that is wrong rather than
merely worse, so each is guarded explicitly.

**A different backend or account.** `before_provider_request` fires for *every*
provider, so the provider guard lives inside the handler rather than around it.
Artifacts are keyed by `provider/model#account`, because two providers can
expose the same model id and the artifact is opaque ciphertext bound to one
ChatGPT account. Reopening a compacted session after switching accounts must
fall back to the text summary rather than replay something undecryptable.

The account is stored as a truncated SHA-256 digest, not the id. This key is
persisted into the session file, and `/share` uploads that file as a gist — a
digest distinguishes accounts without publishing one.

**Content that quotes a marker.** A marker only counts when it opens a line, and
tool traffic is skipped entirely. Otherwise asking "what does ⟦codex-compaction:…⟧
mean?" — or a tool returning session-file contents — would have that whole item
replaced by the artifact, losing the question or the tool result. Each artifact
also replaces at most one item, so a recurring marker cannot send it twice.

**A different branch.** A snapshot describes one branch of one conversation.
After a reload, resume, or `/tree` move, compacting before the next provider
request would send the *previous* branch's messages for compaction and then
substitute the result for this branch's summary — cross-branch corruption, and a
path for one branch's content to reach another's context. Every navigation
boundary clears the snapshot; artifacts survive, because the compaction entries
referencing them do.

**A snapshot that is behind.** A snapshot is a *request*, so it predates the
response to it. When the cut point falls after that response — a large final
turn that will not fit in the retained tail — the text summary covers it and an
artifact built from the snapshot does not. Replacing the summary with that
artifact would silently drop the newest turn from all future context. Compaction
compares the snapshot's capture time against the messages being summarized and
skips the artifact when anything is newer.

## Failure is always soft

Every failure path falls back to pi's normal compaction: no credentials, expired
token, provider auth unavailable, revoked beta flag, malformed stream, more than
one artifact. A worse summary is acceptable; a failed compaction on an
overflowing context is not.

The one case that steps aside entirely is a failed *summary*, since without a
portable summary there is nothing safe to return.

## Credentials

The request needs the same bearer token pi uses. Pi does not hand it to
extensions — `before_provider_headers` fires with an empty header map on this
provider — so `src/auth.ts` reads the `openai-codex` entry from pi's `auth.json`,
honouring `PI_CODING_AGENT_DIR`.

The token is read per request and never logged, cached to disk, or put on a
command line. `accountId` is stored by pi directly, so no JWT decoding is needed.

## Known risks

### The beta flag is undocumented, and its failure is invisible

`remote_compaction_v2` does not appear in codex's source — codex takes
`beta_features_header` from config — so it was discovered empirically. It is a
server-side gate that OpenAI can rename or withdraw without warning or notice.

The failure mode is the problem. Everything here fails soft on purpose, so a
withdrawn flag does not break anything: compaction just goes back to text
summaries. Nothing errors, nothing appears in the UI, and the only symptom is
recall quietly getting worse. **This extension can stop working entirely and
look exactly like it is working.**

`e2e/codex-compaction.test.ts` is the canary, and it is the *only* one:

```
npm run test:e2e     # skips silently without codex auth
```

Because the thing being watched changes on OpenAI's schedule and not on ours,
running it only when this code changes is the wrong trigger — a green suite
after an untouched month says nothing. Run it periodically, and specifically
before trusting recall on a long session. If it starts skipping rather than
passing, that is codex auth missing, not the flag holding.

When it does fail: check whether a current codex release still sends
`compaction_trigger` and what feature name it gates on, then update
`REMOTE_COMPACTION_FEATURE`. If the protocol is gone rather than renamed, this
extension has nothing left to do and should be removed rather than left in place
looking active.

**Retention is not implemented.** Codex additionally keeps recent
`user`/`developer`/`system` messages beside the artifact, truncated to
`RETAINED_MESSAGE_TOKEN_BUDGET = 64_000` (`compact_remote_v2.rs:56`). Here pi
chooses what to keep via `firstKeptEntryId`, so retention is pi's decision and
the artifact simply replaces the summary. Worth revisiting if recall at the
boundary disappoints.

### Cost is not free, and the obvious lever is coupled

Compaction now makes two model calls instead of one. On the published benchmark
for the extension this was modelled on, the server-side path scored 78% exact
recall against pi's 48% — but spent 4.58× the compaction output tokens and 2.52×
the cost, with a 0.95 correlation between artifact size and accuracy. Read that
as "it wins partly by spending more," not purely as a better representation.

The lever is `compaction.reserveTokens`, and reading pi's source rather than
inferring from the benchmark, it does **two** things
(`core/compaction/compaction.js`):

| | |
| --- | --- |
| `shouldCompact` | compacts once context passes `contextWindow - reserveTokens` |
| `generateSummaryWithUsage` | caps the summary at `0.8 * reserveTokens` |

So raising it buys a longer summary *and* compacts earlier — more head-room per
compaction, but more compactions. Lowering it does the reverse. There is no
setting that lengthens the summary alone, and none at all that sizes the
artifact: the artifact's size is the server's decision, which is why the
correlation the benchmark found is not something either side can tune.

This extension resolves `reserveTokens` through `SettingsManager` rather than
`DEFAULT_COMPACTION_SETTINGS`, so the lever still moves the summary once the
extension is installed. Hardcoding the default was the earlier behaviour and
made the setting silently inert on exactly the path that replaced pi's.

Honest summary of the options, since only one of them is real:

- **Turn the extension off** for a session where recall does not matter. Nothing
  here is load-bearing; pi compacts normally without it.
- **Tune `reserveTokens`** knowing it is a trade, not a win.
- Skipping the text summary to save the second call is *not* on offer. The
  summary is what makes a session readable, forkable, and usable on a non-codex
  model, and it is the fallback for every soft failure above.
