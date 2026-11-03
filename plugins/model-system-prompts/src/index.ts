import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createController } from "./controller.ts";
import { createPolicy } from "./omp-policy.ts";

export default function modelSystemPrompts(pi: ExtensionAPI): void {
  const controller = createController(getAgentDir(), (type, data) => pi.appendEntry(type, data));
  const policy = createPolicy();
  pi.registerCommand("model-system", {
    description: "列出可用模型，粘贴系统提示词，选择持续或仅首轮生效",
    handler: controller.command,
    getArgumentCompletions: controller.completions,
  });
  pi.on("before_agent_start", (event, ctx) => {
    controller.clear(ctx);
    if (event.messageType !== "user") return;
    controller.start(ctx);
    // Persist only an empty placeholder. Keeping the native prompt structured
    // preserves other extensions' request-time edits and live system updates.
    const marker = `\n\n${policy.block("")}`;
    event.systemPromptOptions.appendSystemPrompt += marker;
    if (event.systemPromptOptions.forceSystemPrompt !== undefined) {
      event.systemPromptOptions.forceSystemPrompt += marker;
    }
  });
  pi.on("before_provider_request", (event, ctx) => {
    // Compaction/side requests have their own policy and no user-run marker.
    if (!policy.hasMarker(event.payload)) return;
    // Later section updates supersede earlier ones in Pi's transcript.
    const result = policy.patch(event.payload, controller.forRequest(ctx), "last");
    if (result.supported) return result.payload;
  });
  pi.on("session_compact", (_event, ctx) => controller.compacted(ctx));
  pi.on("message_end", (event, ctx) => controller.messageEnd(event.message, ctx));
  // agent_end also fires between retries; settled is the final boundary.
  pi.on("agent_settled", (_event, ctx) => controller.clear(ctx));
  pi.on("session_start", (_event, ctx) => controller.clear(ctx));
  pi.on("session_tree", (_event, ctx) => controller.clear(ctx));
  pi.on("model_select", (_event, ctx) => controller.updateStatus(ctx));
}
