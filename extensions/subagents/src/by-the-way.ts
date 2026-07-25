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

function toolCallIds(message: ContextMessage): string[] {
  const content = (message as { content?: unknown }).content;
  if (message.role !== "assistant" || !Array.isArray(content)) return [];
  return content
    .filter(
      (part): part is { type: "toolCall"; id: string } =>
        !!part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "toolCall",
    )
    .map((part) => part.id);
}

/**
 * Drop a tool turn the parent has not finished.
 *
 * A side question asked while the parent is running a tool sees the assistant
 * message that requested it but not the result — the result does not exist
 * yet. Copied as-is, the child's next request carries a tool call with nothing
 * answering it, which Anthropic rejects outright and other providers accept
 * only by luck. A partially answered turn is the same problem: results cannot
 * be invented for the calls still outstanding, so the whole turn goes.
 *
 * Only the tail can be incomplete — everything earlier ran to completion — so
 * this truncates rather than filters, and what it removes is a tool call whose
 * outcome the child could not have used anyway.
 */
function withoutUnfinishedToolTurn(
  messages: readonly ContextMessage[],
): readonly ContextMessage[] {
  const answered = new Set(
    messages
      .filter((message) => message.role === "toolResult")
      .map((message) => (message as { toolCallId: string }).toolCallId),
  );
  const incomplete = messages.findIndex((message) =>
    toolCallIds(message).some((id) => !answered.has(id)),
  );
  return incomplete === -1 ? messages : messages.slice(0, incomplete);
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
  return withoutUnfinishedToolTurn(messages).map((message) => {
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
