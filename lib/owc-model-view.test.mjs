import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { modelViewParts } = await jiti.import("./owc-model-view.ts");

function assistant(content) {
  return { role: "assistant", provider: "anthropic", model: "claude-test", content };
}

test("returns null when a message has no tokenized siblings", () => {
  assert.equal(modelViewParts({ role: "user", content: "hello" }), null);
  assert.equal(modelViewParts(assistant([{ type: "text", text: "hello" }])), null);
  const results = new Map([
    ["call-1", { content: [{ type: "text", text: "ok" }] }],
  ]);
  assert.equal(modelViewParts(assistant([
    { type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "a" } },
  ]), results), null);
});

test("collects raw string content and raw text blocks in order", () => {
  assert.deepEqual(
    modelViewParts({ role: "user", content: "display", rawContent: "tok<user>" }),
    [{ kind: "text", text: "tok<user>" }],
  );
  assert.deepEqual(
    modelViewParts({
      role: "custom",
      customType: "note",
      display: true,
      content: [
        { type: "text", text: "shown", rawText: "tok<a>" },
        { type: "text", text: "also shown", rawText: "tok<b>" },
        { type: "text", text: "display only" },
      ],
    }),
    [{ kind: "text", text: "tok<a>" }, { kind: "text", text: "tok<b>" }],
  );
});

test("includes tool modelInput JSON only when that field is present", () => {
  const parts = modelViewParts(assistant([
    {
      type: "toolCall",
      toolCallId: "call-1",
      toolName: "read",
      input: { path: "display" },
      modelInput: { path: "tok<path>" },
    },
    {
      type: "toolCall",
      toolCallId: "call-2",
      toolName: "bash",
      input: { command: "ls" },
    },
  ]));
  assert.deepEqual(parts, [{ kind: "toolInput", toolName: "read", json: '{\n  "path": "tok<path>"\n}' }]);
});

test("pairs a tool result raw text block by toolCallId", () => {
  const results = {
    "call-1": { content: [{ type: "text", text: "shown", rawText: "tok<result>" }, { type: "text", text: "plain" }] },
    "call-2": { content: [{ type: "text", text: "shown", rawText: "tok<other>" }] },
  };
  assert.deepEqual(modelViewParts(assistant([
    {
      type: "toolCall",
      toolCallId: "call-1",
      toolName: "read",
      input: { path: "a" },
      modelInput: { path: "tok<a>" },
    },
    { type: "toolCall", toolCallId: "call-2", toolName: "bash", input: { command: "ls" } },
  ]), results), [
    { kind: "toolInput", toolName: "read", json: '{\n  "path": "tok<a>"\n}' },
    { kind: "toolResult", text: "tok<result>" },
    { kind: "toolResult", text: "tok<other>" },
  ]);
});

test("keeps raw thinking and prefers the block over a loaded copy", () => {
  const loaded = new Map([[0, "loaded raw"], [1, "loaded second"]]);
  assert.deepEqual(
    modelViewParts(assistant([
      { type: "thinking", thinking: "preview", rawThinking: "tok<think>" },
      { type: "thinking", thinking: "preview" },
    ]), undefined, loaded),
    [{ kind: "thinking", text: "tok<think>" }, { kind: "thinking", text: "loaded second" }],
  );
});
