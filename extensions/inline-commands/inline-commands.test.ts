import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import {
  parseSkillBlock,
  type ExtensionAPI,
  type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import {
  INLINE_GOAL_CHANNEL,
  type InlineGoalRequest,
} from "../shared/inline-commands.ts";
import inlineCommands from "./index.ts";
import {
  inlinePrefixAtCursor,
  wrapInlineAutocomplete,
} from "./src/autocomplete.ts";
import {
  buildCatalog,
  loadSkills,
  parseCommandArgs,
  prepareInlineText,
  renderSkillInvocation,
  substituteTemplateArgs,
} from "./src/transform.ts";

const files = new Map([
  [
    "/skills/pdf/SKILL.md",
    "---\nname: pdf\ndescription: PDF work\n---\n\nFollow the PDF workflow.",
  ],
  [
    "/skills/humanizer/SKILL.md",
    "---\nname: humanizer\ndescription: Natural writing\n---\n\nMake the prose natural.",
  ],
  [
    "/prompts/review.md",
    "---\ndescription: Review changes\n---\nReview $1 with ${2:-care}. Remaining: ${@:2}.",
  ],
]);

function command(
  name: string,
  source: SlashCommandInfo["source"],
  path: string,
): SlashCommandInfo {
  return {
    name,
    source,
    description: `${name} description`,
    sourceInfo: {
      path,
      source: "test",
      scope: "user",
      origin: "top-level",
      baseDir: path.slice(0, path.lastIndexOf("/")),
    },
  };
}

const commands = [
  command("skill:pdf", "skill", "/skills/pdf/SKILL.md"),
  command("skill:humanizer", "skill", "/skills/humanizer/SKILL.md"),
  command("review", "prompt", "/prompts/review.md"),
  command("goal", "extension", "/extensions/goal/index.ts"),
];
const catalog = buildCatalog(commands);
const readResource = (path: string) => {
  const content = files.get(path);
  if (content === undefined) throw new Error(`missing ${path}`);
  return content;
};

test("skills are discovered anywhere and duplicate bodies are deduplicated", () => {
  const prepared = prepareInlineText(
    "Use /skill:pdf with /skill:humanizer, then /skill:pdf again",
    catalog,
    readResource,
  );
  assert.deepEqual(
    prepared.skills.map((skill) => skill.name),
    ["skill:pdf"],
    "punctuation keeps a token literal rather than invoking a near match",
  );
  assert.equal(prepared.skillReferenceCount, 2);

  const exact = prepareInlineText(
    "Use /skill:pdf with /skill:humanizer then /skill:pdf again",
    catalog,
    readResource,
  );
  assert.deepEqual(
    exact.skills.map((skill) => skill.name),
    ["skill:pdf", "skill:humanizer"],
  );
  assert.equal(exact.skillReferenceCount, 3);
});

test("slash syntax inside code, escaped text, paths, and URLs stays literal", () => {
  const prepared = prepareInlineText(
    [
      "Use `/skill:pdf` and \\/skill:humanizer literally.",
      "https://example.test/skill:pdf /tmp/skill:pdf",
      "```",
      "/skill:pdf /goal",
      "```",
      "~~~ts",
      "/skill:humanizer",
      "~~~",
      "    /skill:pdf /goal",
      "\t/skill:humanizer /goal",
      "  \t/skill:pdf /goal",
    ].join("\n"),
    catalog,
    readResource,
  );
  assert.equal(prepared.changed, false);
  assert.equal(prepared.goalText, undefined);
  assert.deepEqual(prepared.skills, []);
});

test("escaped backticks do not suppress later directives", () => {
  const prepared = prepareInlineText(
    "Use \\` literally, then /skill:pdf /goal",
    catalog,
    readResource,
  );
  assert.deepEqual(
    prepared.skills.map((skill) => skill.name),
    ["skill:pdf"],
  );
  assert.equal(prepared.goalText, "Use \\` literally, then /skill:pdf");
});

test("longer Markdown fence closers resume slash scanning", () => {
  const prepared = prepareInlineText(
    ["```", "/skill:pdf /goal", "````", "Use /skill:humanizer /goal"].join(
      "\n",
    ),
    catalog,
    readResource,
  );
  assert.deepEqual(
    prepared.skills.map((skill) => skill.name),
    ["skill:humanizer"],
  );
  assert.equal(
    prepared.goalText,
    ["```", "/skill:pdf /goal", "````", "Use /skill:humanizer"].join("\n"),
  );
});

test("bare goal markers are removed while the compact draft becomes the goal", () => {
  const source = [
    "Use /skill:pdf to inspect the report.",
    "/goal",
    "Do not stop at the first warning.",
  ].join("\n");
  const prepared = prepareInlineText(source, catalog, readResource);
  assert.equal(
    prepared.text,
    "Use /skill:pdf to inspect the report.\nDo not stop at the first warning.",
  );
  assert.equal(prepared.textWithGoal, source);
  assert.equal(prepared.goalText, prepared.text);

  const midline = prepareInlineText(
    "Fix the report /goal before release",
    catalog,
    readResource,
  );
  assert.equal(midline.text, "Fix the report before release");
  assert.equal(midline.goalText, "Fix the report before release");
});

test("templates use line-scoped arguments and inline templates use none", () => {
  const prepared = prepareInlineText(
    [
      "Context first.",
      '/review api "extra care"',
      "Then use /review here.",
    ].join("\n"),
    catalog,
    readResource,
  );
  assert.equal(
    prepared.text,
    [
      "Context first.",
      "Review api with extra care. Remaining: extra care.",
      "Then use Review  with care. Remaining: . here.",
    ].join("\n"),
  );
});

test("a goal persists the effective template expansion, not an inert command", () => {
  const prepared = prepareInlineText(
    "/review api carefully\n/goal",
    catalog,
    readResource,
  );
  assert.equal(
    prepared.goalText,
    "Review api with carefully. Remaining: carefully.",
  );
});

test("an unreadable template still keeps slash-looking arguments inert", () => {
  const unreadable = command("missing", "prompt", "/prompts/missing.md");
  const prepared = prepareInlineText(
    "/missing /skill:pdf /goal",
    buildCatalog([...commands, unreadable]),
    readResource,
  );
  assert.equal(prepared.goalText, undefined);
  assert.deepEqual(prepared.skills, []);
  assert.equal(prepared.text, "/missing /skill:pdf /goal");
  assert.equal(prepared.errors.length, 1);
});

test("template arguments do not execute slash directives they contain", () => {
  const prepared = prepareInlineText(
    "/review /skill:pdf /goal",
    catalog,
    readResource,
  );
  assert.equal(prepared.goalText, undefined);
  assert.deepEqual(prepared.skills, []);
  assert.equal(
    prepared.text,
    "Review /skill:pdf with /goal. Remaining: /goal.",
  );
});

test("template argument parsing and substitution match Pi's documented forms", () => {
  const args = parseCommandArgs(`one "two words" '' 'three words'`);
  assert.deepEqual(args, ["one", "two words", "", "three words"]);
  assert.equal(
    substituteTemplateArgs(
      "$1|$2|$@|$ARGUMENTS|${3:-fallback}|${4:-fallback}|${@:2}|${@:2:1}",
      args,
    ),
    "one|two words|one two words  three words|one two words  three words|fallback|three words|two words  three words|two words",
  );
});

test("one or many skills retain Pi's collapsible invocation shape", () => {
  const loaded = loadSkills(commands.slice(0, 2), readResource);
  assert.deepEqual(loaded.errors, []);

  const singleText = renderSkillInvocation(loaded.skills.slice(0, 1), "Do it");
  const single = parseSkillBlock(singleText);
  assert.equal(single?.name, "pdf");
  assert.equal(single?.userMessage, "Do it");

  const combinedText = renderSkillInvocation(loaded.skills, "Do it together");
  const combined = parseSkillBlock(combinedText);
  assert.equal(combined?.name, "pdf + humanizer");
  assert.match(combined?.content ?? "", /<skill-section name="pdf"/);
  assert.match(combined?.content ?? "", /<skill-section name="humanizer"/);
  assert.equal(combined?.userMessage, "Do it together");
});

test("skill references resolve beside SKILL.md, not the discovery root", () => {
  const nested = {
    ...commands[0]!,
    sourceInfo: { ...commands[0]!.sourceInfo, baseDir: "/skills" },
  };
  const loaded = loadSkills([nested], readResource);
  assert.equal(loaded.skills[0]?.baseDir, "/skills/pdf");
});

test("missing resources produce findings without dropping other skills", () => {
  const missing = command("skill:missing", "skill", "/missing/SKILL.md");
  const loaded = loadSkills([commands[0]!, missing], readResource);
  assert.equal(loaded.skills.length, 1);
  assert.equal(loaded.errors.length, 1);
  assert.match(loaded.errors[0]!, /missing/);
});

test("inline autocomplete activates after draft text but delegates at draft start", async () => {
  let delegated = 0;
  const current: AutocompleteProvider = {
    triggerCharacters: ["#"],
    async getSuggestions() {
      delegated++;
      return { prefix: "/", items: [{ value: "model", label: "model" }] };
    },
    applyCompletion(lines, cursorLine, cursorCol) {
      return { lines, cursorLine, cursorCol };
    },
  };
  const provider = wrapInlineAutocomplete(current, () => commands);
  assert.deepEqual(provider.triggerCharacters, ["#", "/"]);
  const signal = new AbortController().signal;

  const start = await provider.getSuggestions(["/"], 0, 1, { signal });
  assert.equal(delegated, 1);
  assert.equal(start?.items[0]?.label, "model");

  const inline = await provider.getSuggestions(
    ["Please use /skill:h"],
    0,
    "Please use /skill:h".length,
    { signal },
  );
  assert.equal(inline?.prefix, "skill:h");
  assert.deepEqual(
    inline?.items.map((item) => item.label),
    ["skill:humanizer"],
  );

  const goal = await provider.getSuggestions(["Do this /g"], 0, 10, {
    signal,
  });
  assert.equal(goal?.items[0]?.value, "goal");
});

test("inline completion replaces only the active token", () => {
  const current: AutocompleteProvider = {
    async getSuggestions() {
      return null;
    },
    applyCompletion(lines, cursorLine, cursorCol) {
      return { lines, cursorLine, cursorCol };
    },
  };
  const provider = wrapInlineAutocomplete(current, () => commands);
  const line = "Use /skill:h for this";
  const result = provider.applyCompletion(
    [line],
    0,
    "Use /skill:h".length,
    {
      value: "skill:humanizer",
      label: "skill:humanizer",
    },
    "skill:h",
  );
  assert.equal(result.lines[0], "Use /skill:humanizer for this");
  assert.equal(result.cursorCol, "Use /skill:humanizer".length);
});

test("completion replaces the rest of a slash token when editing mid-word", () => {
  const current: AutocompleteProvider = {
    async getSuggestions() {
      return null;
    },
    applyCompletion(lines, cursorLine, cursorCol) {
      return { lines, cursorLine, cursorCol };
    },
  };
  const provider = wrapInlineAutocomplete(current, () => commands);
  const line = "Use /skill:hmanizer here";
  const result = provider.applyCompletion(
    [line],
    0,
    "Use /skill:h".length,
    { value: "skill:humanizer", label: "skill:humanizer" },
    "skill:h",
  );
  assert.equal(result.lines[0], "Use /skill:humanizer here");
});

test("the extension composes skills and goal through one input transform", () => {
  const integrationCommands = [
    command(
      "skill:background-terminals",
      "skill",
      join(import.meta.dirname, "../../skills/background-terminals/SKILL.md"),
    ),
    command(
      "skill:linearis",
      "skill",
      join(import.meta.dirname, "../../skills/linearis/SKILL.md"),
    ),
  ];
  const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
  let goalRequest: InlineGoalRequest | undefined;
  const notifications: string[] = [];
  const pi = {
    on(event: string, handler: (event: any, ctx: any) => any) {
      const registered = handlers.get(event) ?? [];
      registered.push(handler);
      handlers.set(event, registered);
    },
    getCommands: () => integrationCommands,
    events: {
      on() {
        return () => {};
      },
      emit(channel: string, value: unknown) {
        if (channel !== INLINE_GOAL_CHANNEL) return;
        goalRequest = value as InlineGoalRequest;
        goalRequest.handled = true;
      },
    },
  } as unknown as ExtensionAPI;
  inlineCommands(pi);
  const input = handlers.get("input")?.[0];
  assert.ok(input);

  const result = input(
    {
      text: "Use /skill:background-terminals and /skill:linearis to finish this /goal",
      source: "interactive",
    },
    {
      mode: "tui",
      ui: { notify: (message: string) => notifications.push(message) },
    },
  );
  assert.equal(result.action, "transform");
  const block = parseSkillBlock(result.text);
  assert.equal(block?.name, "background-terminals + linearis");
  const compactPrompt =
    "Use /skill:background-terminals and /skill:linearis to finish this";
  assert.equal(block?.userMessage, compactPrompt);
  assert.equal(goalRequest?.text, compactPrompt);
  assert.deepEqual(notifications, ["Goal set from this prompt."]);
});

test("a leading single skill stays on Pi's built-in expansion path", () => {
  const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
  const pi = {
    on(event: string, handler: (event: any, ctx: any) => any) {
      const registered = handlers.get(event) ?? [];
      registered.push(handler);
      handlers.set(event, registered);
    },
    getCommands: () => commands,
    events: { on: () => () => {}, emit() {} },
  } as unknown as ExtensionAPI;
  inlineCommands(pi);
  const input = handlers.get("input")?.[0];
  assert.ok(input);
  assert.deepEqual(
    input(
      { text: "/skill:pdf inspect this", source: "interactive" },
      { ui: { notify() {} } },
    ),
    { action: "continue" },
  );
});

test("autocomplete does not activate or delegate slash commands inside Markdown code", async () => {
  assert.equal(inlinePrefixAtCursor(["Use `/skill:p"], 0, 13), undefined);
  assert.equal(
    inlinePrefixAtCursor(["Before", "```", "/skill:p"], 2, 8),
    undefined,
  );
  assert.equal(
    inlinePrefixAtCursor(["Before", "    /skill:p"], 1, 12),
    undefined,
  );
  assert.equal(
    inlinePrefixAtCursor(["```", "code", "````", "Use /skill:p"], 3, 12),
    "/skill:p",
  );
  const escapedBacktick = "Use \\` literally, then /skill:p";
  assert.equal(
    inlinePrefixAtCursor([escapedBacktick], 0, escapedBacktick.length),
    "/skill:p",
  );

  let delegated = 0;
  const provider = wrapInlineAutocomplete(
    {
      async getSuggestions() {
        delegated++;
        return { prefix: "/", items: [{ value: "model", label: "model" }] };
      },
      applyCompletion(lines, cursorLine, cursorCol) {
        return { lines, cursorLine, cursorCol };
      },
    },
    () => commands,
  );
  const result = await provider.getSuggestions(
    ["Before", "```", "/skill:p"],
    2,
    8,
    { signal: new AbortController().signal },
  );
  assert.equal(result, null);
  assert.equal(delegated, 0);
});
