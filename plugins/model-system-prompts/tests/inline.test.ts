import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { test } from "node:test";
import { fixture } from "./helpers.ts";
import { loadConfig, saveBinding } from "../src/core.ts";

test("inline prompts preserve pasted text and inject once per provider/model", async (t) => {
  const f = await fixture(t);
  const prompt = '  用中文回答。\n\n路径 C:\\project\\test；"引用"\n末行\n';
  saveBinding(f.configPath, "test-a/shared", { prompt, mode: "once" });
  assert.deepEqual(loadConfig(f.configPath).bindings["test-a/shared"], { prompt, mode: "once" });
  const h = await f.start();
  await h.session.prompt("first");
  await h.session.prompt("second");
  assert.ok(h.requests[0].system.endsWith(prompt));
  assert.ok(!h.requests[1].system.includes(prompt));
  assert.ok(!JSON.stringify(h.manager.getEntries()).includes(prompt));
});

test("menu lists available models and configures another model without switching conversation model", async (t) => {
  const f = await fixture(t);
  const h = await f.start();
  const prompt = "B 的规则\n第二行";
  const lists: string[][] = [];
  await h.session.bindExtensions({ mode: "rpc", uiContext: {
    ...h.session.extensionRunner.createContext().ui,
    select: async (title, options) => {
      lists.push(options);
      if (title.includes("选择模型")) return options.find((label) => label.includes("test-b/shared"));
      return "仅首轮生效";
    },
    editor: async () => prompt,
  } });
  await h.session.prompt("/model-system");
  assert.ok(lists[0].some((label) => label.includes("test-a/shared")));
  assert.ok(lists[0].some((label) => label.includes("test-b/shared")));
  assert.ok(lists[0].some((label) => label.includes("test-c/shared")));
  assert.deepEqual(loadConfig(f.configPath).bindings, { "test-b/shared": { prompt, mode: "once" } });
  assert.equal(h.session.model?.provider, "test-a");
  assert.equal(h.requests.length, 0);
  await h.session.setModel(f.model("test-b"));
  await h.session.prompt("first B");
  assert.ok(h.requests[0].system.includes(prompt));
});

test("cancelled model, editor, or mode dialogs leave saved text and state unchanged", async (t) => {
  const f = await fixture(t);
  saveBinding(f.configPath, "test-b/shared", { prompt: "Original", mode: "always" });
  const original = readFileSync(f.configPath, "utf8");
  const h = await f.start();
  for (const stage of ["model", "editor", "mode"]) {
    await h.session.bindExtensions({ mode: "rpc", uiContext: {
      ...h.session.extensionRunner.createContext().ui,
      select: async (title, options) => {
        if (title.includes("选择模型")) return stage === "model" ? undefined : options.find((x) => x.includes("test-b/shared"));
        if (title.includes("操作")) return "编辑提示词";
        return undefined;
      },
      editor: async (_title, prefill) => {
        assert.equal(prefill, "Original");
        return stage === "editor" ? undefined : "New text";
      },
    } });
    await h.session.prompt("/model-system");
    assert.equal(readFileSync(f.configPath, "utf8"), original);
  }
  assert.equal(h.requests.length, 0);
});

test("list shows available models including unconfigured models", async (t) => {
  const f = await fixture(t);
  const h = await f.start();
  const notices: string[] = [];
  await h.session.bindExtensions({ mode: "rpc", uiContext: {
    ...h.session.extensionRunner.createContext().ui,
    notify: (message) => { notices.push(message); },
  } });
  await h.session.prompt("/model-system list");
  for (const provider of ["test-a", "test-b", "test-c"]) assert.ok(notices.join("\n").includes(`${provider}/shared`));
});

test("editing a legacy file binding saves independent pasted text", async (t) => {
  const f = await fixture(t);
  const file = f.bind("test-a", "always", "LEGACY_TEXT");
  const h = await f.start();
  await h.session.bindExtensions({ mode: "rpc", uiContext: {
    ...h.session.extensionRunner.createContext().ui,
    editor: async (_title, prefill) => { assert.equal(prefill, "LEGACY_TEXT"); return "PASTED_TEXT\n第二行"; },
    select: async () => "持续生效",
  } });
  await h.session.prompt("/model-system edit");
  rmSync(file);
  assert.deepEqual(loadConfig(f.configPath).bindings["test-a/shared"], { prompt: "PASTED_TEXT\n第二行", mode: "always" });
  await h.session.prompt("after deleting old file");
  assert.match(h.requests[0].system, /PASTED_TEXT/);
  assert.doesNotMatch(h.requests[0].system, /LEGACY_TEXT/);
});
