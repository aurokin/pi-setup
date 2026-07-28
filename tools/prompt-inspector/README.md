# prompt-inspector

What the model actually receives when you say "Hello" to pi, as one HTML page.

```sh
npm run prompt              # writes ./prompt-report.html
npm run prompt -- --open    # and opens it
node --experimental-strip-types tools/prompt-inspector/inspect.ts "review this" --out=/tmp/r.html
```

**It costs nothing.** `capture.ts` registers a provider whose baseUrl is a
loopback listener inside pi's own process. Selecting its model makes pi
assemble a real request and hand it here instead of to a model, so no request
leaves the machine and no tokens are spent. Run it as often as you like.

It runs pi with its **normal** configuration — every installed extension, every
skill, the real `AGENTS.md` — because the question is what this machine's agent
receives, not what a clean install would.

## What it showed the first time it ran

46 KB before the conversation starts: 24.2 KB of instructions and 21.2 KB of
tool schemas across 22 tools.

| | |
| --- | --- |
| `<available_skills>` | 8.9 KB — the largest single piece, larger than pi's own base prompt |
| pi's base prompt | 7.2 KB |
| `<project_context>` (`AGENTS.md`) | 4.5 KB |
| `workflow` tool schema | 3.8 KB |
| `subagent_spawn` tool schema | 2.7 KB |

The skills catalogue is worth watching: only names, descriptions and paths are
in the prompt — bodies are read on demand — but that catalogue is paid on every
turn and grows silently with each skill added. 18 skills, 8.8 KB, and the two
largest are a third of it.

## Layout

```
capture.ts   the fake provider and loopback listener; loaded with -e, never installed
render.ts    payload -> HTML. Pure, so a saved payload can be re-rendered later
inspect.ts   runs pi, then renders
```

`render.ts` is pure on purpose: growing the page does not mean re-running pi.
`inspect.ts` deletes its captured payload once the report is written — it is a
second copy of the same private material — so to keep one for re-rendering, run
the capture yourself and say where it goes:

```sh
PROMPT_INSPECTOR_OUT=/tmp/payload.json pi --print --no-session \
  --extension tools/prompt-inspector/capture.ts \
  --model prompt-inspector/probe Hello
```

## Reading the numbers

Token counts are `characters ÷ 4`. Good for comparing two rows, not a
substitute for the provider's own count — the page says so too.

Attribution follows pi's own structure: contributions it did not write are
wrapped in blocks (`<project_context>`, `<available_skills>`), and only the
text between those is split on markdown headings. Splitting on headings alone
runs straight through a closing tag and bills one file's bytes to another's
last heading.

## Growing it

Additions that would earn their place, roughly in order:

- Diff two payloads, so the cost of adding a skill or extension is a number.
- Group tool schemas by the extension that registered them.
- Real token counts, if pi ever exposes its tokenizer to extensions.

## A caution

The report contains your full prompt — `AGENTS.md`, `CLAUDE.md`, any project
instructions, every tool description. That is routinely private. It is written
to the working directory by default; do not paste it anywhere public.
