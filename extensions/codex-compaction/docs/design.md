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

`live.test.ts` keeps those claims honest and skips when codex auth is absent.

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

**The beta flag is undocumented.** `remote_compaction_v2` does not appear in
codex's source — codex takes `beta_features_header` from config — so it was
discovered empirically. It is a server-side gate that can be renamed or withdrawn
without warning, and when that happens this extension silently returns to text
summaries. That is the intended failure, but it means the live tests are the only
thing that will notice.

**Retention is not implemented.** Codex additionally keeps recent
`user`/`developer`/`system` messages beside the artifact, truncated to
`RETAINED_MESSAGE_TOKEN_BUDGET = 64_000` (`compact_remote_v2.rs:56`). Here pi
chooses what to keep via `firstKeptEntryId`, so retention is pi's decision and
the artifact simply replaces the summary. Worth revisiting if recall at the
boundary disappoints.

**Cost is not free.** Compaction now makes two model calls instead of one. On the
published benchmark for the extension this was modelled on, the server-side path
scored 78% exact recall against pi's 48% — but spent 4.58× the compaction output
tokens and 2.52× the cost, with a 0.95 correlation between artifact size and
accuracy. Read that as "it wins partly by spending more," not purely as a better
representation.
