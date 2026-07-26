/**
 * /goal - an objective that outlives the turn that set it.
 *
 * Long sessions drift. Twenty turns after "ship the auth migration" the model
 * is deep in a test helper, and nothing in its context still says what the test
 * helper was for. A goal is the fix: one line, re-stated in the system prompt
 * every turn, persisted in the session so it survives a resume.
 *
 * The design decision worth defending is the authority split, taken from codex
 * (`codex-rs/ext/goal/`): the user owns the goal, and the model may only report
 * `complete` or `blocked` against it. A goal the model can edit is a note it
 * keeps to itself; a goal it can clear is one that disappears the moment the
 * work gets hard. Enforced in `src/goal.ts`, not here.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  applyModelUpdate,
  createGoal,
  isLive,
  pause,
  renderForPrompt,
  renderForUser,
  resume,
  type Goal,
} from "./src/goal.ts";
import { GOAL_ENTRY_TYPE, latestGoal, toPersisted } from "./src/persistence.ts";

const GoalUpdateParams = Type.Object({
  // Spelled out rather than derived from MODEL_STATUSES: a mapped array widens
  // to string and the schema stops constraining anything. `goal.test.ts` pins
  // the two lists together instead.
  status: Type.Union([Type.Literal("complete"), Type.Literal("blocked")], {
    description:
      "`complete` when the goal is met. `blocked` when you cannot proceed without the user.",
  }),
  note: Type.String({
    description:
      "One or two sentences. For `complete`, what was delivered. For `blocked`, the specific thing you need from the user.",
  }),
});

export type GoalUpdateInput = Static<typeof GoalUpdateParams>;

export default function goalExtension(pi: ExtensionAPI) {
  let goal: Goal | undefined;

  const persist = (next: Goal | undefined) => {
    goal = next;
    pi.appendEntry(GOAL_ENTRY_TYPE, toPersisted(next));
  };

  const say = (text: string) =>
    pi.sendMessage({ customType: "goal", content: text, display: true });

  // Load on every navigation boundary, not just startup: a fork or a /tree move
  // lands on a different branch, and that branch's goal is whatever its own
  // entries say it is — possibly none.
  const load = (ctx: { sessionManager?: { getEntries?: () => unknown[] } }) => {
    goal = latestGoal(ctx.sessionManager?.getEntries?.() ?? []);
  };

  pi.on("session_start", async (_event, ctx) => load(ctx));
  pi.on("session_tree", async (_event, ctx) => load(ctx));

  /**
   * Put the goal in front of the model, every turn.
   *
   * The system prompt rather than a message, because a message is history: it
   * scrolls away, and compaction may summarize it into something weaker than
   * what the user wrote. The system prompt is re-assembled every turn, so the
   * goal is as present on turn fifty as on turn one.
   */
  pi.on("before_agent_start", async (event) => {
    if (!isLive(goal)) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${renderForPrompt(goal)}`,
    };
  });

  pi.registerTool({
    name: "goal_update",
    label: "Goal",
    description: `Report on the current goal. \`complete\` when it is met; \`blocked\` when you need something only the user can provide.

You cannot set, reword, pause, or clear a goal — those are the user's. If you think the goal is wrong, say so and ask.`,
    promptSnippet:
      "goal_update: report the current goal complete or blocked (you cannot change it)",
    parameters: GoalUpdateParams,
    async execute(_toolCallId, params) {
      const result = applyModelUpdate(
        goal,
        params.status,
        params.note.trim() || undefined,
        Date.now(),
      );
      if ("error" in result) {
        return {
          content: [{ type: "text", text: result.error }],
          isError: true,
          details: undefined,
        };
      }
      persist(result.goal);
      return {
        content: [
          {
            type: "text",
            text: `Goal marked ${result.goal.status}. The user has been told, and it is out of your context from the next turn — do not keep working on it unless they reopen it.`,
          },
        ],
        details: { status: result.goal.status, note: result.goal.note },
      };
    },
  });

  pi.registerCommand("goal", {
    description: "Set a goal that persists across turns (`/goal <text>`)",
    async handler(args, ctx) {
      const input = args.trim();
      const now = Date.now();
      // The session may have been switched since the last load.
      if (!goal) load(ctx);

      if (input.length === 0) return say(renderForUser(goal, now));

      switch (input) {
        case "clear":
          if (!goal) return say("No goal set.");
          persist(undefined);
          return say("Goal cleared.");
        case "pause":
          if (!goal) return say("No goal to pause.");
          persist(pause(goal, now));
          return say(
            "Goal paused. It is out of the model's context until you `/goal resume`.",
          );
        case "resume":
          if (!goal) return say("No goal to resume.");
          persist(resume(goal, now));
          return say("Goal resumed.");
      }

      const created = createGoal(input, now);
      if ("error" in created) return say(created.error);
      // Replacing rather than refusing: the alternative is making the user
      // clear first, and a goal that is hard to change is one that goes stale.
      const replaced = goal !== undefined;
      persist(created);
      return say(
        `${replaced ? "Goal replaced" : "Goal set"}: ${created.text}\n` +
          "It rides along in every turn until you `/goal clear`. The model can only report it complete or blocked.",
      );
    },
    getArgumentCompletions(prefix) {
      const verbs = goal ? ["clear", "pause", "resume"] : [];
      const matches = verbs.filter((verb) => verb.startsWith(prefix));
      return matches.length > 0
        ? matches.map((verb) => ({ value: verb, label: verb }))
        : null;
    },
  });
}
