/**
 * /goal - an objective that outlives the turn that set it.
 *
 * Long sessions drift. Twenty turns after "ship the auth migration" the model
 * is deep in a test helper, and nothing in its context still says what the test
 * helper was for. A goal is the fix: one line re-stated in the system prompt,
 * persisted across resumes, and automatically continued whenever the agent
 * settles without an independently verified completion or blocker.
 *
 * The design decision worth defending is the authority split, taken from codex
 * (`codex-rs/ext/goal/`): the user owns the goal, and the model may only report
 * `complete` or `blocked` against it. Those reports are provisional until a
 * fresh read-only child verifies them with the primary run's model and effort.
 * A goal the model can edit is a note it keeps to itself; a goal it can clear
 * is one that disappears the moment the work gets hard. Enforced in
 * `src/goal.ts`, not here.
 */

import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  applyModelUpdate,
  confirmClaim,
  createGoal,
  isLive,
  pause,
  rejectClaim,
  renderForPrompt,
  renderForUser,
  resume,
  settlementAction,
  stopAfterRunFailure,
  type Goal,
} from "./src/goal.ts";
import { GOAL_ENTRY_TYPE, latestGoal, toPersisted } from "./src/persistence.ts";
import {
  buildVerifierEvidence,
  raceWithAbortDeadline,
  verifyGoalClaim,
} from "./src/verifier.ts";

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

const VERIFICATION_TIMEOUT_MS = 10 * 60_000;

