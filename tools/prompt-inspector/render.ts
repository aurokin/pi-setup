/**
 * Pure prompt-report renderer. The parent capture retains its raw JSON and
 * detailed sections; additional review surfaces bring their own fidelity,
 * ordered contributions and limits. File access and Pi assembly stay outside.
 */

import {
  PI_PROFILE,
  PI_WORKSPACE,
} from "../../extensions/shared/engineering-policy.ts";
import {
  byteLength,
  CHARS_PER_TOKEN,
  estimateTokens,
  formatBytes,
  splitSections,
  type PromptSection,
} from "../../extensions/shared/prompt-sections.ts";
import {
  instructionMessages,
  readMessages,
  readTools,
  readSkills,
  type PromptMessage,
  type PromptTool,
  type SkillBody,
} from "./payload.ts";
export {
  instructionMessages,
  readMessages,
  readTools,
  readSkills,
  messageText,
  type PromptMessage,
  type PromptTool,
  type SkillBody,
} from "./payload.ts";
import {
  FIDELITY_LABELS,
  capturedSurface,
  extensionSurfaces,
  groupVariants,
  type PromptSurface,
} from "./surfaces.ts";

export {
  byteLength,
  estimateTokens,
  formatBytes,
  splitSections,
  type PromptSection,
};

export interface CaptureMeta {
  /** ISO timestamp; passed in rather than read, to keep this pure. */
  readonly capturedAt: string;
  readonly promptText: string;
  readonly source?: string;
  readonly surfaces?: readonly PromptSurface[];
  readonly reviewNotes?: readonly string[];
  /**
   * Bodies of the skills this repo owns, keyed by the `<location>` in the
   * catalogue. Supplied by the runner, because reading files here would cost
   * the renderer its purity and make a saved payload un-re-renderable on
   * another machine. Third-party skills are deliberately absent: they are not
   * ours to review, and their bodies would bury ours.
   */
  readonly skillBodies?: Readonly<Record<string, SkillBody>>;
}

export function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
.track { flex:0 0 18%; margin-left:auto; }
.track + .meta { margin-left:0; }
.desc { color:var(--dim); font-size:12px; }
.pad { padding:0 14px 12px; border-top:1px solid var(--line); }
pre.flush { border-top:none; padding:12px 0; background:none; }
.pad details { margin:4px 0 0; }
.pad .note { padding-bottom:8px; }
#filter { width:100%; padding:9px 12px; margin:6px 0 2px; background:var(--panel);
          border:1px solid var(--line); border-radius:8px; color:var(--text);
          font-size:13px; }
.note { color:var(--dim); font-size:12px; margin-top:6px; }
.instruction-scope { display:flex; align-items:center; gap:10px; margin:18px 2px 7px;
                     color:var(--accent); font-size:12px; font-weight:650;
                     letter-spacing:.04em; text-transform:uppercase; }
