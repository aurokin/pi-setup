import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withAgentRules } from "../shared/engineering-policy.ts";
import { stripContradictoryGuidelines } from "./src/fixups.ts";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: withAgentRules(
      stripContradictoryGuidelines(event.systemPrompt),
    ),
  }));
}
