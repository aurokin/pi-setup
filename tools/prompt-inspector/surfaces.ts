/** Serializable review inputs. Each surface owns its fidelity and ordered content. */
import {
  PI_PROFILE,
  PI_WORKSPACE,
  withoutSubagentPolicy,
} from "../../extensions/shared/engineering-policy.ts";
import { splitSections } from "../../extensions/shared/prompt-sections.ts";
import {
  buildRolePrompt,
  rolePromptContributions,
  ROLE_PROFILES,
  type RoleProfile,
} from "../../extensions/shared/roles.ts";
import { cursorMode } from "../../extensions/subagents/src/backends/cursor.ts";
import { toolPolicy } from "../../extensions/subagents/src/tool-policy.ts";
import { instructionMessages, readMessages } from "./payload.ts";

export const FIDELITY_LABELS = {
  captured: "Captured request",
  assembled: "Assembled prompt",
  "extension-message": "Extension message only",
} as const;

export type ContributionKind =
  | "system"
  | "global"
  | "workspace"
  | "role"
  | "contract"
  | "task"
  | "skills"
  | "tools"
  | "history"
  | "message";

export interface ContextContribution {
  readonly kind: ContributionKind;
  readonly label: string;
  /** Position in the request or the production function/file that owns it. */
  readonly source: string;
  readonly content: string;
}

export interface VariantDimensions {
  readonly role: string;
  readonly harness: string;
  readonly history: string;
  readonly policy: string;
  /** A native restriction, not a claim about an unavailable tool schema. */
  readonly tools: string;
}

export interface PromptSurface {
  readonly id: string;
  readonly title: string;
  readonly fidelity: keyof typeof FIDELITY_LABELS;
  readonly dimensions: readonly VariantDimensions[];
  readonly contributions: readonly ContextContribution[];
  readonly limitations: readonly string[];
  /** Complete extension message, including its separators. */
  readonly extensionMessage?: string;
}

const labels = {
  role: "Role framing",
  contract: "Child response contract",
  task: "Task",
} as const;

export function roleContributions(role: RoleProfile, task: string) {
  return rolePromptContributions({ role, task }).map((part) => ({
    ...part,
    label: labels[part.kind],
    source: "extensions/shared/roles.ts → buildRolePrompt",
  }));
}

const globalSections = splitSections(PI_PROFILE);

/** Keep encounter order; headings alone cannot prove who authored a section. */
export function instructionContributions(text: string, source: string) {
  return splitSections(text).map((section): ContextContribution => {
    let kind: ContributionKind = "system";
    let label = "Harness system prompt / other instructions";
    if (section.heading === "<project_context>") {
      kind = "workspace";
      label = "Workspace and project context";
    } else if (section.heading === "<available_skills>") {
      kind = "skills";
      label = "Skills catalogue";
    } else if (section.body.trim() === PI_WORKSPACE.trim()) {
      kind = "workspace";
      label = "Workspace guidance";
    } else if (
      globalSections.some(
        (global) => global.body.trim() === section.body.trim(),
      )
    ) {
      kind = "global";
      label = "Agent policy";
    }
    return {
      kind,
      label: `${label}: ${section.heading}`,
      source,
      content: section.body,
    };
  });
}

export function capturedSurface(payload: unknown): PromptSurface {
  const messages = readMessages(payload);
  const taskIndex = messages.map((message) => message.role).lastIndexOf("user");
  const contributions = messages.flatMap((message, index) => {
    const source = `Prompt capture · messages[${index}] · ${message.role}`;
    return instructionMessages([message]).length
      ? instructionContributions(message.content, source)
      : [
          {
            kind:
              index === taskIndex ? ("task" as const) : ("history" as const),
            label:
              index === taskIndex
                ? "Task"
                : `Conversation history: ${message.role}`,
            source,
            content: message.content,
          },
        ];
  });
  const tools = (payload as { tools?: unknown } | null)?.tools;
  if (tools !== undefined) {
    contributions.push({
      kind: "tools",
      label: "Tool schemas",
      source: "Prompt capture · tools field, separate from messages",
      content: JSON.stringify(tools, null, 2),
    });
  }
  return {
    id: "parent-pi",
    title: "Parent Pi",
    fidelity: "captured",
    dimensions: [],
    contributions,
    limitations: [
      "Contributions follow message order. Tool schemas are a separate request field, shown last. Unattributed instructions stay together under their original headings; context files may combine global and project instructions.",
    ],
  };
}

