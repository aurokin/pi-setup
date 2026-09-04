/** Load Pi child resources without starting a model turn or creating a session file. */
import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  createChildResources,
  shutdownAndDisposeChildSession,
} from "../../extensions/subagents/src/backends/pi.ts";
import {
  buildRolePrompt,
  ROLE_PROFILES,
} from "../../extensions/shared/roles.ts";
import { toolPolicy } from "../../extensions/subagents/src/tool-policy.ts";
import { messageText, readMessages } from "./payload.ts";
import { assembledPiSurface, type PromptSurface } from "./surfaces.ts";

export async function assemblePiSurfaces(options: {
  cwd: string;
  projectTrusted: boolean;
  task: string;
  parentPayload: unknown;
}) {
  const surfaces: PromptSurface[] = [];
  const notes: string[] = [];
  const history = readMessages(options.parentPayload).filter(
    (message) => message.role !== "system" && message.role !== "developer",
  );
  for (const role of ROLE_PROFILES.values()) {
    try {
      const { loader, settingsManager } = await createChildResources(
        options.cwd,
        options.projectTrusted,
        {
          enabled: role.name !== "side",
          includeWorkspace: role.name === "worker",
        },
      );
      const { session } = await createAgentSession({
        cwd: options.cwd,
        resourceLoader: loader,
        settingsManager,
        sessionManager: SessionManager.inMemory(options.cwd),
        excludeTools: [
          ...toolPolicy(role.writeCapable, role.inheritsParentTools)
            .piExcludeTools,
        ],
      });
      try {
        await session.bindExtensions({ mode: "print" });
        const runner = session.extensionRunner;
        const result = await runner.emitBeforeAgentStart(
          buildRolePrompt({ role, task: options.task }),
          undefined,
          session.systemPrompt,
          runner.createCommandContext().getSystemPromptOptions(),
        );
        const errors = loader
          .getExtensions()
          .errors.map(
            (error) => `Extension not loaded: ${error.path}: ${error.error}`,
          );
        surfaces.push(
          assembledPiSurface(role, options.task, {
            systemPrompt: result?.systemPrompt ?? session.systemPrompt,
            tools: session.agent.state.tools.map(
              ({ name, description, parameters }) => ({
                name,
                description,
                parameters,
              }),
            ),
            history,
            extraMessages: result?.messages?.map((message) => ({
              role: message.customType,
              content: messageText(message.content),
            })),
            sources: [
              "Pi SDK child resources + before_agent_start handlers + production child policy",
            ],
            limitations: [
              `Assembled for ${options.cwd}. SDK model: ${session.model ? `${session.model.provider}/${session.model.id}` : "none selected"}. Project trust: ${options.projectTrusted ? "trusted" : "untrusted"}. Resources are loaded again after the parent capture.`,
              "Includes startup and before_agent_start contributions. No model turn is started. Input/context hooks, pending messages, compaction, other provider hooks and provider-specific serialization are not run. This is not a provider request.",
              "Tool schemas use the SDK representation. The task is this review's input, not an observed child assignment. Skill bodies are loaded on demand and are absent unless already in messages.",
              ...(role.name === "side"
                ? [
                    "Inherited history is an example using the parent capture's messages, not a live session fork. History-dependent hooks run against an empty in-memory session here. /btw reloads child resources; matching the parent's tools and system prompt is not verified.",
                  ]
                : []),
              ...errors,
            ],
          }),
        );
      } finally {
        await shutdownAndDisposeChildSession(session);
      }
    } catch (error) {
      notes.push(
        `Pi ${role.name} could not be assembled: ${error instanceof Error ? error.message : String(error)}. Its extension message is still shown.`,
      );
    }
  }
  return { surfaces, notes };
}
