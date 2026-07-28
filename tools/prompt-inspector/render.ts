/**
 * Turn a captured provider payload into one self-contained HTML page.
 *
 * Pure on purpose: `capture.ts` writes the payload, this reads it. A payload
 * can be re-rendered after the renderer grows without paying for another pi
 * run, and every function here is testable without a browser or a session.
 *
 * The page answers three questions, in the order they get asked:
 *
 *   1. What exactly does the model see? — every message, verbatim.
 *   2. What is it costing? — bytes and estimated tokens, per section and per
 *      tool, biggest first.
 *   3. Where did that come from? — headings within the prompt, so a section
 *      can be traced back to the extension or skill that contributed it.
 *
 * Token figures are `chars / 4`. That is honest for comparing two sections and
 * wrong for anything that needs a real number, so the page says so rather than
 * printing a total that looks authoritative.
 *
 * Measurement and section attribution live in `extensions/shared`, because the
 * live `/context-budget` command reports the same numbers and the two must not
 * drift apart. Re-exported here so a payload report is still one import.
 */

import {
  byteLength,
  CHARS_PER_TOKEN,
  estimateTokens,
  formatBytes,
  splitSections,
  type PromptSection,
} from "../../extensions/shared/prompt-sections.ts";

export {
  byteLength,
  estimateTokens,
  formatBytes,
  splitSections,
  type PromptSection,
};

export interface PromptMessage {
  readonly role: string;
  readonly content: string;
}

export interface PromptTool {
  readonly name: string;
  readonly description: string;
  /**
   * The whole serialized entry this was measured from — a tool's full JSON
   * schema, a skill's whole `<skill>` block. Kept because the name and
   * description are a small fraction of what the entry actually costs, and
   * estimating tokens from the summary instead reported a `parameters` schema
   * of any size as very nearly free.
   */
  readonly text: string;
  readonly bytes: number;
}

export interface CaptureMeta {
  /** ISO timestamp; passed in rather than read, to keep this pure. */
  readonly capturedAt: string;
  readonly promptText: string;
  readonly source?: string;
}

export function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Flatten the several shapes a provider message's content can take. */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof (part as { text?: unknown })?.text === "string"
            ? (part as { text: string }).text
            : JSON.stringify(part),
      )
      .join("\n");
  }
  if (content === undefined || content === null) return "";
  return JSON.stringify(content, null, 2);
}

export function readMessages(payload: unknown): PromptMessage[] {
  const messages = (payload as { messages?: unknown })?.messages;
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => ({
    role: String((message as { role?: unknown })?.role ?? "unknown"),
    content: messageText((message as { content?: unknown })?.content),
  }));
}

/**
 * The instruction-carrying messages. pi sends its prompt as `developer` rather
 * than `system` — a fact worth surfacing rather than hiding, since it decides
 * how anything sitting in front of the provider has to treat the prompt.
 */
export function instructionMessages(messages: ReadonlyArray<PromptMessage>) {
  return messages.filter(
    (message) => message.role === "system" || message.role === "developer",
  );
}

