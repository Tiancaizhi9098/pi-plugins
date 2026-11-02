import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createController } from "./controller.ts";

export default function modelSystemPrompts(pi: ExtensionAPI): void {
  const controller = createController(getAgentDir(), (type, data) => pi.appendEntry(type, data));
  pi.registerCommand("model-system", {
    description: "列出可用模型，粘贴系统提示词，选择持续或仅首轮生效",
    handler: controller.command,
    getArgumentCompletions: controller.completions,
  });
  pi.on("before_agent_start", (event, ctx) => {
    controller.clear(ctx);
    if (event.messageType !== "user") return;
    const content = controller.begin(ctx);
    // Pi 1.5 structured sections persist in history. An opaque override is
    // limited to this user run, including its tool continuations.
    if (content !== undefined) return { systemPrompt: `${event.systemPrompt}\n\n${content}` };
  });
  pi.on("message_end", (event, ctx) => controller.messageEnd(event.message, ctx));
  // agent_end also fires between retries; settled is the final boundary.
  pi.on("agent_settled", (_event, ctx) => controller.clear(ctx));
  pi.on("session_start", (_event, ctx) => controller.clear(ctx));
  pi.on("session_tree", (_event, ctx) => controller.clear(ctx));
  pi.on("model_select", (_event, ctx) => controller.updateStatus(ctx));
}
