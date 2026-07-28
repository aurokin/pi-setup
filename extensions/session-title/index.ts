/**
 * Name the session after the work, so the pane title says what it is doing.
 *
 * pi titles its terminal `π - [name -] <cwd>`, and with no name that is just a
 * directory. Fine with one pi open; useless with six, which is the normal shape
 * of this setup now that workflows, subagents and a primary runtime each want
 * their own pane. Tools that read tmux titles — `agentscan`, the tmux status
 * line — show the directory six times and tell you nothing.
 *
 * `setSessionName` is the supported channel, and the only one that survives.
 * `ctx.ui.setTitle` looks like the obvious API and is not: pi core re-applies
 * its own title on init, on extension rebind, and on every `session_info_changed`
 * event, and its init call runs *after* extensions bind — so a title set that
 * way is overwritten before the first turn. Setting the name instead makes
 * core rebuild the title it already controls.
 *
 * Named once, from the first prompt, and never again: `setSessionName` appends
 * an entry to the session file and renames the session in the picker, so a name
 * that chased the current activity would churn both. `/rename` is there for
 * when the first prompt was not what the session turned out to be about.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { deriveSessionName } from "./src/name.ts";

export default function sessionTitle(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    // Only the first prompt, and only when nothing has named the session yet —
    // a resumed session and a manual /rename both already have one, and neither
    // should be talked over by whatever was typed next.
    if (pi.getSessionName()) return;
    const name = deriveSessionName(event.prompt);
    if (name) pi.setSessionName(name);
  });

  pi.registerCommand("rename", {
    description:
      "Rename this session, which retitles the terminal (`/rename <name>`)",
    handler: async (args, ctx) => {
      const name = args.trim().replace(/\s+/g, " ");
      if (name.length === 0) {
        const current = pi.getSessionName();
        ctx.ui.notify(
          current
            ? `Session name: ${current}\nChange it with /rename <name>.`
            : "This session has no name yet. Set one with /rename <name>.",
          "info",
        );
        return;
      }

      pi.setSessionName(name);
      ctx.ui.notify(`Session renamed to: ${name}`, "info");
    },
  });
}
