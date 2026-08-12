import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  INLINE_GOAL_CHANNEL,
  type InlineGoalRequest,
} from "../shared/inline-commands.ts";
import {
  InlineSlashEditor,
  wrapInlineAutocomplete,
} from "./src/autocomplete.ts";
import {
  buildCatalog,
  loadSkills,
  prepareInlineText,
  renderSkillInvocation,
} from "./src/transform.ts";

export default function inlineCommands(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.addAutocompleteProvider((current) =>
      wrapInlineAutocomplete(current, () => pi.getCommands()),
    );
    // Do not trample a user's modal/custom editor. Inline completion still
    // works there with Tab; the default editor gains natural slash triggering.
    if (!ctx.ui.getEditorComponent()) {
      ctx.ui.setEditorComponent(
        (tui, theme, keybindings) =>
          new InlineSlashEditor(tui, theme, keybindings),
      );
    }
  });

  pi.on("input", (event, ctx) => {
    // Extension-authored messages are data, not another opportunity to execute
    // syntax that happened to appear in generated text.
    if (event.source === "extension") return { action: "continue" };

    const catalog = buildCatalog(pi.getCommands());
    const prepared = prepareInlineText(event.text, catalog, (path) =>
      readFileSync(path, "utf8"),
    );
    for (const error of prepared.errors) ctx.ui.notify(error, "warning");
    if (!prepared.changed) return { action: "continue" };

    // Preserve Pi's exact existing behavior and rendering for the common
    // leading, single-skill form. Everything more compositional is ours.
    if (
      prepared.goalText === undefined &&
      !prepared.templateExpanded &&
      prepared.skillReferenceCount === 1 &&
      prepared.skills.length === 1 &&
      startsWithCommand(event.text, `/${prepared.skills[0]!.name}`)
    ) {
      return { action: "continue" };
    }

    let text = prepared.textWithGoal;
    if (prepared.goalText !== undefined) {
      const request: InlineGoalRequest = {
        text: prepared.goalText,
        ctx,
        handled: false,
      };
      // EventBus dispatch is synchronous. Goal's listener mutates this request
      // before emit() returns; no command handler or nested prompt is involved.
      pi.events.emit(INLINE_GOAL_CHANNEL, request);
      if (request.handled) {
        text = prepared.text;
        ctx.ui.notify(
          `${request.replaced ? "Goal replaced" : "Goal set"} from this prompt.`,
          "info",
        );
      } else {
        ctx.ui.notify(
          request.error ??
            "Inline /goal is unavailable, so the marker was left as text.",
          "warning",
        );
      }
    }

    const loaded = loadSkills(prepared.skills, (path) =>
      readFileSync(path, "utf8"),
    );
    for (const error of loaded.errors) ctx.ui.notify(error, "warning");
    const expanded = renderSkillInvocation(loaded.skills, text);
    return expanded === event.text
      ? { action: "continue" }
      : { action: "transform", text: expanded };
  });
}

function startsWithCommand(text: string, command: string) {
  if (!text.startsWith(command)) return false;
  const next = text[command.length];
  return next === undefined || /\s/.test(next);
}
