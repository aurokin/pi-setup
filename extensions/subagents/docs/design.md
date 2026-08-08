# Subagents

The subagents extension gives the parent session one background-agent model over
several harnesses. Backends translate their native event streams into the shared
domain in `src/domain.ts`; the manager, tools, result delivery, and TUI do not
depend on a backend's wire format.

## Registered and offered harnesses

A registered harness has an implementation and may support extension-owned
features. An offered harness appears in the model-facing `subagent_spawn` enum.
`subagents.json` controls the offered set, while internal features such as
`/btw` can use registered backends independently.

The generated `subagents` skill uses the same selection that builds the tool
schema. This keeps model-facing routing advice from listing a harness the tool
cannot invoke. `extensions/subagents/skill/` is the source; the rendered file
under the agent directory is disposable output.

## Roles and tool policy

Every spawn chooses a role. Role profiles live in `extensions/shared/roles.ts`
and determine whether the child may write, whether it inherits parent tools,
and what framing precedes the task. Each backend maps that policy to its native
tool restrictions or sandbox. The guarantees are not identical across
harnesses, so `src/tool-policy.ts`, backend-specific policy modules, and their
tests are the authority.

Children cannot orchestrate more children or ask the user. The parent owns
concurrency and is the only session with a person available to answer.

## Lifecycle

The Effect manager owns running sessions, normalized transcripts, usage,
cancellation, follow-up sends, and the global concurrency reservation. Spawns
reserve capacity synchronously so parallel calls cannot pass the cap together.
A settled session may be restarted with a follow-up send only when capacity is
available.

Tool calls that explicitly wait for or inspect a result consume it. Unconsumed
settlements enter a terminal-id keyed delivery map and reach the parent once as
follow-up messages. The first consumer wins, preventing a wait result and an
automatic completion from reporting the same settlement twice.

Subagent sessions are process-local. Session shutdown disposes the manager; it
does not revive children after pi exits.

## Trust and egress

A child in the parent's working directory inherits the live project-trust
decision. Another directory must be trusted independently through pi's trust
store. Read failures fail closed.

Every external harness sends the task and whatever context its backend includes
to that provider. The generated skill carries the routing and credential-egress
rules that the parent model must apply before spawning.

## Source map

- `index.ts`: extension tools, lifecycle, generated skill, and TUI wiring
- `src/domain.ts`: normalized tasks, events, transcripts, and snapshots
- `src/harnesses.ts`: registered/offered harness catalog and config
- `src/manager.ts`: concurrency, lifecycle, sends, waits, and cancellation
- `src/backends/`: native harness adapters
- `src/tool-policy.ts` and backend policy modules: role enforcement
- `src/result-delivery.ts`: one-shot parent delivery
- `src/ui/`: inspection and takeover

`design-plan.md` and the Effect v4 notes are historical implementation research,
not current API or setup guidance.
