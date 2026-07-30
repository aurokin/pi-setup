/**
 * `/effort` — pick the thinking level for this session, per model.
 *
 * pi already has this on a key (`app.thinking.cycle`), and cycling is the wrong
 * shape for a scale with seven positions: to reach `low` from `high` you press
 * the key until it wraps, watching the footer. A menu shows the whole scale at
 * once, says which level is in force, and only offers the levels the *current
 * model* actually supports — which is the part cycling cannot show you at all.
 *
 * "Effort" is the word people reach for; pi's own UI says "thinking level".
 * Same setting, and the command is named for the word you would type.
 *
 * The widget is pi's own `ThinkingSelectorComponent`, so this looks and behaves
 * exactly like the selector behind the keybinding rather than a lookalike that
 * would drift from it. The choosing is in `src/levels.ts`, where it can be
 * tested without a terminal.
 */

import {
  ThinkingSelectorComponent,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  getSupportedThinkingLevels,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import { describe, initialSelection, resolveArgument } from "./src/levels.ts";

function openPicker(
  ctx: ExtensionCommandContext,
  current: ModelThinkingLevel | undefined,
  supported: ModelThinkingLevel[],
) {
  const selected = initialSelection(current, supported);
  if (!selected) return Promise.resolve(undefined);

  return ctx.ui.custom<ModelThinkingLevel | undefined>(
    (tui, _theme, _keybindings, done) => {
      const selector = new ThinkingSelectorComponent(
        selected,
        supported,
        (level) => done(level),
        () => done(undefined),
      );
      const list = selector.getSelectList();
      return {
        render: (width) => selector.render(width),
        invalidate: () => selector.invalidate(),
        handleInput: (data) => {
          list.handleInput(data);
          tui.requestRender();
        },
      };
    },
  );
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("effort", {
    description:
      "Choose the thinking level for this session, from the levels the current model supports",
    handler: async (args, ctx) => {
      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("No model is selected.", "error");
        return;
      }

      const name = `${model.provider}/${model.id}`;
      const supported = getSupportedThinkingLevels(model);
      const current = pi.getThinkingLevel() as ModelThinkingLevel;

      const resolved = resolveArgument(args, supported);
      if (resolved.kind === "error") {
        ctx.ui.notify(resolved.message, "error");
        return;
      }

      if (resolved.kind === "set") {
        pi.setThinkingLevel(resolved.level);
        ctx.ui.notify(`Effort: ${resolved.level} · ${name}`, "info");
        return;
      }

      // No argument. A menu needs a terminal; everywhere else, report the state
      // rather than failing, since `/effort` with no argument is a fair way to
      // ask what the level currently is.
      if (ctx.mode !== "tui") {
        ctx.ui.notify(describe(name, current, supported), "info");
        return;
      }

      if (supported.length === 0) {
        ctx.ui.notify(`${name} has no thinking levels.`, "warning");
        return;
      }

      const chosen = await openPicker(ctx, current, supported);
      if (chosen === undefined) return;

      pi.setThinkingLevel(chosen);
      ctx.ui.notify(`Effort: ${chosen} · ${name}`, "info");
    },
  });
}
