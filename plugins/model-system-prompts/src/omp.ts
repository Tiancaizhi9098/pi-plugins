import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { cfgEnabledModels } from "@oh-my-pi/pi-coding-agent/config/model-settings";
import { filterAvailableModelsByEnabledPatterns } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { findScopedSettings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createController } from "./controller.ts";
import { createPolicy } from "./omp-policy.ts";

/** OMP supplies its SDK at runtime, so this entry never loads the Pi SDK. */
export default function modelSystemPrompts(pi: ExtensionAPI): void {
  const controller = createController(pi.pi.getAgentDir(), (type, data) => pi.appendEntry(type, data));
  const policy = createPolicy();
  let fallbackModel: string | undefined;
  pi.registerCommand("model-system", {
    description: "列出可用模型，粘贴系统提示词，选择持续或仅首轮生效",
    handler: (args, ctx) => controller.command(args, { ...ctx, models: { list: () => {
      const settings = findScopedSettings(ctx.cwd);
      const all = ctx.modelRegistry.getAvailable();
      return settings ? filterAvailableModelsByEnabledPatterns(all, cfgEnabledModels.get(settings), settings) : all;
    } } }),
    getArgumentCompletions: controller.completions,
  });
  pi.on("before_agent_start", (event, ctx) => {
    if (event.reason !== "prompt") return;
    fallbackModel = undefined;
    const content = controller.begin(ctx);
    // Even an unbound model needs a run marker if it later falls back to a bound one.
    return { systemPrompt: [...event.systemPrompt, policy.block(content ?? "")] };
  });
  pi.on("before_provider_request", (event, ctx) => {
    const actualModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
    if (policy.hasMarker(event.payload)) {
      const result = policy.patch(event.payload, controller.forRequest(ctx));
      if (result.supported) {
        // The Apple adapter observes in-place payload edits instead of the return value.
        if (ctx.model?.api === "apple-foundation-models" && typeof event.payload === "object" && event.payload) {
          Object.assign(event.payload, result.payload);
        }
        fallbackModel = undefined;
        return result.payload;
      }
    }
    // Side requests (e.g. compaction) carry no run marker and remain unchanged.
    if (fallbackModel && actualModel === fallbackModel) {
      controller.forRequest(ctx);
      if (!controller.hasPolicy()) { fallbackModel = undefined; return; }
      // An unknown custom transport cannot safely carry the previous model's policy.
      ctx.abort();
      ctx.ui.notify("模型回退后的请求格式不支持更新系统提示词，已中止。请切换模型后重新发送。", "error");
      throw new Error("Unsupported system policy format after model fallback");
    }
  });
  pi.on("retry_fallback_applied", (_event, ctx) => {
    fallbackModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
  });
  pi.on("message_end", (event, ctx) => controller.messageEnd(event.message, ctx));
  pi.on("agent_end", (event, ctx) => {
    if (!event.willContinue) { fallbackModel = undefined; controller.clear(ctx); }
  });
  pi.on("session_start", (_event, ctx) => { fallbackModel = undefined; controller.clear(ctx); });
  pi.on("session_switch", (_event, ctx) => { fallbackModel = undefined; controller.clear(ctx); });
  pi.on("session_branch", (_event, ctx) => { fallbackModel = undefined; controller.clear(ctx); });
  pi.on("session_tree", (_event, ctx) => { fallbackModel = undefined; controller.clear(ctx); });
}
