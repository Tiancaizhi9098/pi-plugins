import { dirname, join } from "node:path";
import { isConsumed, latestCompactionId, loadConfig, readPrompt, resolvePromptPath, saveBinding, STATE_TYPE, type Binding, type Mode } from "./core.ts";

/** Small structural interface shared by the Pi and OMP SDKs. */
export interface PromptContext {
  cwd: string;
  hasUI: boolean;
  model?: { provider: string; id: string };
  modelRegistry: { getAvailable(): { provider: string; id: string; name: string }[] };
  models?: { list(): { provider: string; id: string; name: string }[] };
  sessionManager: { getBranch(): readonly unknown[]; getSessionId(): string };
  isIdle(): boolean;
  ui: {
    select(title: string, options: string[]): Promise<string | undefined>;
    editor(title: string, prefill?: string): Promise<string | undefined>;
    notify(message: string, type?: "info" | "error"): void;
    setStatus(key: string, text: string | undefined): void;
  };
}

const HELP = [
  "/model-system                        选择可用模型，粘贴提示词并选择模式",
  "/model-system edit [提供商/模型ID]    编辑指定模型（默认当前模型）",
  "/model-system list                   列出可用模型及配置状态",
  "/model-system status [模型]          查看模式和首轮状态",
  "/model-system mode always|once [模型] 更改生效模式",
  "/model-system reset [模型]           重置该模型在本会话的首轮记录",
  "/model-system unbind [模型]          删除该模型的提示词",
].join("\n");
const modeLabels = ["持续生效", "仅首轮生效"];
const keyOf = (ctx: PromptContext) => ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function createController(agentDir: string, appendEntry: (type: string, data: unknown) => void) {
  const configPath = join(agentDir, "model-system-prompts.json");
  let pending: { model: string; session: string; compaction?: string } | undefined;
  let run: { session: string; compaction?: string; prompts: Map<string, string | undefined> } | undefined;
  const bindingFor = (key: string) => loadConfig(configPath).bindings[key];
  const consumed = (ctx: PromptContext, key: string) => isConsumed(ctx.sessionManager.getBranch(), key);
  const textFor = (binding: Binding, ctx: PromptContext) => binding.prompt !== undefined ? binding.prompt
    : readPrompt(resolvePromptPath(binding.file, dirname(configPath)), agentDir, ctx.cwd);

  function notify(ctx: PromptContext, message: string, type: "info" | "error" = "info") {
    if (ctx.hasUI) ctx.ui.notify(message, type);
    else process.stderr.write(`[model-system] ${message}\n`);
  }

  function updateStatus(ctx: PromptContext) {
    if (!ctx.hasUI) return;
    try {
      const key = keyOf(ctx);
      const binding = key ? bindingFor(key) : undefined;
      ctx.ui.setStatus("model-system-prompts", !binding ? undefined : binding.mode === "always" ? "系统提示词：持续"
        : consumed(ctx, key!) ? "系统提示词：首轮已使用" : "系统提示词：待首轮");
    } catch { ctx.ui.setStatus("model-system-prompts", "系统提示词：配置错误"); }
  }

  function status(ctx: PromptContext, key: string) {
    const binding = bindingFor(key);
    const state = binding?.mode === "once" ? `\n首轮状态：${consumed(ctx, key) ? "已使用" : "待使用"}` : "";
    notify(ctx, `模型：${key}\n${binding ? `模式：${modeLabels[binding.mode === "always" ? 0 : 1]}\n${binding.prompt !== undefined ? `已保存 ${binding.prompt.length} 字符` : "旧版文件绑定，可通过编辑提示词转为文本"}${state}` : "尚未配置提示词"}\n配置：${configPath}`);
  }

  function modelOptions(ctx: PromptContext) {
    const config = loadConfig(configPath);
    const models = new Map((ctx.models?.list() ?? ctx.modelRegistry.getAvailable()).map((model) => [`${model.provider}/${model.id}`, model]));
    return [...models].sort(([a], [b]) => a === keyOf(ctx) ? -1 : b === keyOf(ctx) ? 1 : a.localeCompare(b)).map(([key, model]) => {
      const binding = config.bindings[key];
      return { key, label: `${key} · ${model.name}${key === keyOf(ctx) ? " · 当前" : ""} · ${binding ? modeLabels[binding.mode === "always" ? 0 : 1] : "未配置"}` };
    });
  }

  function list(ctx: PromptContext) {
    const options = modelOptions(ctx);
    const available = new Set(options.map(({ key }) => key));
    const inactive = Object.keys(loadConfig(configPath).bindings).filter((key) => !available.has(key));
    notify(ctx, [options.length ? `可用模型（${options.length}）：\n${options.map(({ label }) => label).join("\n")}`
      : "暂无可用模型，请先在宿主中配置模型及登录凭据。",
    ...(inactive.length ? [`已配置但当前不可用：\n${inactive.join("\n")}`] : [])].join("\n\n"));
  }

  function ensureIdle(ctx: PromptContext) {
    if (!ctx.isIdle()) throw new Error("请等待当前任务结束后再修改模型提示词设置");
  }

  async function chooseMode(ctx: PromptContext): Promise<Mode | undefined> {
    const choice = await ctx.ui.select("生效模式", modeLabels);
    return choice === "持续生效" ? "always" : choice === "仅首轮生效" ? "once" : undefined;
  }

  async function edit(ctx: PromptContext, key: string) {
    ensureIdle(ctx);
    if (!ctx.hasUI) throw new Error("请在交互界面运行 /model-system，以打开多行提示词编辑框");
    const old = bindingFor(key);
    let prefill = "";
    if (old) {
      try { prefill = textFor(old, ctx); }
      catch (error) { notify(ctx, `旧文件无法读取，可直接粘贴新内容：${errorText(error)}`, "error"); }
    }
    const prompt = await ctx.ui.editor(`粘贴或编辑系统提示词 · ${key}`, prefill);
    if (prompt === undefined) return;
    if (!prompt.trim()) throw new Error("提示词不能为空。删除配置请使用“解除绑定”。");
    const mode = await chooseMode(ctx);
    if (!mode) return;
    ensureIdle(ctx);
    saveBinding(configPath, key, { prompt, mode });
    notify(ctx, `已保存 ${key} 的提示词（${modeLabels[mode === "always" ? 0 : 1]}）${mode === "once" && consumed(ctx, key) ? "\n本会话首轮已使用，如需再次生效请重置首轮记录。" : ""}`);
    updateStatus(ctx);
  }

  async function menu(ctx: PromptContext) {
    if (!ctx.hasUI) { list(ctx); return; }
    ensureIdle(ctx);
    const options = modelOptions(ctx);
    if (!options.length) { list(ctx); return; }
    const choice = await ctx.ui.select("选择模型 · 系统提示词", options.map(({ label }) => label));
    const key = options.find(({ label }) => label === choice)?.key;
    if (!key) return;
    if (!bindingFor(key)) { await edit(ctx, key); return; }
    const action = await ctx.ui.select(`操作 · ${key}`, ["编辑提示词", "切换生效模式", "查看状态", "重置首轮记录", "解除绑定"]);
    if (action === "编辑提示词") await edit(ctx, key);
    else if (action === "切换生效模式") {
      const mode = await chooseMode(ctx);
      if (mode) await command(`mode ${mode} ${key}`, ctx);
    } else if (action === "查看状态") status(ctx, key);
    else if (action === "重置首轮记录") await command(`reset ${key}`, ctx);
    else if (action === "解除绑定") await command(`unbind ${key}`, ctx);
  }

  async function command(args: string, ctx: PromptContext): Promise<void> {
    try {
      const input = args.trim();
      if (!input) { await menu(ctx); return; }
      const [, action, tail = ""] = /^(\S+)(?:\s+([\s\S]*))?$/.exec(input)!;
      const rest = tail.trim();
      if (action === "help") { notify(ctx, HELP); return; }
      if (action === "list") { list(ctx); return; }
      // Legacy CLI remains compatible, but new UI and help use pasted text only.
      if (action === "bind") {
        ensureIdle(ctx);
        const key = keyOf(ctx);
        const parts = /^(always|once)\s+([\s\S]+)$/.exec(rest);
        if (!key || !parts) throw new Error("旧版用法：bind always|once <文件路径>；推荐使用 /model-system 粘贴文本");
        const file = resolvePromptPath(parts[2], ctx.cwd);
        readPrompt(file, agentDir, ctx.cwd);
        saveBinding(configPath, key, { file, mode: parts[1] as Mode });
        updateStatus(ctx);
        return;
      }
      const parts = action === "mode" ? /^(always|once)(?:\s+(\S+))?$/.exec(rest) : undefined;
      if (action === "mode" && !parts) throw new Error("用法：mode always|once [提供商/模型ID]");
      const key = (action === "mode" ? parts?.[2] : rest) || keyOf(ctx);
      if (!key || !/^[^/\s]+\/\S+$/.test(key)) throw new Error("请指定提供商/模型ID，或先选择当前模型");
      if (action === "status") { status(ctx, key); return; }
      ensureIdle(ctx);
      if (action === "edit") { await edit(ctx, key); return; }
      if (action === "mode") {
        const binding = bindingFor(key);
        if (!binding) throw new Error("该模型尚未配置提示词，请先使用 /model-system");
        saveBinding(configPath, key, { ...binding, mode: parts![1] as Mode });
        status(ctx, key);
      } else if (action === "unbind") {
        saveBinding(configPath, key, null);
        notify(ctx, `已删除 ${key} 的提示词`);
      } else if (action === "reset") {
        appendEntry(STATE_TYPE, { version: 1, model: key, consumed: false });
        notify(ctx, `已重置 ${key} 的首轮记录`);
      } else throw new Error(`未知命令：${action}\n${HELP}`);
      updateStatus(ctx);
    } catch (error) { notify(ctx, errorText(error), "error"); }
  }

  function start(ctx: PromptContext) {
    pending = undefined;
    run = { session: ctx.sessionManager.getSessionId(), compaction: latestCompactionId(ctx.sessionManager.getBranch()), prompts: new Map() };
  }

  function begin(ctx: PromptContext): string | undefined {
    start(ctx);
    return forRequest(ctx);
  }

  /** Cache eligibility for a whole user run, including tools and model fallbacks. */
  function forRequest(ctx: PromptContext): string | undefined {
    pending = undefined;
    const key = keyOf(ctx);
    if (!key || !run || run.session !== ctx.sessionManager.getSessionId()) return;
    try {
      const compaction = latestCompactionId(ctx.sessionManager.getBranch());
      if (run.compaction !== compaction) {
        run.compaction = compaction;
        run.prompts.clear();
      }
      if (!run.prompts.has(key)) {
        const binding = bindingFor(key);
        const content = !binding || (binding.mode === "once" && consumed(ctx, key)) ? undefined : textFor(binding, ctx);
        run.prompts.set(key, content);
      }
      const content = run.prompts.get(key);
      if (content !== undefined) pending = { model: key, session: run.session, compaction: run.compaction };
      return content;
    } catch (error) {
      run.prompts.set(key, undefined);
      notify(ctx, `无法加载 ${key} 的提示词：${errorText(error)}`, "error");
    }
  }

  function messageEnd(message: { role: string; stopReason?: string; provider?: string; model?: string }, ctx: PromptContext) {
    if (!pending || message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") return;
    if (message.provider && message.model && `${message.provider}/${message.model}` !== pending.model) return;
    if (pending.session === ctx.sessionManager.getSessionId()
      && pending.compaction === latestCompactionId(ctx.sessionManager.getBranch()) && !consumed(ctx, pending.model)) {
      appendEntry(STATE_TYPE, { version: 1, model: pending.model, consumed: true });
    }
    pending = undefined;
    updateStatus(ctx);
  }

  function clear(ctx: PromptContext) { pending = undefined; run = undefined; updateStatus(ctx); }
  function compacted(ctx: PromptContext) { pending = undefined; updateStatus(ctx); }
  const completions = (prefix: string) => {
    const matches = ["edit", "mode always", "mode once", "status", "list", "reset", "unbind", "help"]
      .filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
    return matches.length ? matches : null;
  };
  const hasPolicy = () => !!run && [...run.prompts.values()].some((text) => text !== undefined);
  return { command, completions, start, begin, forRequest, hasPolicy, messageEnd, clear, compacted, updateStatus };
}
