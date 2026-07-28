/**
 * Measuring a system prompt, and attributing its parts to who contributed them.
 *
 * Shared because two things need it and must not disagree: the offline
 * `tools/prompt-inspector` report, and the live `/context-budget` command. If
 * they measured differently, comparing them would be meaningless — and
 * comparing them is the point, since one captures the real wire payload and the
 * other reads the running session.
 *
 * Token figures are `chars / 4`. Honest for comparing two sections, wrong for
 * anything needing a real number, so callers say so rather than printing a
 * total that looks authoritative.
 */

/** Exported so callers can label the estimate with the divisor they got. */
export const CHARS_PER_TOKEN = 4;

export interface PromptSection {
  readonly heading: string;
  readonly body: string;
  readonly bytes: number;
}

export function estimateTokens(text: string) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * UTF-8 bytes, which is what actually goes over the wire. `String.length`
 * counts UTF-16 code units, so anything non-ASCII — an em dash, an arrow, a
 * smart quote, all of which this prompt is full of — reads as smaller than it
 * is under a column headed "bytes".
 */
export function byteLength(text: string) {
  return Buffer.byteLength(text, "utf8");
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Top-level containers pi wraps around anything it did not write itself:
 * project context files, the skills catalogue, and so on. Splitting on these
 * first is what keeps attribution honest — markdown headings alone run
 * straight through a `</project_instructions>` boundary and charge the next
 * contributor's bytes to whichever heading happened to come last.
 */
const BLOCK_PATTERN = /^<([a-z][a-z0-9_-]*)>\n([\s\S]*?)\n<\/\1>$/gm;

/**
 * Split prompt text into what it is actually made of.
 *
 * Wrapped blocks become one section each, named for their tag. The text
 * between them is pi's own prompt, which has no such markers, so that is split
 * on markdown headings — useful, and safe now that it cannot cross into
 * someone else's contribution. Text before the first heading is kept as
 * "(preamble)" rather than dropped: on a real prompt it is the base
 * instructions and one of the largest pieces.
 */
export function splitSections(text: string): PromptSection[] {
  if (!text.trim()) return [];
  const sections: PromptSection[] = [];
  let cursor = 0;

  const headingSplit = (chunk: string) => {
    if (!chunk.trim()) return;
    let heading = "(preamble)";
    let body: string[] = [];
    const flush = () => {
      const joined = body.join("\n");
      if (joined.trim()) {
        sections.push({ heading, body: joined, bytes: byteLength(joined) });
      }
      body = [];
    };
    for (const line of chunk.split("\n")) {
      const match = /^(#{1,6})\s+(.*)$/.exec(line);
      if (match) {
        flush();
        heading = match[2]!.trim() || "(untitled)";
      }
      // Heading lines included: they are part of what the section costs.
      // Keeping only the label meant the sections never summed to the
      // instruction total, and long headings went missing entirely.
      body.push(line);
    }
    flush();
  };

  BLOCK_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(BLOCK_PATTERN)) {
    headingSplit(text.slice(cursor, match.index));
    const body = match[0]!;
    sections.push({
      heading: `<${match[1]}>`,
      body,
      bytes: byteLength(body),
    });
    // Still `.length`: this is a string index into `text`, not a size.
    cursor = match.index + body.length;
  }
  headingSplit(text.slice(cursor));

  // A prompt with no headings and no blocks is still one section, not none.
  if (sections.length === 0) {
    sections.push({
      heading: "(preamble)",
      body: text,
      bytes: byteLength(text),
    });
  }
  return sections;
}