export default function goalExtension(pi: ExtensionAPI) {
  let goal: Goal | undefined;
  let generation = 0;
  let continuationQueued = false;
  let verificationAbort: AbortController | undefined;
  let clearVerificationStatus: (() => void) | undefined;
  let activeRunGeneration: number | undefined;
  let activeRunId: string | undefined;
  let activeRunAborted = false;
  let activeRunHadLiveGoal = false;
  let lastRun:
    | {
        model: NonNullable<ExtensionContext["model"]>;
        thinkingLevel: ExtensionContext["thinkingLevel"];
      }
    | undefined;

  const invalidateAsyncWork = () => {
    generation++;
    continuationQueued = false;
    activeRunGeneration = undefined;
    lastRun = undefined;
    clearVerificationStatus?.();
    clearVerificationStatus = undefined;
    verificationAbort?.abort();
    verificationAbort = undefined;
  };

  const persist = (next: Goal | undefined) => {
    invalidateAsyncWork();
    goal = next;
    pi.appendEntry(GOAL_ENTRY_TYPE, toPersisted(next));
  };

  const say = (text: string) =>
    pi.sendMessage({ customType: "goal", content: text, display: true });

  const interruptGoalRun = (
    ctx: Pick<ExtensionContext, "abort" | "isIdle">,
  ) => {
    if (ctx.isIdle() || (!activeRunHadLiveGoal && !continuationQueued)) {
      return false;
    }
    ctx.abort();
    return true;
  };

  const continueGoal = (
    ctx: Pick<ExtensionContext, "isIdle" | "ui">,
    content: string,
    display = false,
  ) => {
    // Never queue behind another run. If the goal changes while that run is
    // active, pi cannot retract the queued message. Its agent_settled event is
    // the safe point to re-read current state and decide whether to continue.
    if (!ctx.isIdle() || !isLive(goal) || continuationQueued) return;
    continuationQueued = true;
    try {
      pi.sendMessage(
        { customType: "goal-continuation", content, display },
        { deliverAs: "followUp", triggerTurn: true },
      );
    } catch (error) {
      continuationQueued = false;
      ctx.ui.notify(
        `Could not start goal continuation: ${error instanceof Error ? error.message : String(error)}. The goal remains active; /goal resume retries it.`,
        "error",
      );
    }
  };

  // Load the active branch on every navigation boundary. getEntries() includes
  // abandoned siblings, whose later append order must not choose this branch's
  // goal for it.
  const load = (ctx: Pick<ExtensionContext, "sessionManager">) => {
    invalidateAsyncWork();
    goal = latestGoal(ctx.sessionManager.getBranch());
  };

  pi.on("session_shutdown", async () => invalidateAsyncWork());

  pi.on("agent_start", async (_event, ctx) => {
    // A user can start another primary run while detached verification is in
    // flight. Its edits would make the child's workspace evidence stale, so
    // cancel now; the pending claim is retried when this new run settles.
    if (verificationAbort) {
      generation++;
      clearVerificationStatus?.();
      clearVerificationStatus = undefined;
      verificationAbort.abort();
      verificationAbort = undefined;
    }
    continuationQueued = false;
    activeRunGeneration = generation;
    activeRunId = randomUUID();
    const runId = activeRunId;
    activeRunAborted = ctx.signal?.aborted ?? false;
    ctx.signal?.addEventListener(
      "abort",
      () => {
        if (activeRunId === runId) activeRunAborted = true;
      },
      { once: true },
    );
    activeRunHadLiveGoal = isLive(goal);
    lastRun = ctx.model
      ? { model: ctx.model, thinkingLevel: ctx.thinkingLevel }
      : undefined;
  });

  pi.on("agent_end", async (event) => {
    const lastAssistant = [...event.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    const failed =
      activeRunAborted ||
      !lastAssistant ||
      (lastAssistant.role === "assistant" &&
        (lastAssistant.stopReason === "error" ||
          lastAssistant.stopReason === "aborted" ||
          lastAssistant.errorMessage !== undefined));
    if (
      goal?.claim?.sourceRunId !== undefined &&
      goal.claim.sourceRunId === activeRunId
    ) {
      persist({
        ...goal,
        claim: {
          ...goal.claim,
          sourceRunOutcome: failed ? "failed" : "succeeded",
        },
        updatedAt: Date.now(),
      });
    } else if (failed && activeRunGeneration === generation && isLive(goal)) {
      persist(stopAfterRunFailure(goal, Date.now()));
    }
    activeRunHadLiveGoal = false;
    activeRunAborted = false;
    activeRunGeneration = undefined;
    activeRunId = undefined;
  });

  const startVerification = (ctx: ExtensionContext) => {
    if (verificationAbort || !goal?.claim) return;
    const claimedGoal = goal as Goal & { claim: NonNullable<Goal["claim"]> };
    const claimedGeneration = generation;
    const claimedModel = claimedGoal.claim.model
      ? ctx.modelRegistry.find(
          claimedGoal.claim.model.provider,
          claimedGoal.claim.model.id,
        )
      : undefined;
    if (claimedGoal.claim.model && !claimedModel) {
      ctx.ui.notify(
        `Goal verification could not find the claim-producing model ${claimedGoal.claim.model.provider}/${claimedGoal.claim.model.id}. The claim remains pending; /goal resume reopens it.`,
        "error",
      );
      return;
    }
    const run = claimedModel
      ? {
          model: claimedModel,
          thinkingLevel: claimedGoal.claim.thinkingLevel ?? ctx.thinkingLevel,
        }
      : (lastRun ??
        (ctx.model
          ? { model: ctx.model, thinkingLevel: ctx.thinkingLevel }
          : undefined));
    if (!run) {
      ctx.ui.notify(
        "Goal verification could not start because the primary run had no model. The claim remains pending; /goal resume reopens it.",
        "error",
      );
      return;
    }

    const controller = new AbortController();
    verificationAbort = controller;
    const clearStatus = () => ctx.ui.setStatus("goal", undefined);
    const clearStatusIfOwner = () => {
      if (clearVerificationStatus !== clearStatus) return;
      clearStatus();
      clearVerificationStatus = undefined;
    };
    clearVerificationStatus = clearStatus;
    ctx.ui.setStatus("goal", `verifying ${claimedGoal.claim.status}`);

    // agent_settled handlers are awaited serially. Verification is deliberately
    // detached so one child model call cannot hold every later settled hook or
    // waitForIdle() open. Generation and object identity fence stale results.
    void (async () => {
      const attempt = await raceWithAbortDeadline(
        verifyGoalClaim({
          goal: claimedGoal,
          cwd: ctx.cwd,
          projectTrusted: ctx.isProjectTrusted(),
          model: run.model,
          thinkingLevel: run.thinkingLevel,
          modelRegistry: ctx.modelRegistry,
          evidence: buildVerifierEvidence(ctx.sessionManager.getBranch()),
          signal: controller.signal,
        }),
        controller,
        VERIFICATION_TIMEOUT_MS,
      );

      if (attempt.status === "aborted") return;
      if (attempt.status === "timed_out") {
        if (generation === claimedGeneration && goal === claimedGoal) {
          verificationAbort = undefined;
          clearStatusIfOwner();
          ctx.ui.notify(
            "Goal verification timed out. The claim remains pending; /goal resume reopens it.",
            "error",
          );
        }
        return;
      }
      const verdict = attempt.value;

      // The user may have paused, replaced, cleared, or resumed the goal while
      // verification was running. Such a result belongs to the old generation.
      if (
        controller.signal.aborted ||
        generation !== claimedGeneration ||
        goal !== claimedGoal
      ) {
        return;
      }
      verificationAbort = undefined;
      clearStatusIfOwner();

      if ("error" in verdict) {
        ctx.ui.notify(
          `Goal verification failed: ${verdict.error}. The claim remains pending; /goal resume reopens it.`,
          "error",
        );
        return;
      }

      if (verdict.confirmed) {
        const confirmed = confirmClaim(claimedGoal, Date.now());
        if (!confirmed) return;
        const status = claimedGoal.claim.status;
        persist(confirmed);
        say(`Goal ${status} confirmed. ${verdict.context}`.trim());
        return;
      }

      const mayContinue = claimedGoal.claim.sourceRunOutcome === "succeeded";
      const rejected = rejectClaim(claimedGoal, verdict.context, Date.now());
      persist(
        mayContinue ? rejected : stopAfterRunFailure(rejected, Date.now()),
      );
      if (!mayContinue) {
        ctx.ui.notify(
          "Goal verification rejected the claim, but the claim-producing run ended with an error or cancellation. The goal remains active; /goal resume retries it.",
          "error",
        );
        return;
      }
      continueGoal(
        ctx,
        "Independent verification rejected the claim. Continue working toward the active goal and use its verifier context as evidence.",
        true,
      );
    })().catch((error) => {
      if (generation !== claimedGeneration || goal !== claimedGoal) return;
      verificationAbort = undefined;
      clearStatusIfOwner();
      ctx.ui.notify(
        `Goal verification failed: ${error instanceof Error ? error.message : String(error)}. The claim remains pending; /goal resume reopens it.`,
        "error",
      );
    });
  };

  const resumeIdleGoal = (ctx: ExtensionContext) => {
    const expectedGeneration = generation;
    queueMicrotask(() => {
      if (generation !== expectedGeneration) return;
      const action = settlementAction(goal);
      if (action === "verify") startVerification(ctx);
      else if (action === "continue") {
        continueGoal(ctx, "Continue working toward the active goal.");
      }
    });
  };

  pi.on("session_start", async (_event, ctx) => {
    load(ctx);
    resumeIdleGoal(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    load(ctx);
    resumeIdleGoal(ctx);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const action = settlementAction(goal);
    if (action === "continue") {
      // Deliberately unbounded across successful runs: persistence is the
      // defining /goal behavior. /goal pause and /goal clear are the user-owned
      // stop controls; a hidden cap would turn this into a one-shot prompt.
      continueGoal(ctx, "Continue working toward the active goal.");
    } else if (action === "verify") {
      startVerification(ctx);
    }
  });

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
    description: `Report on the current active goal. \`complete\` when it is met; \`blocked\` when you need something only the user can provide.

Call this tool only when an active goal appears in your \`## Current goal\` instructions; never call it to check whether a goal exists.

You cannot set, reword, pause, or clear a goal — those are the user's. If you think the goal is wrong, say so and ask.`,
    promptSnippet:
      "goal_update: only for an active Current goal; report complete or blocked (you cannot change it)",
    parameters: GoalUpdateParams,
    async execute(_toolCallId, params) {
      if (activeRunGeneration !== generation) {
        return {
          content: [
            {
              type: "text",
              text: "The goal changed after this run started. Do not report against the stale goal; continue from the current instructions.",
            },
          ],
          isError: true,
          details: undefined,
        };
      }
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
      const pending =
        result.goal.claim && lastRun
          ? {
              ...result.goal,
              claim: {
                ...result.goal.claim,
                model: {
                  provider: lastRun.model.provider,
                  id: lastRun.model.id,
                },
                thinkingLevel: lastRun.thinkingLevel,
                sourceRunId: activeRunId,
                sourceRunOutcome: "pending" as const,
              },
            }
          : result.goal;
      persist(pending);
      return {
        content: [
          {
            type: "text",
            text: `Goal ${params.status} claim recorded. Finish this run; an independent verifier will check the claim after the agent settles.`,
          },
        ],
        details: {
          status: params.status,
          note: pending.claim?.note,
          verification: "pending",
        },
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
        case "clear": {
          if (!goal) return say("No goal set.");
          const interrupted = interruptGoalRun(ctx);
          persist(undefined);
          if (interrupted) return ctx.ui.notify("Goal cleared.", "info");
          return say("Goal cleared.");
        }
        case "pause": {
          if (!goal) return say("No goal to pause.");
          const interrupted = interruptGoalRun(ctx);
          persist(pause(goal, now));
          const message =
            "Goal paused. It is out of the model's context until you `/goal resume`.";
          if (interrupted) return ctx.ui.notify(message, "info");
          return say(message);
        }
        case "resume":
          if (!goal) return say("No goal to resume.");
          if (isLive(goal)) {
            if (!ctx.isIdle()) {
              return ctx.ui.notify("Goal is already active.", "info");
            }
            say("Goal continuation retried.");
            continueGoal(ctx, "Continue working toward the active goal.");
            return;
          }
          persist(resume(goal, now));
          say("Goal resumed.");
          continueGoal(ctx, "Continue working toward the resumed goal.");
          return;
      }

      const created = createGoal(input, now);
      if ("error" in created) return say(created.error);
      // Replacing rather than refusing: the alternative is making the user
      // clear first, and a goal that is hard to change is one that goes stale.
      const replaced = goal !== undefined;
      if (replaced) interruptGoalRun(ctx);
      persist(created);
      say(
        `${replaced ? "Goal replaced" : "Goal set"}: ${created.text}\n` +
          "It keeps running until you pause or clear it. Complete and blocked reports are independently verified.",
      );
      continueGoal(ctx, "Begin working toward the active goal.");
      return;
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