.instruction-scope::after { content:""; height:1px; background:var(--line); flex:1; }
.fidelity { color:var(--accent); font-size:12px; margin-left:auto; white-space:nowrap; }
.surface-content { padding:0 16px 16px; border-top:1px solid var(--line); }
.surface-content > p { max-width:85ch; }
.dimensions, .source { font-size:12px; color:var(--dim); overflow-wrap:anywhere; }
.source { padding:0 16px; }
.chain { padding-left:26px; }
.chain > li::marker { color:var(--dim); font-variant-numeric:tabular-nums; }
h3 { font-size:15px; margin-top:24px; }
label { display:block; margin-top:16px; font-size:13px; }
.table-scroll { overflow-x:auto; }
.surface td { vertical-align:top; overflow-wrap:anywhere; }
:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
::selection { background:#354e75; color:#fff; }
@media (max-width:600px) {
  header, main { padding:18px 12px; }
  summary { flex-wrap:wrap; gap:5px 10px; }
  summary .name { overflow-wrap:anywhere; }
  .fidelity { margin-left:0; }
  summary .meta { white-space:normal; }
  .surface-content { padding:0 10px 12px; }
  .chain { padding-left:20px; }
  .cards { flex-wrap:wrap; }
}
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

const AGENT_POLICY_HEADINGS = new Set(
  splitSections(PI_PROFILE).map((section) => section.heading),
);
const PI_ONLY_HEADINGS = new Set(
  splitSections(PI_WORKSPACE).map((section) => section.heading),
);

function instructionScope(section: PromptSection) {
  if (PI_ONLY_HEADINGS.has(section.heading)) return "Pi-only additions";
  if (AGENT_POLICY_HEADINGS.has(section.heading)) return "Agent policy";
  return undefined;
}

function sectionRows(sections: ReadonlyArray<PromptSection>) {
  const max = Math.max(1, ...sections.map((s) => s.bytes));
  let previousScope: string | undefined;
  return (
    sections
      .map((section) => {
        const scope = instructionScope(section);
        const divider =
          scope && scope !== previousScope
            ? `<div class="instruction-scope">${escapeHtml(scope)}</div>\n`
            : "";
        previousScope = scope;
        return `${divider}<details data-searchable="${escapeHtml(
          `${section.heading} ${section.body}`.toLowerCase(),
        )}">
  <summary><span class="name">${escapeHtml(section.heading)}</span>
    <span class="meta">${formatBytes(section.bytes)} · ~${estimateTokens(section.body).toLocaleString()} tok</span>
  </summary>
  <pre>${escapeHtml(section.body)}</pre>
</details>`;
      })
      .join("\n") +
    `<div class="note">Largest section: ${formatBytes(max)}.</div>`
  );
}

/**
 * One expandable row per entry, biggest first.
 *
 * Expandable rather than a table because the description *is* the prompting:
 * truncating it at 160 characters made the page a size report, when what it
 * needs to support is reading the exact words the model is given. The bar
 * stays, so the ranking is still legible without opening anything.
 */
function entryList(
  entries: ReadonlyArray<PromptTool>,
  options: { emptyNote: string; bodyLabel: string },
) {
  if (entries.length === 0)
    return `<div class="note">${escapeHtml(options.emptyNote)}</div>`;
  const max = Math.max(1, ...entries.map((entry) => entry.bytes));
  return entries
    .map((entry) => {
      const search =
        `${entry.name} ${entry.description} ${entry.body?.text ?? ""}`.toLowerCase();
      const body = entry.body
        ? `<details data-searchable="${escapeHtml(search)}">
      <summary><span class="name">${escapeHtml(options.bodyLabel)}</span>
        <span class="meta">${escapeHtml(entry.body.origin)} · ${formatBytes(entry.body.bytes)} · ~${estimateTokens(entry.body.text).toLocaleString()} tok</span>
      </summary>
      <pre>${escapeHtml(entry.body.text)}</pre>
    </details>`
        : "";
      return `<details data-searchable="${escapeHtml(search)}">
  <summary><span class="name">${escapeHtml(entry.name)}</span>
    <span class="track">${bar(entry.bytes, max)}</span>
    <span class="meta">${formatBytes(entry.bytes)} · ~${estimateTokens(entry.text).toLocaleString()} tok</span>
  </summary>
  <div class="pad">
    <pre class="flush">${escapeHtml(entry.description) || '<span class="desc">(no description)</span>'}</pre>
    ${entry.location ? `<div class="note">${escapeHtml(entry.location)}</div>` : ""}
    ${body}
  </div>
</details>`;
    })
    .join("\n");
}

const fidelityDescriptions = {
  captured: "Observed at a provider boundary.",
  assembled:
    "Composed from production files and functions; not captured at a provider boundary.",
  "extension-message": "Only the message owned by pi-setup.",
} as const;

function surfaceBlock(surface: PromptSurface, open = false) {
  const search = JSON.stringify(surface).toLowerCase();
  const dimensions = surface.dimensions;
  const shared = (["role", "harness", "history"] as const)
    .map((key) => {
      const values = [...new Set(dimensions.map((member) => member[key]))];
      return values.length ? `${key}: ${values.join(", ")}` : "";
    })
    .filter(Boolean)
    .join(" · ");
  return `<details class="surface" ${open ? "open" : ""} data-searchable="${escapeHtml(search)}">
    <summary><span class="name">${escapeHtml(surface.title)}</span>
      <span class="fidelity">${FIDELITY_LABELS[surface.fidelity]}</span></summary>
    <div class="surface-content">
      <p>${fidelityDescriptions[surface.fidelity]}</p>
      ${shared ? `<p class="dimensions">${escapeHtml(shared)}</p>` : ""}
      ${surface.limitations.map((note) => `<p class="note">${escapeHtml(note)}</p>`).join("")}
      ${
        dimensions.length
          ? `<details>
        <summary>Variant configuration and tool restrictions</summary>
        <div class="table-scroll"><table><thead><tr><th>Role / harness</th><th>History</th><th>Policy</th><th>Tools</th></tr></thead><tbody>
        ${dimensions
          .map(
            (
              member,
            ) => `<tr><td>${escapeHtml(member.role)} / ${escapeHtml(member.harness)}</td>
          <td>${escapeHtml(member.history)}</td><td>${escapeHtml(member.policy)}</td><td>${escapeHtml(member.tools)}</td></tr>`,
          )
          .join("")}
        </tbody></table></div></details>`
          : ""
      }
      <h3>Ordered context contributions</h3>
      <p class="note">Text follows composition order. Tool schemas are a separate field, shown last.
      Open a contribution to read its content and source.</p>
      <ol class="chain">${surface.contributions
        .map(
          (part) => `<li>
        <details data-searchable="${escapeHtml(`${part.label} ${part.source} ${part.content}`.toLowerCase())}">
          <summary><span class="name">${escapeHtml(part.label)}</span><span class="meta">${formatBytes(byteLength(part.content))}</span></summary>
          <p class="source">${escapeHtml(part.source)}</p><pre>${escapeHtml(part.content)}</pre>
        </details></li>`,
        )
        .join("")}</ol>
      ${
        surface.extensionMessage !== undefined
          ? `<details>
        <summary>Complete extension-owned message</summary>
        <pre>${escapeHtml(surface.extensionMessage)}</pre></details>`
          : ""
      }
    </div>
  </details>`;
}

export function renderReport(payload: unknown, meta: CaptureMeta): string {
  const messages = readMessages(payload);
  const instructions = instructionMessages(messages);
  const tools = readTools(payload);
  const instructionText = instructions.map((m) => m.content).join("\n\n");
  const sections = splitSections(instructionText);
  const skills = readSkills(instructionText, meta.skillBodies ?? {});
  const ourSkills = skills.filter((skill) => skill.body);
  const parent = capturedSurface(payload);
  const variants = groupVariants(
    meta.surfaces ?? extensionSurfaces(meta.promptText),
  );
  const skillBytes = skills.reduce((sum, skill) => sum + skill.bytes, 0);
  const toolBytes = tools.reduce((sum, tool) => sum + tool.bytes, 0);
  const payloadText = JSON.stringify(payload ?? {});
  const totalBytes = byteLength(payloadText);
  const model = String((payload as { model?: unknown })?.model ?? "unknown");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Prompt review: ${escapeHtml(meta.promptText)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLE}</style></head>
<body>
<header>
  <h1>Prompt review</h1>
  <p>Parent Pi request for &ldquo;${escapeHtml(meta.promptText)}&rdquo;, followed by agent variants.</p>
  <div class="sub">model <strong>${escapeHtml(model)}</strong> · captured ${escapeHtml(meta.capturedAt)}${
    meta.source ? ` · from ${escapeHtml(meta.source)}` : ""
  }</div>
  <label for="filter">Search the prompt report</label>
  <input id="filter" placeholder="Filter messages, prompt sections and tools…" autocomplete="off">
  <div class="sub"><a href="#" id="expand">expand all</a> · <a href="#" id="collapse">collapse all</a></div>
</header>
<main>
<section>
  <h2>Parent Pi context</h2>
  ${surfaceBlock(parent)}
  <p class="note">This prompt capture is observed at the loopback provider boundary for the probe model.
  The ordered messages and raw payload below retain the complete request. Other models and transports can serialize context differently.</p>
</section>
<section id="variants">
  <h2>Agent prompt variants</h2>
  <p>Compare the context each variant includes. Shared extension messages are grouped across harnesses;
  that does not establish equivalence of their full prompts.</p>
  ${(meta.reviewNotes ?? []).map((note) => `<p class="note">${escapeHtml(note)}</p>`).join("")}
  ${variants.map((surface) => surfaceBlock(surface)).join("\n")}
</section>
<section>
  <h2>Parent capture totals</h2>
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
  ${entryList(tools, {
    emptyNote: "No tools in this payload.",
    bodyLabel: "Full schema",
  })}
  ${
    tools.length
      ? `<div class="note">A tool's description and its parameter descriptions are
         prompting: they are what the model reads to decide whether to call it, and
         with what. Open a row to review the wording.</div>`
      : ""
  }
</section>

<section>
  <h2>Skills advertised${skills.length ? ` — ${formatBytes(skillBytes)} on every turn` : ""}</h2>
  ${entryList(skills, {
    emptyNote: "No skills catalogue in this prompt.",
    bodyLabel: "SKILL.md — read on demand, not sent on this turn",
  })}
  ${
    skills.length
      ? `<div class="note">The catalogue — name, description, path — is paid on every
         turn. Bodies are read only when the model follows one, and are shown here for
         the ${ourSkills.length} skill${ourSkills.length === 1 ? "" : "s"} this repo owns
         (checked in or generated). Third-party skills show their catalogue entry only:
         they are not ours to review, and their bodies would bury ours.</div>`
      : ""
  }
</section>

<section>
  <h2>Every message, in order</h2>
  ${messages.map(messageBlock).join("\n")}
</section>

<section>
  <h2>Raw payload · prompt capture</h2>
  <details data-searchable="raw payload json">
    <summary><span class="name">Captured request JSON, formatted</span>
      <span class="meta">${formatBytes(totalBytes)}</span></summary>
    <pre>${escapeHtml(JSON.stringify(payload ?? {}, null, 2))}</pre>
  </details>
</section>

</main>
<script>${SCRIPT}</script>
</body></html>
`;
}
