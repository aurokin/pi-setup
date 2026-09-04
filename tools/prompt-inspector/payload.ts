import { byteLength } from "../../extensions/shared/prompt-sections.ts";

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
  /** Absolute path, for a skill catalogue entry. Tools have none. */
  readonly location?: string;
  /**
   * The full body behind the entry, when there is one worth reading and we
   * are allowed to read it: a tool's pretty-printed JSON schema, or the
   * `SKILL.md` of a skill this repo owns. Absent means "nothing more to show",
   * never "empty".
   */
  readonly body?: SkillBody;
}

/** A file's contents, resolved outside this module to keep the renderer pure. */
export interface SkillBody {
  readonly text: string;
  readonly bytes: number;
  /** Shown so a reader can tell a generated skill from a checked-in one. */
  readonly origin: string;
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
      // Pretty-printed rather than the wire form, because the point of showing
      // it is that someone reads the parameter descriptions.
      const pretty = JSON.stringify(tool, null, 2);
      return {
        name: String(fn?.name ?? "(unnamed)"),
        description: String(fn?.description ?? ""),
        text,
        bytes: byteLength(text),
        body: {
          text: pretty,
          bytes: byteLength(text),
          origin: "sent this turn",
        },
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
 *
 * `bodies` attaches the `SKILL.md` behind an entry when the runner resolved
 * one. That body is not part of this turn's prompt — it is what the model will
 * read if it follows the advertisement — and the page says so.
 */
export function readSkills(
  text: string,
  bodies: Readonly<Record<string, SkillBody>> = {},
): PromptTool[] {
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
      const location = /<location>([\s\S]*?)<\/location>/
        .exec(block)?.[1]
        ?.trim();
      return {
        name: name || "(unnamed)",
        description: description ?? "",
        text: entry[0]!,
        bytes: byteLength(entry[0]!),
        location,
        body: location ? bodies[location] : undefined,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
}