export function readTools(payload: unknown): PromptTool[] {
  const tools = (payload as { tools?: unknown })?.tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => {
      const fn = ((tool as { function?: unknown })?.function ?? tool) as {
        name?: unknown;
        description?: unknown;
      };
      const text = JSON.stringify(tool);
      return {
        name: String(fn?.name ?? "(unnamed)"),
        description: String(fn?.description ?? ""),
        text,
        bytes: byteLength(text),
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

/**
 * Skills advertised in the prompt, with what each costs.
 *
 * Every skill's name, description and location ride in the prompt on every
 * single turn — the body is only read on demand, but the catalogue is not. It
 * is the one part of the prompt that grows silently as skills are added, which
 * makes it worth its own table.
 */
export function readSkills(text: string): PromptTool[] {
  // Whitespace-tolerant: the real catalogue indents every entry, and matching
  // the shape this was first written against found nothing at all.
  const entries = [...text.matchAll(/<skill>\s*([\s\S]*?)\s*<\/skill>/g)];
  return entries
    .map((entry) => {
      const block = entry[1] ?? "";
      const name = /<name>([\s\S]*?)<\/name>/.exec(block)?.[1]?.trim();
      const description = /<description>([\s\S]*?)<\/description>/
        .exec(block)?.[1]
        ?.trim();
      return {
        name: name || "(unnamed)",
        description: description ?? "",
        text: entry[0]!,
        bytes: byteLength(entry[0]!),
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

const STYLE = `
:root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --line:#262b36;
        --text:#e6e8ee; --dim:#9aa3b2; --accent:#7aa2f7; --bar:#2a3350; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text);
       font:14px/1.55 ui-sans-serif,-apple-system,"SF Pro Text",system-ui,sans-serif; }
header { padding:24px 28px 12px; border-bottom:1px solid var(--line); position:sticky;
         top:0; background:var(--bg); z-index:2; }
h1 { margin:0 0 4px; font-size:19px; font-weight:650; letter-spacing:-0.01em; }
.sub { color:var(--dim); font-size:13px; }
main { padding:20px 28px 64px; max-width:1100px; }
section { margin:26px 0; }
h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em;
     color:var(--dim); font-weight:600; margin:0 0 10px; }
.cards { display:flex; gap:10px; flex-wrap:wrap; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:10px;
        padding:12px 16px; min-width:130px; }
.card .n { font-size:20px; font-weight:650; }
.card .l { color:var(--dim); font-size:12px; }
details { background:var(--panel); border:1px solid var(--line); border-radius:10px;
          margin:8px 0; overflow:hidden; }
summary { cursor:pointer; padding:11px 14px; display:flex; gap:12px;
          align-items:baseline; list-style:none; }
summary::-webkit-details-marker { display:none; }
summary:hover { background:#1c202a; }
summary .name { font-weight:600; }
summary .meta { color:var(--dim); font-size:12px; margin-left:auto; white-space:nowrap; }
.role { font:11px ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--accent);
        border:1px solid var(--line); border-radius:5px; padding:1px 6px; }
pre { margin:0; padding:14px 16px; border-top:1px solid var(--line);
      white-space:pre-wrap; word-break:break-word; background:#12151b;
      font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; }
table { width:100%; border-collapse:collapse; }
td, th { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line);
         font-size:13px; }
th { color:var(--dim); font-weight:600; font-size:12px; }
td.num { text-align:right; color:var(--dim); font-variant-numeric:tabular-nums; }
.bar { height:5px; background:var(--bar); border-radius:3px; min-width:2px; }
.desc { color:var(--dim); font-size:12px; }
#filter { width:100%; padding:9px 12px; margin:6px 0 2px; background:var(--panel);
          border:1px solid var(--line); border-radius:8px; color:var(--text);
          font-size:13px; }
.note { color:var(--dim); font-size:12px; margin-top:6px; }
.hidden { display:none; }
`;

const SCRIPT = `
const filter = document.getElementById("filter");
filter?.addEventListener("input", () => {
  const q = filter.value.trim().toLowerCase();
  for (const node of document.querySelectorAll("[data-searchable]")) {
    const hit = !q || node.dataset.searchable.includes(q);
    node.classList.toggle("hidden", !hit);
    // Opening on a hit makes a search land on the text, not on a closed box.
    if (q && hit && node.tagName === "DETAILS") node.open = true;
  }
});
document.getElementById("expand")?.addEventListener("click", () => {
  for (const d of document.querySelectorAll("details")) d.open = true;
});
document.getElementById("collapse")?.addEventListener("click", () => {
  for (const d of document.querySelectorAll("details")) d.open = false;
});
`;

function card(n: string, label: string) {
  return `<div class="card"><div class="n">${escapeHtml(n)}</div><div class="l">${escapeHtml(label)}</div></div>`;
}

function bar(value: number, max: number) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 2;
  return `<div class="bar" style="width:${pct}%"></div>`;
}

function messageBlock(message: PromptMessage) {
  const search = `${message.role} ${message.content}`.toLowerCase();
  return `<details data-searchable="${escapeHtml(search)}">
  <summary><span class="role">${escapeHtml(message.role)}</span>
    <span class="meta">${formatBytes(byteLength(message.content))} · ~${estimateTokens(message.content).toLocaleString()} tok</span>
  </summary>
  <pre>${escapeHtml(message.content)}</pre>
</details>`;
}

function sectionRows(sections: ReadonlyArray<PromptSection>) {
  const max = Math.max(1, ...sections.map((s) => s.bytes));
  return (
    sections
      .map(
        (section) => `<details data-searchable="${escapeHtml(
          `${section.heading} ${section.body}`.toLowerCase(),
        )}">
  <summary><span class="name">${escapeHtml(section.heading)}</span>
    <span class="meta">${formatBytes(section.bytes)} · ~${estimateTokens(section.body).toLocaleString()} tok</span>
  </summary>
  <pre>${escapeHtml(section.body)}</pre>
</details>`,
      )
      .join("\n") +
    `<div class="note">Largest section: ${formatBytes(max)}.</div>`
  );
}

function toolTable(
  tools: ReadonlyArray<PromptTool>,
  emptyNote = "No tools in this payload.",
) {
  if (tools.length === 0)
    return `<div class="note">${escapeHtml(emptyNote)}</div>`;
  const max = Math.max(1, ...tools.map((tool) => tool.bytes));
  const rows = tools
    .map(
      (tool) => `<tr data-searchable="${escapeHtml(
        `${tool.name} ${tool.description}`.toLowerCase(),
      )}">
    <td><div class="name">${escapeHtml(tool.name)}</div>
        <div class="desc">${escapeHtml(tool.description.slice(0, 160))}${tool.description.length > 160 ? "…" : ""}</div></td>
    <td class="num">${formatBytes(tool.bytes)}</td>
    <td class="num">~${estimateTokens(tool.text).toLocaleString()}</td>
    <td style="width:22%">${bar(tool.bytes, max)}</td>
  </tr>`,
    )
    .join("\n");
  return `<table><thead><tr><th>Tool</th><th class="num">Schema</th><th class="num">Est. tokens</th><th></th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

export function renderReport(payload: unknown, meta: CaptureMeta): string {
  const messages = readMessages(payload);
  const instructions = instructionMessages(messages);
  const tools = readTools(payload);
  const instructionText = instructions.map((m) => m.content).join("\n\n");
  const sections = splitSections(instructionText);
  const skills = readSkills(instructionText);
  const skillBytes = skills.reduce((sum, skill) => sum + skill.bytes, 0);
  const toolBytes = tools.reduce((sum, tool) => sum + tool.bytes, 0);
  const payloadText = JSON.stringify(payload ?? {});
  const totalBytes = byteLength(payloadText);
  const model = String((payload as { model?: unknown })?.model ?? "unknown");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>pi system prompt — "${escapeHtml(meta.promptText)}"</title>
<style>${STYLE}</style></head>
<body>
<header>
  <h1>What pi sends when you say &ldquo;${escapeHtml(meta.promptText)}&rdquo;</h1>
  <div class="sub">model <strong>${escapeHtml(model)}</strong> · captured ${escapeHtml(meta.capturedAt)}${
    meta.source ? ` · from ${escapeHtml(meta.source)}` : ""
  }</div>
  <input id="filter" placeholder="Filter messages, prompt sections and tools…" autocomplete="off">
  <div class="sub"><a href="#" id="expand">expand all</a> · <a href="#" id="collapse">collapse all</a></div>
</header>
<main>

<section>
  <h2>Totals</h2>
  <div class="cards">
    ${card(formatBytes(totalBytes), "whole request")}
    ${card(formatBytes(byteLength(instructionText)), "instructions")}
    ${card(formatBytes(toolBytes), "tool schemas")}
    ${card(String(tools.length), "tools")}
    ${card(String(skills.length), "skills")}
    ${card(String(messages.length), "messages")}
    ${card(`~${estimateTokens(payloadText).toLocaleString()}`, "est. tokens")}
  </div>
  <div class="note">Token counts are characters ÷ ${CHARS_PER_TOKEN} — fine for comparing
  two rows, not a substitute for the provider's own count.</div>
</section>

<section>
  <h2>Instructions, by section</h2>
  ${
    sections.length
      ? sectionRows(sections)
      : `<div class="note">No system or developer message in this payload.</div>`
  }
</section>

<section>
  <h2>Tool schemas${tools.length ? ` — ${formatBytes(toolBytes)}, largest first` : ""}</h2>
  ${toolTable(tools)}
</section>

<section>
  <h2>Skills advertised${skills.length ? ` — ${formatBytes(skillBytes)} on every turn` : ""}</h2>
  ${toolTable(skills, "No skills catalogue in this prompt.")}
  ${
    skills.length
      ? `<div class="note">Only the catalogue is here — names, descriptions and paths.
         Skill bodies are read on demand, but this much is paid on every turn.</div>`
      : ""
  }
</section>

<section>
  <h2>Every message, in order</h2>
  ${messages.map(messageBlock).join("\n")}
</section>

<section>
  <h2>Raw payload</h2>
  <details data-searchable="raw payload json">
    <summary><span class="name">The request, verbatim</span>
      <span class="meta">${formatBytes(totalBytes)}</span></summary>
    <pre>${escapeHtml(JSON.stringify(payload ?? {}, null, 2))}</pre>
  </details>
</section>

</main>
<script>${SCRIPT}</script>
</body></html>
`;
}
