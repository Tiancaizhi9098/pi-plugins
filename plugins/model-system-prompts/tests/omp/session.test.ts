import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { createAgentSession, AuthStorage, ModelRegistry, SessionManager, Settings, getAgentDir, type AgentSession, type ExtensionFactory } from "@oh-my-pi/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@oh-my-pi/pi-ai";
import { initializeExtensions } from "@oh-my-pi/pi-coding-agent/modes/runtime-init";
import extension from "../../src/omp.ts";
import { saveBinding, isConsumed, loadConfig } from "../../src/core.ts";

const sessions: AgentSession[] = [];
const stores: AuthStorage[] = [];
const contentText = (value: unknown): string => typeof value === "string" ? value
  : Array.isArray(value) ? value.map(contentText).join("\n")
    : value && typeof value === "object" && "text" in value ? String(value.text) : "";
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  for (const store of stores.splice(0)) store.close();
});

async function fixture(extra: ExtensionFactory[] = [], manager?: SessionManager, overrides: Record<string, unknown> = {}) {
  const agentDir = getAgentDir();
  const cwd = join(agentDir, "project");
  mkdirSync(cwd, { recursive: true });
  const settings = Settings.isolated({ "compaction.enabled": false, "retry.enabled": false, ...overrides });
  const authStorage = await AuthStorage.create(join(agentDir, `auth-${crypto.randomUUID()}.db`));
  stores.push(authStorage);
  const registry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });
  const requests: { provider: string; system: string; messages: unknown[] }[] = [];
  const replies: Partial<AssistantMessage>[] = [];
  const streamSimple: NonNullable<Parameters<typeof registry.registerProvider>[1]["streamSimple"]> = (selected, context, options) => {
    const message: AssistantMessage = { role: "assistant", content: [{ type: "text", text: "OK" }], api: selected.api,
      provider: selected.provider, model: selected.id, stopReason: "stop", timestamp: Date.now(),
      usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      ...replies.shift() };
    const stream = createAssistantMessageEventStream();
    void (async () => {
      const payload = { model: selected.id, messages: [{ role: "system", content: (context.systemPrompt ?? []).join("\n\n") }, ...context.messages] };
      const wire = (await options?.onPayload?.(payload, selected) ?? payload) as typeof payload;
      requests.push({ provider: selected.provider, system: wire.messages.filter((message) => message.role === "system" || message.role === "developer").map((message) => contentText(message.content)).join("\n\n"), messages: structuredClone(context.messages) });
      stream.push({ type: "start", partial: message });
      if (message.stopReason === "error" || message.stopReason === "aborted") stream.push({ type: "error", reason: message.stopReason, error: message });
      else stream.push({ type: "done", reason: message.stopReason, message });
      stream.end(message);
    })().catch((error) => {
      const failure = { ...message, stopReason: "error" as const, errorMessage: String(error) };
      stream.push({ type: "error", reason: "error", error: failure });
      stream.end(failure);
    });
    return stream;
  };
  for (const provider of ["test-a", "test-b", "test-c"]) registry.registerProvider(provider, {
    api: "offline-test-stream", streamSimple, apiKey: "offline-test-key", baseUrl: "http://127.0.0.1:1",
    models: [{ id: "shared", name: "Test", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  });
  const config = join(agentDir, "model-system-prompts.json");
  for (const provider of ["test-a", "test-b", "test-c"]) saveBinding(config, `${provider}/shared`, null);
  const model = (provider: string) => registry.find(provider, "shared")!;
  const { session, extensionsResult } = await createAgentSession({ cwd, agentDir, authStorage, modelRegistry: registry, settings,
    model: model("test-a"), sessionManager: manager ?? SessionManager.inMemory(cwd),
    systemPrompt: ["BASE_SYSTEM", "NATIVE_COMMON_RULE"], extensions: [...extra, extension],
    disableExtensionDiscovery: true, noContextFiles: true, skills: [], rules: [], promptTemplates: [], slashCommands: [],
    enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true, toolNames: [],
  });
  expect(extensionsResult.errors).toEqual([]);
  expect(session.extensionRunner?.getCommand("model-system")).toBeDefined();
  sessions.push(session);
  const errors: string[] = [];
  const initialize = (uiContext?: Parameters<typeof initializeExtensions>[1]["uiContext"]) => initializeExtensions(session, {
    mode: uiContext ? "tui" : "print", uiContext,
    reportSendError: (_action, error) => { errors.push(error.message); },
    reportRuntimeError: (error) => { errors.push(error.error); },
  });
  await initialize();
  const bind = (provider: string, mode: "once" | "always", prompt: string) => saveBinding(config, `${provider}/shared`, { prompt, mode });
  return { session, config, model, bind, requests, replies, cwd, initialize, errors };
}

test("OMP injects pasted text once per model and keeps native system blocks", async () => {
  const f = await fixture();
  f.bind("test-a", "once", "A_FIRST_ONLY\n中文第二行");
  f.bind("test-b", "once", "B_FIRST_ONLY");
  await f.session.prompt("first A");
  await f.session.prompt("second A");
  await f.session.setModel(f.model("test-b"));
  await f.session.prompt("first B");
  await f.session.setModel(f.model("test-a"));
  await f.session.prompt("third A");
  expect(f.requests[0].system).toContain("A_FIRST_ONLY\n中文第二行");
  expect(f.requests[1].system).not.toContain("A_FIRST_ONLY");
  expect(f.requests[2].system).toContain("B_FIRST_ONLY");
  expect(f.requests[2].system).not.toContain("A_FIRST_ONLY");
  expect(f.requests[3].system).not.toContain("A_FIRST_ONLY");
  expect(f.requests.every((request) => request.system.includes("NATIVE_COMMON_RULE"))).toBe(true);
  expect(JSON.stringify(f.session.sessionManager.getEntries())).not.toContain("FIRST_ONLY");
  expect(f.errors).toEqual([]);
}, 30000);

test("OMP always rereads saved text and chains earlier extension system blocks", async () => {
  const f = await fixture([(pi) => pi.on("before_agent_start", (event) => ({ systemPrompt: [...event.systemPrompt, "OTHER_EXTENSION"] }))]);
  f.bind("test-a", "always", "ALWAYS_A");
  await f.session.prompt("first");
  f.bind("test-a", "always", "UPDATED_A");
  await f.session.prompt("second");
  await f.session.setModel(f.model("test-c"));
  await f.session.prompt("unbound");
  expect(f.requests[0].system).toContain("ALWAYS_A");
  expect(f.requests[1].system).toContain("UPDATED_A");
  expect(f.requests[1].system).not.toContain("ALWAYS_A");
  expect(f.requests[2].system).not.toContain("UPDATED_A");
  expect(f.requests.every((request) => request.system.includes("OTHER_EXTENSION"))).toBe(true);
});

test("OMP once remains for tool continuations and disappears on the next user run", async () => {
  const f = await fixture([(pi) => pi.registerTool({ name: "ping", label: "Ping", description: "Offline test",
    parameters: pi.zod.object({}), execute: async () => ({ content: [{ type: "text", text: "pong" }], details: {} }) })]);
  await f.session.setActiveToolsByName(["ping"]);
  f.bind("test-a", "once", "TOOL_FIRST_ONLY");
  f.replies.push({ content: [{ type: "toolCall", id: "test-call", name: "ping", arguments: {} }], stopReason: "toolUse" });
  await f.session.prompt("use tool");
  await f.session.prompt("next run");
  expect(f.requests.length).toBe(3);
  expect(f.requests[0].system).toContain("TOOL_FIRST_ONLY");
  expect(f.requests[1].system).toContain("TOOL_FIRST_ONLY");
  expect(f.requests[2].system).not.toContain("TOOL_FIRST_ONLY");
  expect(f.errors).toEqual([]);
});

test("OMP errors and aborts preserve once; reset and a new session restore allowance", async () => {
  const f = await fixture();
  f.bind("test-a", "once", "RETRY_ONCE");
  for (const reason of ["error", "aborted"] as const) {
    f.replies.push({ content: [], stopReason: reason, errorMessage: "synthetic failure" });
    await f.session.prompt("failed first response");
    expect(isConsumed(f.session.sessionManager.getBranch(), "test-a/shared")).toBe(false);
  }
  await f.session.prompt("success");
  await f.session.prompt("second");
  expect(f.requests[2].system).toContain("RETRY_ONCE");
  expect(f.requests[3].system).not.toContain("RETRY_ONCE");
  await f.session.prompt("/model-system reset");
  await f.session.prompt("reset");
  expect(f.requests[4].system).toContain("RETRY_ONCE");
  await f.session.newSession();
  await f.session.prompt("new session");
  expect(f.requests[5].system).toContain("RETRY_ONCE");
});

test("OMP selector uses its available models and saves pasted text for a non-current model", async () => {
  const f = await fixture();
  const seen: string[][] = [];
  await f.initialize({ ...f.session.extensionRunner!.createContext().ui,
    select: async (title, items) => {
      const labels = items.map((item) => typeof item === "string" ? item : item.label);
      seen.push(labels);
      return title.includes("选择模型") ? labels.find((x) => x.includes("test-b/shared")) : "仅首轮生效";
    },
    editor: async () => "粘贴到 OMP\n多行提示词",
  });
  await f.session.prompt("/model-system");
  expect(seen[0].some((x) => x.includes("test-a/shared"))).toBe(true);
  expect(seen[0].some((x) => x.includes("test-b/shared"))).toBe(true);
  expect(loadConfig(f.config).bindings["test-b/shared"]).toEqual({ prompt: "粘贴到 OMP\n多行提示词", mode: "once" });
  expect(f.session.model?.provider).toBe("test-a");
  expect(f.requests.length).toBe(0);
  const saved = readFileSync(f.config, "utf8");
  await f.initialize({ ...f.session.extensionRunner!.createContext().ui,
    select: async (_title, items) => {
      const labels = items.map((item) => typeof item === "string" ? item : item.label);
      return labels.find((x) => x.includes("test-b/shared")) ?? "编辑提示词";
    }, editor: async () => undefined,
  });
  await f.session.prompt("/model-system");
  expect(readFileSync(f.config, "utf8")).toBe(saved);
});

test("OMP automatic retry consumes once after success", async () => {
  const f = await fixture();
  f.bind("test-a", "once", "AUTO_RETRY_ONCE");
  f.session.setAutoRetryEnabled(true);
  f.replies.push({ content: [], stopReason: "error", errorMessage: "503 service unavailable" });
  await f.session.prompt("automatically retry");
  expect(f.requests.length).toBe(2);
  expect(f.requests[0].system).toContain("AUTO_RETRY_ONCE");
  expect(f.requests[1].system).toContain("AUTO_RETRY_ONCE");
  expect(isConsumed(f.session.sessionManager.getBranch(), "test-a/shared")).toBe(true);
  await f.session.prompt("next run");
  expect(f.requests[2].system).not.toContain("AUTO_RETRY_ONCE");
}, 15000);

test("OMP state survives disk resume and reinitialization", async () => {
  const cwd = join(getAgentDir(), "project");
  const manager = SessionManager.create(cwd, join(getAgentDir(), "sessions"));
  const f = await fixture([], manager);
  f.bind("test-a", "once", "RESUME_ONCE");
  await f.session.prompt("first");
  await f.initialize();
  await f.session.prompt("reinitialize");
  expect(f.requests[1].system).not.toContain("RESUME_ONCE");
  const file = manager.getSessionFile()!;
  await f.session.dispose();
  expect(readFileSync(file, "utf8")).not.toContain("RESUME_ONCE");
  const restored = await fixture([], await SessionManager.open(file));
  restored.bind("test-a", "once", "RESUME_ONCE");
  await restored.session.prompt("resumed");
  expect(restored.requests[0].system).not.toContain("RESUME_ONCE");
});

test("OMP actual request hook switches policy and consumption on automatic model fallback", async () => {
  const f = await fixture([], undefined, { "retry.enabled": true, "retry.maxRetries": 0,
    "retry.fallbackChains": { "test-a/shared": ["test-b/shared"] } });
  f.bind("test-a", "once", "ONLY_FOR_A");
  f.bind("test-b", "once", "ONLY_FOR_B");
  f.replies.push({ content: [], stopReason: "error", errorMessage: "503 service unavailable" });
  await f.session.prompt("fallback");
  expect(f.requests[0].provider).toBe("test-a");
  expect(f.requests[0].system).toContain("ONLY_FOR_A");
  expect(f.requests[1].provider).toBe("test-b");
  expect(f.requests[1].system).toContain("ONLY_FOR_B");
  expect(f.requests[1].system).not.toContain("ONLY_FOR_A");
  expect(isConsumed(f.session.sessionManager.getBranch(), "test-a/shared")).toBe(false);
  expect(isConsumed(f.session.sessionManager.getBranch(), "test-b/shared")).toBe(true);
  await f.session.prompt("next B");
  expect(f.requests[2].system).not.toContain("ONLY_FOR_B");
  expect(f.errors).toEqual([]);
}, 15000);

test("OMP picker follows enabledModels scope", async () => {
  const f = await fixture([], undefined, { enabledModels: ["test-a/shared"] });
  let labels: string[] = [];
  await f.initialize({ ...f.session.extensionRunner!.createContext().ui,
    select: async (_title, items) => { labels = items.map((item) => typeof item === "string" ? item : item.label); return undefined; },
  });
  await f.session.prompt("/model-system");
  expect(labels.some((x) => x.includes("test-a/shared"))).toBe(true);
  expect(labels.some((x) => x.includes("test-b/shared"))).toBe(false);
});

test("OMP fallback from an unconfigured model injects the target model's prompt", async () => {
  const f = await fixture([], undefined, { "retry.enabled": true, "retry.maxRetries": 0,
    "retry.fallbackChains": { "test-a/shared": ["test-b/shared"] } });
  f.bind("test-b", "once", "BOUND_FALLBACK");
  f.replies.push({ content: [], stopReason: "error", errorMessage: "503 service unavailable" });
  await f.session.prompt("fallback from unbound");
  expect(f.requests[0].system).not.toContain("BOUND_FALLBACK");
  expect(f.requests[1].system).toContain("BOUND_FALLBACK");
  expect(isConsumed(f.session.sessionManager.getBranch(), "test-b/shared")).toBe(true);
});

test("OMP side requests without a run marker keep their policy and do not steal pending state", async () => {
  const f = await fixture();
  f.bind("test-a", "once", "MAIN_ONLY");
  f.bind("test-b", "once", "SIDE_MODEL_RULE");
  const runner = f.session.extensionRunner!;
  await runner.emitBeforeAgentStart("main task", undefined, ["BASE_SYSTEM"]);
  const side = { instructions: "COMPACTION_SYSTEM", input: "summarize" };
  expect(await runner.emitBeforeProviderRequest(side, f.model("test-b"))).toEqual(side);
  await runner.emit({ type: "message_end", message: { role: "assistant", content: [], provider: "test-a", model: "shared",
    api: "offline-test-stream", stopReason: "stop", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } });
  expect(isConsumed(f.session.sessionManager.getBranch(), "test-a/shared")).toBe(true);
  expect(isConsumed(f.session.sessionManager.getBranch(), "test-b/shared")).toBe(false);
});