/** Group only equal resolved content. Partial messages do not resolve native tools. */
export function groupVariants(surfaces: readonly PromptSurface[]) {
  const groups = new Map<string, PromptSurface>();
  for (const surface of surfaces) {
    const key = JSON.stringify({
      fidelity: surface.fidelity,
      contributions: surface.contributions.map(({ kind, content }) => ({
        kind,
        content,
      })),
      extensionMessage: surface.extensionMessage,
      restrictions:
        surface.fidelity === "extension-message"
          ? undefined
          : [
              ...new Set(
                surface.dimensions.map(({ policy, tools }) =>
                  JSON.stringify({ policy, tools }),
                ),
              ),
            ].sort(),
    });
    const previous = groups.get(key);
    if (previous) {
      groups.set(key, {
        ...previous,
        title:
          previous.dimensions[0]?.role === surface.dimensions[0]?.role
            ? previous.title
            : "Equivalent prompt variants",
        dimensions: [...previous.dimensions, ...surface.dimensions],
        limitations: [
          ...new Set([...previous.limitations, ...surface.limitations]),
        ],
        contributions: previous.contributions.map((part, index) => ({
          ...part,
          source: [
            ...new Set([part.source, surface.contributions[index]!.source]),
          ].join("; "),
        })),
      });
    } else {
      groups.set(key, surface);
    }
  }
  return [...groups.values()];
}

/** All native backends use buildRolePrompt. Only that message is equivalent. */
export function extensionSurfaces(task: string): PromptSurface[] {
  return [...ROLE_PROFILES.values()].map((role) => {
    const policy = toolPolicy(role.writeCapable, role.inheritsParentTools);
    const restrictions = {
      pi: `Excluded tools: ${policy.piExcludeTools.join(", ") || "none"}`,
      claude: `Disallowed tools: ${policy.claudeDisallowedTools.join(", ") || "none"}`,
      codex: `Sandbox: ${policy.codexSandbox}`,
      droid:
        "Tool IDs depend on Droid's live registry; see backends/droid.ts → droidDisabledToolIds. Schemas unavailable.",
      cursor: `Mode: ${cursorMode(role.writeCapable)}. Native tool schemas unavailable.`,
    };
    return {
      id: `message-${role.name}`,
      title: `${role.name}${role.name === "side" ? " (internal)" : ""}: shared role message`,
      fidelity: "extension-message",
      dimensions: Object.entries(restrictions).map(([harness, tools]) => ({
        role: role.name,
        harness,
        history:
          harness === "pi"
            ? "Supplied separately by Pi"
            : "Fresh child; parent history is not seeded",
        policy:
          "Global instructions supplied by the harness, outside this message",
        tools,
      })),
      contributions: roleContributions(role, task),
      extensionMessage: buildRolePrompt({ role, task }),
      limitations: [
        "Only the extension-owned initial message is shown. Harness system prompts, global instructions, project context, skills, tool schemas and conversation history are outside this message. Full prompts across harnesses are not known to be equivalent.",
        "The task uses this review's input as an example. It is not an observed child assignment. The side role is internal; /btw currently uses Pi only.",
      ],
    };
  });
}

export interface PiPromptAssembly {
  readonly systemPrompt: string;
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
  }[];
  readonly history: readonly {
    readonly role: string;
    readonly content: string;
  }[];
  readonly extraMessages?: readonly {
    readonly role: string;
    readonly content: string;
  }[];
  readonly sources: readonly string[];
  readonly limitations: readonly string[];
}

/** Review the pre-serialization child context, applying the production final policy. */
export function assembledPiSurface(
  role: RoleProfile,
  task: string,
  assembly: PiPromptAssembly,
): PromptSurface {
  const side = role.name === "side";
  const exclusions = toolPolicy(
    role.writeCapable,
    role.inheritsParentTools,
  ).piExcludeTools;
  const systemPrompt = side
    ? assembly.systemPrompt
    : withoutSubagentPolicy(assembly.systemPrompt, {
        includeWorkspace: role.name === "worker",
      });
  const tools = assembly.tools.filter(
    (tool) => !exclusions.includes(tool.name),
  );
  return {
    id: `pi-${role.name}`,
    title: `Pi ${role.name}${side ? " (internal /btw)" : ""}`,
    fidelity: "assembled",
    dimensions: [
      {
        role: role.name,
        harness: "pi",
        history: side ? "Inherited example from parent capture" : "Fresh child",
        policy: side
          ? "Unfiltered /btw policy"
          : role.name === "worker"
            ? "Child policy; workspace guidance retained"
            : "Child policy; workspace guidance removed",
        tools: `Excluded tools: ${exclusions.join(", ") || "none"}`,
      },
    ],
    contributions: [
      ...instructionContributions(systemPrompt, assembly.sources.join("; ")),
      ...(side
        ? assembly.history.map((message) => ({
            kind: "history" as const,
            label: `Conversation history: ${message.role}`,
            source:
              "Parent prompt capture, used as an inheritance example before the child message",
            content: message.content,
          }))
        : []),
      ...roleContributions(role, task),
      ...(assembly.extraMessages ?? []).map((message) => ({
        kind: "message" as const,
        label: `Extension message: ${message.role}`,
        source: "Pi before_agent_start handlers",
        content: message.content,
      })),
      {
        kind: "tools",
        label: "Tool schemas",
        source:
          "Pi SDK active tools after production role exclusions; separate from messages",
        content: JSON.stringify(tools, null, 2),
      },
    ],
    extensionMessage: buildRolePrompt({ role, task }),
    limitations: assembly.limitations,
  };
}
