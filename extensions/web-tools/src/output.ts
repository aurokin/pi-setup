import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import type {
  ImageEntry,
  PageEntry,
  ProviderResult,
  SearchEntry,
  WebBackend,
} from "./types.ts";

function metadataLines(entry: SearchEntry) {
  const lines = [`URL: ${entry.url}`];
  if (entry.publishedDate) lines.push(`Published: ${entry.publishedDate}`);
  if (entry.author) lines.push(`Author: ${entry.author}`);
  return lines;
}

export function formatSearchEntries(entries: readonly SearchEntry[]) {
  if (entries.length === 0) return "No search results returned.";
  return entries
    .map((entry, index) => {
      const heading = `## ${index + 1}. ${entry.title?.trim() || entry.url}`;
      const excerpt = entry.excerpt?.trim();
      return [heading, ...metadataLines(entry), excerpt]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export function formatPageEntries(entries: readonly PageEntry[]) {
  if (entries.length === 0) return "No page content returned.";
  return entries
    .map((entry, index) => {
      const heading =
        entries.length === 1
          ? `# ${entry.title?.trim() || entry.url}`
          : `## ${index + 1}. ${entry.title?.trim() || entry.url}`;
      return [heading, ...metadataLines(entry), entry.text?.trim()]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export function formatImageEntries(entries: readonly ImageEntry[]) {
  if (entries.length === 0) return "No image results returned.";
  return entries
    .map((entry, index) => {
      const lines = [
        `## ${index + 1}. ${entry.title?.trim() || "Image"}`,
        `Image: ${entry.imageUrl}`,
      ];
      if (entry.sourceUrl) lines.push(`Source: ${entry.sourceUrl}`);
      if (entry.width && entry.height) {
        lines.push(`Dimensions: ${entry.width}×${entry.height}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

export function providerResult(
  backend: WebBackend,
  output: string,
  raw: unknown,
  costDollars?: number,
): ProviderResult {
  const footer = [
    `Backend: ${backend}`,
    costDollars === undefined
      ? undefined
      : `Reported request cost: $${costDollars.toFixed(6)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    output: `${output.trim()}\n\n---\n${footer}`,
    details: { backend, costDollars, raw },
  };
}

export async function truncateWebOutput(output: string, operation: string) {
  const truncation = truncateHead(output, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  if (!truncation.truncated) return output;

  const outputDirectory = await mkdtemp(join(tmpdir(), "pi-web-tools-"));
  const outputPath = join(outputDirectory, `${operation}.txt`);
  await writeFile(outputPath, output, "utf8");

  return `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${outputPath}]`;
}
