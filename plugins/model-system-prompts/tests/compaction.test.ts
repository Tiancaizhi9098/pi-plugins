import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./helpers.ts";
import { isConsumed } from "../src/core.ts";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const offlineCompactor: ExtensionFactory = (pi) => { pi.on("session_before_compact", (event) => ({ compaction: {
  summary: "Offline summary of previous work", firstKeptEntryId: event.preparation.firstKeptEntryId,
  tokensBefore: event.preparation.tokensBefore,
} })); };

for (const transport of ["responses", "pi-messages"] as const) test(`Pi ${transport} manual compaction and reload give A and B an independent fresh first run`, async (t) => {
  const f = await fixture(t);
  f.bind("test-a", "once", "COMPACT_A");
  f.bind("test-b", "once", "COMPACT_B");
  const h = await f.start(undefined, [offlineCompactor], transport);
  await h.session.prompt("A before");
  await h.session.setModel(f.model("test-b"));
  await h.session.prompt("B before");
  await h.session.compact();
  assert.equal(isConsumed(h.manager.getBranch(), "test-a/shared"), false);
  assert.equal(isConsumed(h.manager.getBranch(), "test-b/shared"), false);
  await h.session.reload();
  await h.session.prompt("B after");
  await h.session.prompt("B again");
  await h.session.setModel(f.model("test-a"));
  await h.session.prompt("A after");
  await h.session.prompt("A again");
  assert.match(h.requests[2].system, /COMPACT_B/);
  assert.doesNotMatch(h.requests[3].system, /COMPACT_B/);
  assert.match(h.requests[4].system, /COMPACT_A/);
  assert.doesNotMatch(h.requests[5].system, /COMPACT_A/);
  assert.doesNotMatch(JSON.stringify(h.manager.getEntries()), /COMPACT_[AB]/);
});

for (const transport of ["responses", "pi-messages"] as const) test(`Pi ${transport} overflow compaction reinjects on the immediate retry and not the next user run`, async (t) => {
  const f = await fixture(t);
  f.bind("test-a", "once", "OVERFLOW_REINJECT");
  const h = await f.start(undefined, [offlineCompactor], transport);
  await h.session.prompt("consume initial allowance");
  h.session.setAutoCompactionEnabled(true);
  h.replies.push({ content: [], stopReason: "error", errorMessage: "maximum context length exceeded" });
  await h.session.prompt("overflow then retry");
  assert.equal(h.requests.length, 3);
  assert.doesNotMatch(h.requests[1].system, /OVERFLOW_REINJECT/);
  assert.match(h.requests[2].system, /OVERFLOW_REINJECT/);
  await h.session.prompt("next user run");
  assert.doesNotMatch(h.requests[3].system, /OVERFLOW_REINJECT/);
  assert.deepEqual(h.errors, []);
});

test("Pi cancelled compaction does not renew a used allowance", async (t) => {
  const f = await fixture(t);
  f.bind("test-a", "once", "CANCELLED_COMPACT");
  const h = await f.start(undefined, [(pi) => { pi.on("session_before_compact", () => ({ cancel: true })); }]);
  await h.session.prompt("first");
  await assert.rejects(h.session.compact(), /cancel/i);
  await h.session.prompt("next");
  assert.doesNotMatch(h.requests[1].system, /CANCELLED_COMPACT/);
});

test("Pi failed compaction does not renew a used allowance", async (t) => {
  const f = await fixture(t);
  f.bind("test-a", "once", "FAILED_COMPACT");
  const h = await f.start();
  await h.session.prompt("first");
  h.replies.push({ content: [], stopReason: "error", errorMessage: "synthetic compaction failure" });
  await assert.rejects(h.session.compact(), /synthetic compaction failure/);
  await h.session.prompt("next");
  assert.doesNotMatch(h.requests.at(-1)!.system, /FAILED_COMPACT/);
});
