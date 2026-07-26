/**
 * Putting the artifact back into the request.
 *
 * After compaction pi rebuilds context as `[compactionSummary, ...kept]`, and
 * the provider layer turns that summary into some input item whose exact shape
 * is pi's business, not ours. Rather than reproduce that mapping — a private
 * detail that would break on any pi release — we tag the summary text with a
 * marker, then find and replace whichever input item carries it.
 *
 * That makes the swap positional-assumption-free: it works whether the summary
 * lands as a user message, a developer message, or something introduced later,
 * and it degrades to "change nothing" the moment the marker is absent.
 */

import { isCompactionArtifact, type CompactionArtifact } from "./protocol.ts";

/** Deliberately ugly, so it cannot collide with prose a summarizer would write. */
const MARKER_PREFIX = "⟦codex-compaction:";
const MARKER_SUFFIX = "⟧";

export function artifactMarker(id: string): string {
  return `${MARKER_PREFIX}${id}${MARKER_SUFFIX}`;
}

/**
 * Prefix a portable summary with its marker.
 *
 * The human-readable summary stays intact underneath: if the artifact is ever
 * unusable — different model, revoked beta flag, session opened on another
 * machine — the session still reads as a normal compacted pi session.
 */
export function markSummary(id: string, summary: string): string {
  return `${artifactMarker(id)}\n${summary}`;
}

export function extractMarkerId(text: string): string | undefined {
  const start = text.indexOf(MARKER_PREFIX);
  if (start === -1) return undefined;
  const from = start + MARKER_PREFIX.length;
  const end = text.indexOf(MARKER_SUFFIX, from);
  if (end === -1) return undefined;
  const id = text.slice(from, end);
  return id.length > 0 ? id : undefined;
}

/** Strip the marker for display; the summary underneath is what a human wants. */
export function stripMarker(text: string): string {
  const id = extractMarkerId(text);
  if (!id) return text;
  return text
    .replace(`${artifactMarker(id)}\n`, "")
    .replace(artifactMarker(id), "");
}

/** Every string anywhere in an input item, so the marker is found wherever pi put it. */
function itemText(item: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (typeof item === "string") return item;
  if (Array.isArray(item))
    return item.map((v) => itemText(v, depth + 1)).join("\n");
  if (typeof item === "object" && item !== null) {
    return Object.values(item as Record<string, unknown>)
      .map((v) => itemText(v, depth + 1))
      .join("\n");
  }
  return "";
}

/**
 * A marker only counts when it opens a line.
 *
 * `markSummary` puts it first, so a real compaction summary always satisfies
 * this. Quoted prose does not: asking "what does ⟦codex-compaction:cmp_1⟧
 * mean?" would otherwise see that whole user message replaced by the artifact,
 * losing the question. The same applies to a tool that reads the session file
 * and hands back its contents.
 */
function leadingMarkerId(text: string): string | undefined {
  for (const line of text.split("\n")) {
    if (!line.startsWith(MARKER_PREFIX)) continue;
    const id = extractMarkerId(line);
    if (id) return id;
  }
  return undefined;
}

/** Items carrying tool traffic, which is never pi's compaction summary. */
function isToolShaped(item: unknown): boolean {
  if (typeof item !== "object" || item === null) return false;
  const record = item as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  const role = typeof record.role === "string" ? record.role : "";
  return (
    type.startsWith("function_call") ||
    type === "tool_result" ||
    role === "tool" ||
    role === "toolResult"
  );
}

export interface SwapResult {
  readonly input: readonly unknown[];
  /** Marker ids seen in the input, whether or not an artifact was available. */
  readonly seen: readonly string[];
  readonly swapped: number;
}

/**
 * Replace every marked summary item with its artifact.
 *
 * `lookup` returning undefined means "keep the text summary" — the correct
 * behaviour when the artifact belongs to a different model, or when a session
 * was reloaded somewhere the artifact never followed.
 */
export function swapArtifacts(
  input: readonly unknown[],
  lookup: (id: string) => CompactionArtifact | undefined,
): SwapResult {
  const seen: string[] = [];
  const used = new Set<string>();
  let swapped = 0;
  const next = input.map((item) => {
    if (isToolShaped(item)) return item;
    const id = leadingMarkerId(itemText(item));
    if (!id) return item;
    seen.push(id);
    // One artifact replaces one summary. Without this, a session that quotes
    // its own marker twice would send the same artifact twice, which is at
    // best wasted context and at worst a rejected request.
    if (used.has(id)) return item;
    const artifact = lookup(id);
    if (!artifact || !isCompactionArtifact(artifact)) return item;
    used.add(id);
    swapped += 1;
    return artifact;
  });
  return { input: next, seen, swapped };
}
