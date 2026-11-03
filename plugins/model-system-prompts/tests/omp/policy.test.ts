import { expect, test } from "bun:test";
import { createPolicy } from "../../src/omp-policy.ts";

test("OMP request policy replaces only its own system text across provider formats", () => {
  const policy = createPolicy();
  const first = policy.block("A rules\n第二行");
  const formats = [
    { instructions: `BASE\n\n${first}`, input: [{ role: "user", content: first }] },
    { system: [{ type: "text", text: "BASE", cache_control: { type: "ephemeral" } }, { type: "text", text: first }] },
    { system: [{ text: `BASE\n\n${first}` }] },
    { config: { systemInstruction: { parts: [{ text: `BASE\n\n${first}` }] } } },
    { request: { systemInstruction: { parts: [{ text: `BASE\n\n${first}` }] } } },
    { messages: [{ role: "system", content: "BASE" }, { role: "developer", content: first }, { role: "user", content: first }] },
    { input: [{ role: "developer", content: [{ type: "input_text", text: `BASE\n\n${first}` }] }] },
  ];
  for (const original of formats) {
    const snapshot = structuredClone(original);
    const result = policy.patch(original, "B rules");
    expect(result.supported).toBe(true);
    expect(JSON.stringify(result.payload)).toContain("B rules");
    expect(JSON.stringify(result.payload)).toContain("BASE");
    expect(original).toEqual(snapshot);
    expect(policy.patch(result.payload, undefined).supported).toBe(true);
  }
  const messages = formats[5];
  const replaced = policy.patch(messages, "B rules").payload as typeof messages;
  expect(replaced.messages!.at(-1)).toEqual(messages.messages!.at(-1));
  expect(replaced.messages!.filter((m) => m.role !== "user").some((m) => m.content.includes("A rules"))).toBe(false);
});

test("OMP policy preserves exact pasted text and marks unsupported payloads", () => {
  const policy = createPolicy();
  const text = "  leading\ntrailing  \n";
  expect(policy.block(text)).toContain(text);
  expect(policy.patch({ unknown: true }, text).supported).toBe(false);
  const other = createPolicy();
  const base = other.block("OTHER_EXTENSION");
  const result = policy.patch({ instructions: base }, "MINE");
  expect(JSON.stringify(result.payload)).toContain("OTHER_EXTENSION");
  expect(policy.hasMarker({ messages: [{ role: "user", content: policy.block("quoted") }] })).toBe(false);
  const devin = { prompt: `SYSTEM\n${policy.block("OLD")}\nUSER: keep me` };
  const updated = policy.patch(devin, "NEW").payload as typeof devin;
  expect(updated.prompt).not.toContain("OLD");
  expect(updated.prompt.indexOf("NEW")).toBeLessThan(updated.prompt.indexOf("USER: keep me"));
});

test("Codex split instructions/developer blocks replace the owned policy exactly once", () => {
  const policy = createPolicy();
  const payload = { instructions: "BASE_SYSTEM", input: [
    { role: "developer", content: [{ type: "input_text", text: `NATIVE_COMMON\n\n${policy.block("A_ONLY")}` }] },
    { role: "user", content: "user content" },
  ] };
  const result = policy.patch(payload, "B_ONLY").payload as typeof payload;
  expect(result.instructions).toBe("BASE_SYSTEM");
  expect(JSON.stringify(result)).not.toContain("A_ONLY");
  expect(JSON.stringify(result).split("B_ONLY").length).toBe(2);
  expect(JSON.stringify(result)).toContain("NATIVE_COMMON");
  expect(result.input[1]).toEqual(payload.input[1]);
});

test("Pi raw context replaces only the latest system section marker without mutating history or tools", () => {
  const policy = createPolicy();
  const marker = policy.block("");
  const payload = { model: "test", context: { messages: [
    { role: "system", content: "BASE", sections: { addendum: `OLD_NATIVE\n\n${marker}` },
      toolsAdded: [{ name: "test", parameters: { type: "object" } }], timestamp: 1 },
    { role: "user", content: marker, timestamp: 2 },
    { role: "system", content: "", sections: { addendum: `NEW_NATIVE\n\n${marker}`, removed: null },
      toolsRemoved: [{ name: "removed" }], timestamp: 3 },
    { role: "toolResult", content: [{ type: "text", text: marker }], timestamp: 4 },
  ] }, options: { sessionId: "test-session" } };
  const snapshot = structuredClone(payload);
  expect(policy.hasMarker(payload)).toBe(true);
  const result = policy.patch(payload, "NEW_RULE", "last").payload as typeof payload;
  expect(payload).toEqual(snapshot);
  expect(result.context.messages[0].sections!.addendum).toBe("OLD_NATIVE");
  expect(result.context.messages[2].sections!.addendum).toContain("NEW_RULE");
  expect(result.context.messages[2].sections!.removed).toBeNull();
  expect(result.context.messages[0].toolsAdded).toEqual(payload.context.messages[0].toolsAdded);
  expect(result.context.messages[2].toolsRemoved).toEqual(payload.context.messages[2].toolsRemoved);
  expect(result.context.messages[1]).toEqual(payload.context.messages[1]);
  expect(result.context.messages[3]).toEqual(payload.context.messages[3]);
  expect(result.options).toEqual(payload.options);
  expect(policy.hasMarker({ context: { messages: [payload.context.messages[1], payload.context.messages[3]] } })).toBe(false);
  const stripped = policy.patch(payload, undefined, "last").payload as typeof payload;
  expect(stripped.context.messages[0].sections!.addendum).toBe("OLD_NATIVE");
  expect(stripped.context.messages[2].sections!.addendum).toBe("NEW_NATIVE");
});
