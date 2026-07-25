import type { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { ForkedMessage, SubagentOrigin } from "./domain.ts";

/** What the parent's context is made of, per the SDK's own converter. */
type ContextMessage = ReturnType<typeof sessionEntryToContextMessages>[number];

export const BTW_TITLE_MAX_LENGTH = 60;

/** Build a compact dashboard title from the first non-empty prompt line. */
export function deriveBtwTitle(prompt: string) {
  const firstLine = prompt
    .split("\n")
    .find((line) => line.trim())
    ?.trim();
  const title = firstLine?.replace(/\s+/g, " ") ?? "";
  if (!title) return "by the way";
  const codePoints = Array.from(title);
  if (codePoints.length <= BTW_TITLE_MAX_LENGTH) return title;
  return `${codePoints.slice(0, BTW_TITLE_MAX_LENGTH - 1).join("")}…`;
}

/** User asides remain visible in the dashboard but hidden from model tools. */
export function isModelVisible(snap: { readonly origin: SubagentOrigin }) {
  return snap.origin === "model";
}

/**
 * The parent's context, as messages a child session can actually hold.
 *
 * `buildContextEntries()` is compaction-aware, so a long conversation arrives
 * as a summary followed by the messages kept after it. Those summaries are not
 * something `appendMessage` takes — and dropping them would silently discard
 * everything the parent said before its last compaction, which on a long
 * thread is most of it. They cross over as text instead.
 */
export function forkableMessages(
  messages: readonly ContextMessage[],
): ForkedMessage[] {
  return messages.map((message) => {
    if (
      message.role !== "branchSummary" &&
      message.role !== "compactionSummary"
    )
      return message;
    return {
      role: "user",
      content: `[summary of earlier conversation]\n${message.summary}`,
      timestamp: message.timestamp,
    };
  });
}
