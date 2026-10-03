# Prompt inspector

Use the prompt inspector to review the context Pi sends to a model and compare
agent prompts where their context differs.

```sh
pnpm prompt                  # writes ./prompt-report.html for "Hello"
pnpm prompt -- --open        # also opens the prompt report
pnpm prompt -- "review this" --out=/tmp/prompt-report.html
```

## Terminology

- **Prompt inspector** is the tool in `tools/prompt-inspector/`.
- **Prompt review** is the human activity and the page used for it.
- **Prompt report** is the generated, self-contained HTML file.
- **Prompt capture** is the raw provider request.

## What is captured

The parent Pi request is a **Captured request**, observed at a provider boundary.
The inspector runs Pi with its normal configuration, extensions, skills and
context files. A loopback provider receives the request for the `probe` model
and returns a canned completion. The capture model never contacts a model
service or spends tokens. `--no-session` keeps the probe out of the session list.

The report includes the complete captured JSON, instructions by section, tool
schemas, skill catalogue and ordered messages. The JSON is formatted for reading;
its fields are preserved. The message reading view flattens text blocks, so use
the raw payload for non-text content, tool calls and transport metadata.

This is the request for this probe, working directory and installed configuration.
A different model, transport or resumed conversation can produce a different
request. It is not a capture of your currently running Pi conversation.

## What is assembled

Pi child previews are **Assembled prompts**, composed from production files and
functions but not captured at a provider boundary. They use the child backend's
resource loader, the parent's captured working directory and project trust,
in-memory SDK sessions, startup hooks, and `before_agent_start` handlers. No child
model turn is started. The inspector applies the production child policy and tool
restrictions and reads the SDK's active tool schemas.

The report names each contribution and its source. Instruction contributions keep
their original order, followed by inherited history when shown, role framing,
the child response contract and task. Extra startup messages follow the task.
Tool schemas are a separate field, shown last. This is a reading order, not a
claim that the provider concatenates tools after messages.

Agent-policy sections are attributed by matching production `PI_PROFILE`
content. Pi's
`<project_context>` and `<available_skills>` blocks retain their boundaries.
A context file can contain both agent-policy and project instructions; the inspector
does not invent attribution for its contents. Other instruction text retains its
headings under "Harness system prompt / other instructions".

The extension-owned initial message comes from `buildRolePrompt` and its ordered
contributions in `extensions/shared/roles.ts`. No prompt text is copied into the
inspector.

## Which variants are shown

Pi previews cover the four public roles and the internal `side` role:

| Variant | Child policy | Tools | History |
| --- | --- | --- | --- |
| reader, advisor, rubber-duck | Removes delegation, second opinions, communication standards and Pi workspace guidance | Production read-only exclusions | Fresh child |
| worker | Same filtering, but keeps Pi workspace guidance | Production worker exclusions | Fresh child |
| side, used by `/btw` | No child policy filtering | No role tool exclusions | Inheritance example using the parent capture's messages |

Each role retains its own framing. The example task is the input to this review,
not an observed subagent assignment. The inherited example is not a live fork.
History-dependent hooks run against an empty in-memory session during assembly;
the report says so. Matching a `/btw` child's reloaded resources to the parent's
exact system prompt and tools is not verified.

The shared initial message is also shown once per role as **Extension message
only**, meaning only the message owned by pi-setup. Pi, Claude Code, Codex, Droid
and Cursor use the same production message. Their native tool restrictions are
listed separately where known. The internal `side` role is supported by the
backend composition code, but `/btw` currently uses Pi only.

Equal resolved content is grouped with its variant dimensions. For a partial
message, equivalence covers that message alone. It does not imply that the full
Claude Code, Codex, Droid, Cursor or Pi prompts are identical. Assembled variants
with different tool restrictions remain separate.

If a Pi preview fails to assemble, the report names the failure and still shows
the parent capture and shared extension messages.

## Outside the report

- External harness system prompts, global instructions, project context, skills,
  tool schemas and provider requests are not captured or reconstructed. Droid's
  final tool exclusions require its live registry; those IDs are not guessed.
- Pi child input/context hooks, pending messages, compaction, other provider
  hooks and provider-specific serialization are outside the assembled previews.
  Startup and `before_agent_start` contributions are included. Resources are
  loaded again after the parent capture and may have changed.
- A live parent's inherited conversation is not available to `pnpm prompt`.
- Skill bodies are read on demand. The report supplements the captured catalogue
  with readable bodies for repo-owned and extension-generated skills. Those
  supplemental bodies are not claimed to be part of the captured turn. Other
  skills show their catalogue entry only.
- Workflow children, the compaction summarizer and goal verification do not yet
  have their own prompt previews.

## Implementation

| File | Responsibility |
| --- | --- |
| `capture.ts` | Loopback provider and separate workspace/trust metadata |
| `inspect.ts` | Run the parent capture, assemble previews, read skill bodies, write the report |
| `assemble.ts` | Load production Pi child resources and compose previews without model turns |
| `surfaces.ts` | Serializable prompt surfaces, ordered contributions, fidelity and grouping |
| `payload.ts` | Interpret captured messages, schemas and skill catalogues |
| `render.ts` | Pure HTML renderer |
| `skill-bodies.ts` | Resolve supplemental skill bodies by real-path ownership |

Additional prompt surfaces can supply an ID, title, fidelity, variant dimensions,
ordered contributions and limits through `CaptureMeta.surfaces`. The renderer does
not need to know how a workflow child or summarizer composes its prompt.

The runner deletes its temporary capture after reading it. To retain a raw
capture for later rendering:

```sh
PROMPT_INSPECTOR_OUT=/tmp/payload.json pi --print --no-session \
  --extension tools/prompt-inspector/capture.ts \
  --model prompt-inspector/probe Hello
```

Token counts use `characters ÷ 4`. They support comparisons, not billing or exact
context-window accounting. Totals cover the parent capture only; previews and
supplemental skill bodies are not added to them.

## Privacy

The prompt report and any saved prompt capture contain private context: paths,
`AGENTS.md`, other instruction files, tool descriptions, skills and any included
conversation text. The default report is written in the working directory.
Inspect it before sharing or committing it, and delete it when no longer needed.

The inspector runs your installed extensions and reloads child resources. Their
normal startup and prompt hooks can have side effects. The loopback guarantee
covers the capture model request, not arbitrary extension behavior.
