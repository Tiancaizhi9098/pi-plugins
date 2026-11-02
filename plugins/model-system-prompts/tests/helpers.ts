import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createAssistantMessageEventStream, getCurrentSystemPrompt, type AssistantMessage, type Model, type Api } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { saveBinding, type Mode } from "../src/core.ts";

export async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "pi-prompts-integration-"));
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "project");
  mkdirSync(agentDir);
  mkdirSync(cwd);
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const sessions: AgentSession[] = [];
  t.after(() => {
    for (const session of sessions) session.dispose();
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    rmSync(dir, { recursive: true, force: true });
  });
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models-store.json"), refreshOnCreate: false });
  for (const provider of ["test-a", "test-b", "test-c"]) {
    runtime.registerProvider(provider, {
      api: "openai-completions", apiKey: "offline-test-key", baseUrl: "http://127.0.0.1:1",
      models: [{ id: "shared", name: "Test", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    });
  }
  const model = (provider: string): Model<Api> => runtime.getModel(provider, "shared")!;
  const configPath = join(agentDir, "model-system-prompts.json");
  const bind = (provider: string, mode: Mode, content: string) => {
    const file = join(dir, `${provider} 提示词 APPEND_SYSTEM.md`);
    writeFileSync(file, content);
    saveBinding(configPath, `${provider}/shared`, { file, mode });
    return file;
  };

  async function start(manager = SessionManager.inMemory(cwd), extra: ExtensionFactory[] = []) {
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
    const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager: settings, noExtensions: true,
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: "BASE_SYSTEM", appendSystemPrompt: ["NATIVE_COMMON_RULE"], extensionFactories: [...extra, extension] });
    await loader.reload();
    const { session, extensionsResult } = await createAgentSession({ cwd, agentDir, settingsManager: settings, modelRuntime: runtime,
      model: model("test-a"), resourceLoader: loader, sessionManager: manager, tools: [] });
    if (extensionsResult.errors.length) throw new Error(JSON.stringify(extensionsResult.errors));
    sessions.push(session);
    const errors: string[] = [];
    await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error.error) });
    const requests: { provider: string; system: string; messages: unknown[] }[] = [];
    const replies: Partial<AssistantMessage>[] = [];
    session.agent.streamFunction = (selected, context) => {
      requests.push({ provider: selected.provider, system: getCurrentSystemPrompt(context.messages), messages: structuredClone(context.messages) });
      const message: AssistantMessage = {
        role: "assistant", content: [{ type: "text", text: "OK" }], api: selected.api, provider: selected.provider, model: selected.id,
        stopReason: "stop", timestamp: Date.now(),
        usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        ...replies.shift(),
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: message });
      if (message.stopReason === "error" || message.stopReason === "aborted") stream.push({ type: "error", reason: message.stopReason, error: message });
      else if (message.stopReason !== "pending") stream.push({ type: "done", reason: message.stopReason, message });
      stream.end(message);
      return stream;
    };
    return { session, manager, requests, replies, errors };
  }
  return { dir, cwd, agentDir, configPath, model, bind, start };
}
