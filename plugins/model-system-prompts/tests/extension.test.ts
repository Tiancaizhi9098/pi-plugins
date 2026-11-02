import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fixture } from "./helpers.ts";
import { loadConfig, isConsumed, saveBinding } from "../src/core.ts";

test("once injects into only the first run of each provider/model and never persists prompt text", async (t) => {
  const f = await fixture(t);
  f.bind("test-a", "once", "SECRET_A_FIRST_ONLY");
  f.bind("test-b", "once", "SECRET_B_FIRST_ONLY");
  const h = await f.start();
  await h.session.prompt("first A");
  await h.session.prompt("second A");
  await h.session.setModel(f.model("test-b"));
  await h.session.prompt("first B");
  await h.session.setModel(f.model("test-a"));
  await h.session.prompt("third A");
  assert.match(h.requests[0].system, /SECRET_A_FIRST_ONLY/);
  assert.doesNotMatch(h.requests[1].system, /SECRET_[AB]_FIRST_ONLY/);
  assert.match(h.requests[2].system, /SECRET_B_FIRST_ONLY/);
  assert.doesNotMatch(h.requests[2].system, /SECRET_A_FIRST_ONLY/);
  assert.doesNotMatch(h.requests[3].system, /SECRET_[AB]_FIRST_ONLY/);
  assert.doesNotMatch(JSON.stringify(h.manager.getEntries()), /SECRET_[AB]_FIRST_ONLY/);
  assert.ok(h.requests.every((r) => r.system.includes("NATIVE_COMMON_RULE")));
  assert.deepEqual(h.errors, []);
});

test("always reloads file content per run, preserves earlier extensions, and skips unbound models", async (t) => {
  const f = await fixture(t);
  const file = f.bind("test-a", "always", "ALWAYS_A");
  const h = await f.start(undefined, [(pi) => { pi.on("before_agent_start", (event) => ({ systemPrompt: event.systemPrompt + "\nOTHER_EXTENSION" })); }]);
  await h.session.prompt("one");
  writeFileSync(file, "ALWAYS_A_UPDATED");
  await h.session.prompt("two");
  await h.session.setModel(f.model("test-c"));
  await h.session.prompt("three");
  assert.match(h.requests[0].system, /ALWAYS_A/);
  assert.match(h.requests[1].system, /ALWAYS_A_UPDATED/);
  assert.equal(h.requests[1].system.split("ALWAYS_A_UPDATED").length, 2);
  assert.doesNotMatch(h.requests[2].system, /ALWAYS_A/);
  assert.ok(h.requests.every((r) => r.system.includes("OTHER_EXTENSION")));
});

test("once stays through the first run's tool loop and disappears next run", async (t) => {
  const f = await fixture(t);
  f.bind("test-a", "once", "FIRST_RUN_TOOLS");
  const h = await f.start(undefined, [(pi) => {
    pi.registerTool({ name: "ping", label: "Ping", description: "Test", parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: "pong" }], details: {} }) });
  }]);
  h.session.setActiveToolsByName(["ping"]);
  h.replies.push({ content: [{ type: "toolCall", id: "call-1", name: "ping", arguments: {} }], stopReason: "toolUse" });
  await h.session.prompt("use tool");
  await h.session.prompt("second run");
  assert.equal(h.requests.length, 3);
  assert.match(h.requests[0].system, /FIRST_RUN_TOOLS/);
  assert.match(h.requests[1].system, /FIRST_RUN_TOOLS/);
  assert.doesNotMatch(h.requests[2].system, /FIRST_RUN_TOOLS/);
});

test("consumed state survives reload and a restored session; new sessions get a fresh first run", async (t) => {
  const f = await fixture(t);
  f.bind("test-a", "once", "RESUME_FIRST_ONLY");
  const h = await f.start(SessionManager.create(f.cwd, join(f.dir, "sessions")));
  await h.session.prompt("one");
  await h.session.reload();
  await h.session.prompt("two");
  assert.doesNotMatch(h.requests[1].system, /RESUME_FIRST_ONLY/);
  const sessionFile = h.manager.getSessionFile()!;
  assert.doesNotMatch(readFileSync(sessionFile, "utf8"), /RESUME_FIRST_ONLY/);
  h.session.dispose();
  const restored = await f.start(SessionManager.open(sessionFile));
  await restored.session.prompt("three");
  assert.doesNotMatch(restored.requests[0].system, /RESUME_FIRST_ONLY/);
  const fresh = await f.start(SessionManager.inMemory(f.cwd));
  await fresh.session.prompt("new");
  assert.match(fresh.requests[0].system, /RESUME_FIRST_ONLY/);
});

test("missing file and malformed config report errors without consuming once or blocking the run", async (t) => {
  const f = await fixture(t);
  const file = f.bind("test-a", "once", "RECOVERED_FILE_RULE");
  rmSync(file);
  const h = await f.start();
  await h.session.prompt("missing");
  assert.equal(isConsumed(h.manager.getBranch(), "test-a/shared"), false);
  const valid = readFileSync(f.configPath, "utf8");
  writeFileSync(f.configPath, "{ broken json");
  await h.session.prompt("bad config");
  assert.equal(isConsumed(h.manager.getBranch(), "test-a/shared"), false);
  writeFileSync(f.configPath, valid);
  writeFileSync(file, "RECOVERED_FILE_RULE");
  await h.session.prompt("recovered");
  assert.equal(h.requests.length, 3);
  assert.match(h.requests[2].system, /RECOVERED_FILE_RULE/);
});

