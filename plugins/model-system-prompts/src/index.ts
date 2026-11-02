import { dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isConsumed, loadConfig, readPrompt, resolvePromptPath, saveBinding, STATE_TYPE, type Binding, type Mode } from "./core.ts";

const HELP = [
  "/model-system                         打开菜单 / 查看当前状态",
  "/model-system bind always <文件路径>   当前模型持续生效",
  "/model-system bind once <文件路径>     当前模型仅首轮生效",
  "/model-system mode always|once        更改当前模型模式",
  "/model-system status                  查看当前模型绑定",
  "/model-system list                    查看全部绑定",
  "/model-system reset                   重置当前模型的首轮记录",
  "/model-system unbind                  解除当前模型绑定",
  "路径可含空格，或使用引号包裹。用 /model 切换模型后可分别绑定。",
].join("\n");

function modelKey(ctx: ExtensionContext): string | undefined {
  return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}

function notify(ctx: ExtensionContext, message: string, type: "info" | "error" = "info"): void {
  if (ctx.hasUI) ctx.ui.notify(message, type);
  else process.stderr.write(`[model-system] ${message}\n`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function modelSystemPrompts(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const configPath = join(agentDir, "model-system-prompts.json");
  let pending: { model: string; session: string } | undefined;

  const bindingFor = (key: string): Binding | undefined => loadConfig(configPath).bindings[key];
  const consumed = (ctx: ExtensionContext, key: string): boolean => isConsumed(ctx.sessionManager.getBranch(), key);

  function updateStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    try {
      const key = modelKey(ctx);
      const binding = key ? bindingFor(key) : undefined;
      const label = !binding ? undefined : binding.mode === "always" ? "系统提示词：持续"
        : consumed(ctx, key!) ? "系统提示词：首轮已使用" : "系统提示词：待首轮";
      ctx.ui.setStatus("model-system-prompts", label);
    } catch {
      ctx.ui.setStatus("model-system-prompts", "系统提示词：配置错误");
    }
  }

  function showStatus(ctx: ExtensionContext): void {
    const key = modelKey(ctx);
    const binding = key ? bindingFor(key) : undefined;
    const state = binding?.mode === "once" ? `\n首轮状态：${consumed(ctx, key!) ? "已使用（后续不注入）" : "待使用"}` : "";
    notify(ctx, `当前模型：${key ?? "未选择"}\n${binding ? `模式：${binding.mode === "always" ? "持续生效" : "仅首轮生效"}\n文件：${resolvePromptPath(binding.file, dirname(configPath))}${state}` : "尚未绑定提示词文件"}\n配置：${configPath}`);
  }

  function bind(ctx: ExtensionContext, key: string, mode: Mode, input: string): void {
    const file = resolvePromptPath(input, ctx.cwd);
    readPrompt(file, agentDir, ctx.cwd);
    saveBinding(configPath, key, { file, mode });
    const suffix = mode === "once" && consumed(ctx, key) ? "\n本会话首轮已使用；需要再次生效请执行 /model-system reset。" : "";
    notify(ctx, `已绑定 ${key}\n${mode === "always" ? "持续生效" : "仅首轮生效"}：${file}${suffix}`);
    updateStatus(ctx);
  }

  async function menu(ctx: ExtensionCommandContext): Promise<void> {
    if (!ctx.hasUI) { showStatus(ctx); return; }
    const action = await ctx.ui.select("模型系统提示词", ["绑定当前模型", "切换生效模式", "查看当前状态", "列出全部绑定", "重置当前模型首轮", "解除当前模型绑定"]);
    if (action === undefined) return;
    if (action === "绑定当前模型") {
      const key = modelKey(ctx);
      if (!key) throw new Error("请先用 /model 选择一个模型");
      const mode = await ctx.ui.select("生效模式", ["持续生效", "仅首轮生效"]);
      if (mode === undefined) return;
      const file = await ctx.ui.input("APPEND_SYSTEM.md 文件路径", bindingFor(key)?.file ?? "~/model-prompts/模型名称/APPEND_SYSTEM.md");
      if (file === undefined) return;
      bind(ctx, key, mode === "持续生效" ? "always" : "once", file);
    } else if (action === "切换生效模式") {
      const mode = await ctx.ui.select("生效模式", ["持续生效", "仅首轮生效"]);
      if (mode !== undefined) await command(`mode ${mode === "持续生效" ? "always" : "once"}`, ctx);
    } else {
      const commands: Record<string, string> = { "查看当前状态": "status", "列出全部绑定": "list", "重置当前模型首轮": "reset", "解除当前模型绑定": "unbind" };
      await command(commands[action], ctx);
    }
  }

  async function command(args: string, ctx: ExtensionCommandContext): Promise<void> {
    try {
      const input = args.trim();
      if (!input) { await menu(ctx); return; }
      const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(input)!;
      const action = match[1];
      const rest = (match[2] ?? "").trim();
      if (action === "help") { notify(ctx, HELP); return; }
      if (action === "status") { showStatus(ctx); return; }
      if (action === "list") {
        const bindings = Object.entries(loadConfig(configPath).bindings);
        notify(ctx, bindings.length ? bindings.map(([key, value]) => `${key}\n  ${value.mode} · ${resolvePromptPath(value.file, dirname(configPath))}`).join("\n") : "尚无模型绑定。使用 /model-system bind always <文件路径> 添加。");
        return;
      }
      if (!ctx.isIdle()) throw new Error("请等待当前任务结束后再修改模型提示词设置");
      const key = modelKey(ctx);
      if (!key) throw new Error("请先用 /model 选择一个模型");
      if (action === "bind") {
        const parts = /^(always|once)\s+([\s\S]+)$/.exec(rest);
        if (!parts) throw new Error("用法：/model-system bind always|once <文件路径>");
        bind(ctx, key, parts[1] as Mode, parts[2]);
        return;
      }
      if (action === "mode") {
        if (rest !== "always" && rest !== "once") throw new Error("模式只能为 always（持续）或 once（仅首轮）");
        const binding = bindingFor(key);
        if (!binding) throw new Error("当前模型尚未绑定文件，请先使用 bind");
        saveBinding(configPath, key, { ...binding, mode: rest });
        showStatus(ctx);
      } else if (action === "unbind" && !rest) {
        saveBinding(configPath, key, null);
        notify(ctx, `已解除 ${key} 的绑定`);
      } else if (action === "reset" && !rest) {
        pi.appendEntry(STATE_TYPE, { version: 1, model: key, consumed: false });
        notify(ctx, `已重置 ${key} 的首轮记录，下次使用 once 模式时会注入`);
      } else {
        throw new Error(`未知命令或参数：${input}\n${HELP}`);
      }
      updateStatus(ctx);
    } catch (error) {
      notify(ctx, errorText(error), "error");
    }
  }

  pi.registerCommand("model-system", {
    description: "按模型绑定 APPEND_SYSTEM.md，选择持续生效或仅首轮生效",
    handler: command,
    getArgumentCompletions: (prefix) => {
      const commands = ["bind always ", "bind once ", "mode always", "mode once", "status", "list", "reset", "unbind", "help"];
      const matches = commands.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
      return matches.length ? matches : null;
    },
  });

  pi.on("before_agent_start", (event, ctx) => {
    pending = undefined;
    // Internal custom-message runs do not spend a model's first user-run allowance.
    if (event.messageType !== "user") return;
    const key = modelKey(ctx);
    if (!key) return;
    try {
      const binding = bindingFor(key);
      if (!binding || (binding.mode === "once" && consumed(ctx, key))) return;
      const file = resolvePromptPath(binding.file, dirname(configPath));
      const content = readPrompt(file, agentDir, ctx.cwd);
      pending = { model: key, session: ctx.sessionManager.getSessionId() };
      // Opaque per-run override is deliberate: structured sections persist in the
      // transcript in Pi 1.5.0 and would leak first-run text into later requests.
      return { systemPrompt: `${event.systemPrompt}\n\n${content}` };
    } catch (error) {
      notify(ctx, `无法加载 ${key} 的提示词：${errorText(error)}`, "error");
    }
  });

  pi.on("message_end", (event, ctx) => {
    if (!pending || event.message.role !== "assistant" || event.message.stopReason === "error" || event.message.stopReason === "aborted") return;
    if (pending.session === ctx.sessionManager.getSessionId() && !consumed(ctx, pending.model)) {
      pi.appendEntry(STATE_TYPE, { version: 1, model: pending.model, consumed: true });
    }
    pending = undefined;
    updateStatus(ctx);
  });

  // agent_end also fires between automatic retry attempts. Only settled ends
  // the user run; keep pending so a successful retry can consume the allowance.
  pi.on("agent_settled", (_event, ctx) => { pending = undefined; updateStatus(ctx); });
  pi.on("session_start", (_event, ctx) => { pending = undefined; updateStatus(ctx); });
  pi.on("session_tree", (_event, ctx) => { pending = undefined; updateStatus(ctx); });
  pi.on("model_select", (_event, ctx) => { updateStatus(ctx); });
}
