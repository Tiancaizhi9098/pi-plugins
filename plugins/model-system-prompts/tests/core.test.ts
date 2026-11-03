import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, saveBinding, resolvePromptPath, readPrompt, isConsumed } from "../src/core.ts";

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "pi-model-prompts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("bindings survive saving another provider with the same model ID", (t) => {
  const config = join(fixture(t), "config.json");
  assert.deepEqual(loadConfig(config), { version: 1, bindings: {} });
  saveBinding(config, "provider-a/model", { file: "a.md", mode: "once" });
  saveBinding(config, "provider-b/model", { file: "b.md", mode: "always" });
  assert.deepEqual(loadConfig(config).bindings, {
    "provider-a/model": { file: "a.md", mode: "once" },
    "provider-b/model": { file: "b.md", mode: "always" },
  });
  saveBinding(config, "provider-b/model", null);
  assert.equal(loadConfig(config).bindings["provider-a/model"].mode, "once");
});

test("malformed configuration is reported and never overwritten", (t) => {
  const config = join(fixture(t), "config.json");
  for (const invalid of ['{"version":1,', '{"version":2,"bindings":{}}', '{"version":1,"bindings":{"p/m":{"file":"x","mode":"bad"}}}']) {
    writeFileSync(config, invalid);
    assert.throws(() => saveBinding(config, "p/m", { file: "x", mode: "once" }));
    assert.equal(readFileSync(config, "utf8"), invalid);
  }
});

test("paths preserve Chinese text and Windows separators and expand home", (t) => {
  const dir = fixture(t);
  assert.equal(resolvePromptPath('"提示词 目录/APPEND_SYSTEM.md"', dir), join(dir, "提示词 目录", "APPEND_SYSTEM.md"));
  assert.equal(resolvePromptPath("~/my-prompts/APPEND_SYSTEM.md", dir), join(homedir(), "my-prompts", "APPEND_SYSTEM.md"));
  assert.throws(() => resolvePromptPath("   ", dir));
});

test("native auto-loaded files are rejected, dedicated files reload from disk", (t) => {
  const dir = fixture(t);
  const agent = join(dir, "agent");
  const project = join(dir, "project");
  mkdirSync(agent);
  mkdirSync(join(project, ".pi"), { recursive: true });
  const dedicated = join(dir, "APPEND_SYSTEM.md");
  writeFileSync(dedicated, "first instruction");
  assert.equal(readPrompt(dedicated, agent, project), "first instruction");
  writeFileSync(dedicated, "updated instruction");
  assert.equal(readPrompt(dedicated, agent, project), "updated instruction");
  for (const file of [join(agent, "APPEND_SYSTEM.md"), join(project, ".pi", "APPEND_SYSTEM.md")]) {
    writeFileSync(file, "native");
    assert.throws(() => readPrompt(file, agent, project), /APPEND_SYSTEM/);
  }
  writeFileSync(dedicated, " \n ");
  assert.throws(() => readPrompt(dedicated, agent, project));
});

test("consumption follows model-specific records and resets in the active branch", () => {
  const entry = (model: string, consumed: boolean) => ({ type: "custom", customType: "model-system-prompts-state", data: { version: 1, model, consumed } });
  const entries = [entry("a/model", true), entry("b/model", true), entry("a/model", false)];
  assert.equal(isConsumed(entries, "a/model"), false);
  assert.equal(isConsumed(entries, "b/model"), true);
  assert.equal(isConsumed(entries.slice(0, 1), "a/model"), true);
  assert.equal(isConsumed([], "a/model"), false);
});

test("committed compaction grants every model a fresh allowance on that branch", () => {
  const used = (model: string) => ({ type: "custom", customType: "model-system-prompts-state", data: { version: 1, model, consumed: true } });
  const branch = [used("a/model"), used("b/model"), { type: "compaction", id: "compact-1" }];
  assert.equal(isConsumed(branch, "a/model"), false);
  assert.equal(isConsumed(branch, "b/model"), false);
  assert.equal(isConsumed([...branch, used("a/model")], "a/model"), true);
  assert.equal(isConsumed([...branch, used("a/model")], "b/model"), false);
  assert.equal(isConsumed(branch.slice(0, 2), "a/model"), true);
  assert.equal(isConsumed([...branch, used("a/model"), { type: "compaction", id: "compact-2" }], "a/model"), false);
});