test("a cancelled first response retains the first-run allowance", async (t) => {
  const f = await fixture(t);
  f.bind("test-a", "once", "ABORTED_FIRST_RULE");
  const h = await f.start();
  h.replies.push({ content: [], stopReason: "aborted", errorMessage: "synthetic cancellation" });
  await h.session.prompt("cancelled");
  assert.equal(isConsumed(h.manager.getBranch(), "test-a/shared"), false);
  await h.session.prompt("retry");
  assert.match(h.requests[1].system, /ABORTED_FIRST_RULE/);
});

test("compaction preserves consumption while rewinding before use restores the allowance", async (t) => {
  const f = await fixture(t);
  f.bind("test-a", "once", "BRANCH_RULE");
  const h = await f.start();
  const before = h.manager.getLeafId()!;
  await h.session.prompt("first");
  h.manager.appendCompaction("Previous work summarized", null, 100);
  const compacted = await f.start(h.manager);
  await compacted.session.prompt("after compaction");
  assert.doesNotMatch(compacted.requests[0].system, /BRANCH_RULE/);
  h.manager.branch(before);
  const rewound = await f.start(h.manager);
  await rewound.session.prompt("new branch");
  assert.match(rewound.requests[0].system, /BRANCH_RULE/);
});

test("relative config paths resolve against the config directory, not the current project", async (t) => {
  const f = await fixture(t);
  writeFileSync(join(f.agentDir, "model-only.md"), "RELATIVE_CONFIG_RULE");
  saveBinding(f.configPath, "test-a/shared", { file: "./model-only.md", mode: "once" });
  const h = await f.start();
  await h.session.prompt("one");
  assert.match(h.requests[0].system, /RELATIVE_CONFIG_RULE/);
});

test("binding an auto-loaded file leaves the existing binding unchanged", async (t) => {
  const f = await fixture(t);
  const file = f.bind("test-a", "once", "DEDICATED_RULE");
  const native = join(f.agentDir, "APPEND_SYSTEM.md");
  writeFileSync(native, "NATIVE_RULE");
  const h = await f.start();
  await h.session.prompt(`/model-system bind once "${native}"`);
  assert.equal(loadConfig(f.configPath).bindings["test-a/shared"].file, file);
  assert.equal(h.requests.length, 0);
});

test("cancelling either menu or path entry does not create a binding or model request", async (t) => {
  const f = await fixture(t);
  const h = await f.start();
  const choices: (string | undefined)[] = [undefined, "绑定当前模型", "仅首轮生效"];
  await h.session.bindExtensions({ mode: "rpc", uiContext: {
    ...h.session.extensionRunner.createContext().ui,
    select: async () => choices.shift(), input: async () => undefined,
  } });
  await h.session.prompt("/model-system");
  await h.session.prompt("/model-system");
  assert.deepEqual(loadConfig(f.configPath).bindings, {});
  assert.equal(h.requests.length, 0);
});

test("failed first response does not consume once and successful retry does", async (t) => {
  const f = await fixture(t);
  f.bind("test-a", "once", "RETRY_FIRST_ONLY");
  const h = await f.start();
  h.replies.push({ content: [], stopReason: "error", errorMessage: "synthetic failure" });
  await h.session.prompt("one");
  assert.equal(isConsumed(h.manager.getBranch(), "test-a/shared"), false);
  await h.session.prompt("retry");
  await h.session.prompt("next");
  assert.match(h.requests[1].system, /RETRY_FIRST_ONLY/);
  assert.doesNotMatch(h.requests[2].system, /RETRY_FIRST_ONLY/);
});

test("automatic retry consumes once after success and removes the rule on the next user run", async (t) => {
  const f = await fixture(t);
  f.bind("test-a", "once", "AUTOMATIC_RETRY_RULE");
  const h = await f.start();
  h.session.setAutoRetryEnabled(true);
  h.replies.push({ content: [], stopReason: "error", errorMessage: "429 rate limit exceeded" });
  await h.session.prompt("first run, automatically retried");
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[0].system, /AUTOMATIC_RETRY_RULE/);
  assert.match(h.requests[1].system, /AUTOMATIC_RETRY_RULE/);
  assert.equal(isConsumed(h.manager.getBranch(), "test-a/shared"), true);
  await h.session.prompt("next user run");
  assert.doesNotMatch(h.requests[2].system, /AUTOMATIC_RETRY_RULE/);
});

test("bind, mode, reset and unbind commands operate on the current model", async (t) => {
  const f = await fixture(t);
  const file = join(f.dir, "中文 文件 APPEND_SYSTEM.md");
  writeFileSync(file, "COMMAND_RULE");
  const h = await f.start();
  await h.session.prompt(`/model-system bind once "${file}"`);
  assert.equal(loadConfig(f.configPath).bindings["test-a/shared"].file, file);
  assert.equal(h.requests.length, 0);
  await h.session.prompt("one");
  await h.session.prompt("two");
  await h.session.prompt("/model-system reset");
  await h.session.prompt("three");
  assert.match(h.requests[2].system, /COMMAND_RULE/);
  await h.session.prompt("/model-system mode always");
  assert.equal(loadConfig(f.configPath).bindings["test-a/shared"].mode, "always");
  await h.session.prompt("/model-system unbind");
  assert.deepEqual(loadConfig(f.configPath).bindings, {});
});
