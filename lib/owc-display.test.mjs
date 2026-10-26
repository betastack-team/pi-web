import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  createDisplayEventTransformer,
  displayForCwd,
  displayFromVault,
  heldSuffixLength,
} = await jiti.import("./owc-display.ts");

const SPECIMEN = "⟦SSN:7K3M9Q2A⟧";
const SECRET = "123-45-6789";
const UNKNOWN = "⟦SSN:7K3M9Q2B⟧";

function vault() {
  return {
    resolve(token) {
      return token === SPECIMEN ? SECRET : undefined;
    },
  };
}

function display() {
  return displayFromVault(vault());
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

test("heldSuffixLength keeps only an unfinished token", () => {
  assert.equal(heldSuffixLength("hello"), 0);
  assert.equal(heldSuffixLength("⟦"), 1);
  assert.equal(heldSuffixLength("see ⟦SSN:7K3M9Q2A"), "⟦SSN:7K3M9Q2A".length);
  assert.equal(heldSuffixLength("⟦DATE:7K3M9Q2A"), "⟦DATE:7K3M9Q2A".length);
  assert.equal(heldSuffixLength("⟦EMAIL:7K3M9Q2A"), "⟦EMAIL:7K3M9Q2A".length);
  assert.equal(heldSuffixLength("⟦ABCDEF:7K3M9Q2A"), "⟦ABCDEF:7K3M9Q2A".length);
  assert.equal("⟦SSN:7K3M9Q2A".length, 13);
  assert.equal("⟦DATE:7K3M9Q2A".length, 14);
  assert.equal("⟦EMAIL:7K3M9Q2A".length, 15);
  assert.equal("⟦ABCDEF:7K3M9Q2A".length, 16);
  assert.equal(heldSuffixLength(SPECIMEN), 0);
  assert.equal(heldSuffixLength(`prefix ${SPECIMEN}`), 0);
});

test("a frozen message keeps its JSON and gains display copy", () => {
  const message = freezeDeep({
    role: "user",
    content: `ssn ${SPECIMEN}`,
    timestamp: 5,
  });
  const before = JSON.stringify(message);
  const presented = display().presentMessage(message);
  assert.equal(JSON.stringify(message), before);
  assert.notEqual(presented, message);
  assert.equal(presented.content, `ssn ${SECRET}`);
  assert.equal(presented.rawContent, `ssn ${SPECIMEN}`);
  assert.equal(presented.timestamp, 5);
  assert.equal(Object.hasOwn(message, "rawContent"), false);
});

test("a message without tokens is the same object", () => {
  const message = { role: "assistant", content: [{ type: "text", text: "hello" }] };
  const view = display();
  assert.equal(view.presentMessage(message), message);
  const context = { messages: [message], entryIds: ["e1"] };
  assert.equal(view.presentContext(context), context);
});

test("tool call paths stay tokenized and other arguments are display copy", () => {
  const meta = { note: `see ${SPECIMEN}` };
  const input = { path: `dir/${SPECIMEN}`, note: `see ${SPECIMEN}`, meta };
  const message = freezeDeep({
    role: "assistant",
    content: [{
      type: "toolCall",
      toolCallId: "call-1",
      toolName: "read",
      input,
    }],
  });
  const before = JSON.stringify(message);
  const presented = display().presentMessage(message);
  assert.equal(JSON.stringify(message), before);
  const block = presented.content[0];
  assert.equal(block.input.path, `dir/${SPECIMEN}`);
  assert.equal(block.input.note, `see ${SECRET}`);
  assert.equal(block.input.meta.note, `see ${SECRET}`);
  assert.deepEqual(block.modelInput, input);
  assert.notEqual(block.modelInput, input);
  assert.notEqual(block.modelInput.meta, meta);
  assert.equal(message.content[0].modelInput, undefined);
});

test("an unknown token is unchanged and has no raw sibling", () => {
  const message = { role: "user", content: `id ${UNKNOWN}` };
  assert.equal(display().presentMessage(message), message);
  assert.equal(Object.hasOwn(message, "rawContent"), false);

  const blockMessage = {
    role: "assistant",
    content: [{ type: "text", text: UNKNOWN }, { type: "thinking", thinking: UNKNOWN }],
  };
  assert.equal(display().presentMessage(blockMessage), blockMessage);
  assert.equal(Object.hasOwn(blockMessage.content[0], "rawText"), false);
  assert.equal(Object.hasOwn(blockMessage.content[1], "rawThinking"), false);
});

test("thinking and bash output become display copy", () => {
  const thinking = display().presentMessage({
    role: "assistant",
    content: [{ type: "thinking", thinking: `born ${SPECIMEN}` }],
  });
  assert.equal(thinking.content[0].thinking, `born ${SECRET}`);
  assert.equal(thinking.content[0].rawThinking, `born ${SPECIMEN}`);

  const bash = {
    role: "bashExecution",
    command: SPECIMEN,
    output: `out ${SPECIMEN}`,
  };
  const presented = display().presentMessage(bash);
  assert.equal(presented.command, SPECIMEN);
  assert.equal(presented.output, `out ${SECRET}`);
  assert.equal(bash.output, `out ${SPECIMEN}`);
  assert.equal(Object.hasOwn(presented, "rawOutput"), false);
});

test("context copy keeps untouched messages", () => {
  const plain = { role: "user", content: "hi", transcriptNotices: [{ kind: "cache_miss" }] };
  const secret = { role: "user", content: SPECIMEN };
  const context = { messages: [plain, secret], entryIds: ["a", "b"], thinkingLevel: "off" };
  const presented = display().presentContext(context);
  assert.notEqual(presented, context);
  assert.equal(presented.messages[0], plain);
  assert.equal(presented.messages[1].content, SECRET);
  assert.equal(presented.messages[1].rawContent, SPECIMEN);
  assert.equal(presented.entryIds, context.entryIds);
  assert.equal(context.messages[1], secret);
});

test("deltas hold a token split across three chunks", () => {
  const transform = createDisplayEventTransformer(display());
  const first = {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x ⟦SSN:7" },
  };
  const second = {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "K3M9Q2" },
  };
  const third = {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "A⟧ y" },
  };
  const opened = transform(first);
  const held = transform(second);
  const closed = transform(third);
  assert.equal(opened.assistantMessageEvent.delta, "x ");
  assert.equal(held, null);
  assert.equal(closed.assistantMessageEvent.delta, `${SECRET} y`);
  assert.equal(first.assistantMessageEvent.delta, "x ⟦SSN:7");
  assert.equal(`${opened.assistantMessageEvent.delta}${closed.assistantMessageEvent.delta}`, `x ${SECRET} y`);
});

test("text_end flushes the full detokenized content", () => {
  const transform = createDisplayEventTransformer(display());
  const event = {
    type: "message_update",
    assistantMessageEvent: { type: "text_end", contentIndex: 0, content: `see ${SPECIMEN}` },
  };
  const flushed = transform(event);
  assert.equal(flushed.assistantMessageEvent.content, `see ${SECRET}`);
  assert.equal(event.assistantMessageEvent.content, `see ${SPECIMEN}`);
  assert.equal(Object.hasOwn(flushed.assistantMessageEvent, "rawText"), false);
});

test("content indexes keep separate buffers", () => {
  const transform = createDisplayEventTransformer(display());
  const text = transform({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "A ⟦SSN:7" },
  });
  const thinking = transform({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 1, delta: "B ⟦SSN:7" },
  });
  assert.equal(text.assistantMessageEvent.delta, "A ");
  assert.equal(thinking.assistantMessageEvent.delta, "B ");
  const textDone = transform({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "K3M9Q2A⟧" },
  });
  const thinkingHeld = transform({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 1, delta: "K3" },
  });
  assert.equal(textDone.assistantMessageEvent.delta, SECRET);
  assert.equal(thinkingHeld, null);
});

test("message start holds a trailing partial and tool calls stay raw until end", () => {
  const transform = createDisplayEventTransformer(display());
  const input = { path: SPECIMEN, note: SPECIMEN };
  const event = {
    type: "message_start",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "id ⟦SSN:7K3M9Q2" },
        { type: "toolCall", toolCallId: "call-1", toolName: "read", input },
      ],
    },
  };
  const started = transform(event);
  assert.equal(started.message.content[0].text, "id ");
  assert.equal(event.message.content[0].text, "id ⟦SSN:7K3M9Q2");
  assert.equal(started.message.content[1].input, input);
  const toolDelta = {
    type: "message_update",
    assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: SPECIMEN },
  };
  assert.equal(transform(toolDelta), toolDelta);
  const ended = transform({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", toolCallId: "call-1", toolName: "read", input }],
    },
  });
  assert.equal(ended.message.content[0].input.note, SECRET);
  assert.equal(ended.message.content[0].input.path, SPECIMEN);
  assert.deepEqual(ended.message.content[0].modelInput, input);
  assert.notEqual(ended.message.content[0].modelInput, input);
});

test("an identity display returns the same event", () => {
  const transform = createDisplayEventTransformer(displayFromVault(null));
  const event = {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "⟦SSN:7" },
  };
  assert.equal(transform(event), event);
  assert.equal(displayFromVault(null).isIdentity, true);
  assert.equal(displayFromVault(null).presentText(SPECIMEN), SPECIMEN);
});

test("tool execution updates detokenize text blocks only", () => {
  const transform = createDisplayEventTransformer(display());
  const event = {
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "bash",
    partialResult: {
      content: [{ type: "text", text: SPECIMEN }, { type: "image", source: { type: "url" } }],
      details: { note: SPECIMEN },
    },
  };
  const updated = transform(event);
  assert.equal(updated.partialResult.content[0].text, SECRET);
  assert.equal(updated.partialResult.content[0].rawText, SPECIMEN);
  assert.equal(updated.partialResult.content[1], event.partialResult.content[1]);
  assert.equal(updated.partialResult.details, event.partialResult.details);
  assert.equal(event.partialResult.content[0].text, SPECIMEN);
  const plain = {
    type: "tool_execution_update",
    partialResult: { content: [{ type: "text", text: "ok" }] },
  };
  assert.equal(transform(plain), plain);
});

test("displayForCwd detokenizes through the loaded vault", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "owc-display-open-"));
  const vaultHome = await mkdtemp(path.join(os.tmpdir(), "owc-vault-open-"));
  const previousHome = process.env.OWC_VAULT_HOME;
  const id = "ab".repeat(16);
  process.env.OWC_VAULT_HOME = vaultHome;
  try {
    const projectDir = path.join(root, ".owc");
    const vaultDir = path.join(vaultHome, id);
    await mkdir(projectDir, { recursive: true });
    await mkdir(vaultDir, { recursive: true });
    await chmod(vaultHome, 0o700);
    await chmod(vaultDir, 0o700);
    await writeFile(path.join(projectDir, "knowledge.json"), "{}\n");
    await writeFile(path.join(projectDir, "vault-id"), `${id}\n`, { mode: 0o600 });
    await writeFile(path.join(vaultDir, "key"), `${"cd".repeat(32)}\n`, { mode: 0o600 });
    await writeFile(
      path.join(vaultDir, "entries.jsonl"),
      `${JSON.stringify({ t: "SSN:7K3M9Q2A", c: "SSN", r: SECRET })}\n`,
      { mode: 0o600 },
    );
    await chmod(path.join(vaultDir, "key"), 0o600);
    await chmod(path.join(vaultDir, "entries.jsonl"), 0o600);
    const opened = await displayForCwd(root);
    assert.equal(opened.isIdentity, false);
    const message = { role: "user", content: `ssn ${SPECIMEN}` };
    const presented = opened.presentMessage(message);
    assert.equal(presented.content, `ssn ${SECRET}`);
    assert.equal(presented.rawContent, `ssn ${SPECIMEN}`);
    assert.equal(message.content, `ssn ${SPECIMEN}`);
    const tool = opened.presentMessage({
      role: "assistant",
      content: [{
        type: "toolCall",
        toolCallId: "call-1",
        toolName: "read",
        input: { path: SPECIMEN, note: SPECIMEN },
      }],
    });
    assert.equal(tool.content[0].input.path, SPECIMEN);
    assert.equal(tool.content[0].input.note, SECRET);
    assert.equal(tool.content[0].modelInput.note, SPECIMEN);
  } finally {
    if (previousHome === undefined) delete process.env.OWC_VAULT_HOME;
    else process.env.OWC_VAULT_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
    await rm(vaultHome, { recursive: true, force: true });
  }
});

test("displayForCwd does not create a vault when only knowledge.json exists", async () => {
  const rootA = await mkdtemp(path.join(os.tmpdir(), "owc-display-a-"));
  const rootB = await mkdtemp(path.join(os.tmpdir(), "owc-display-b-"));
  const vaultHome = await mkdtemp(path.join(os.tmpdir(), "owc-vault-home-"));
  const previousHome = process.env.OWC_VAULT_HOME;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map((part) => String(part)).join(" "));
  };
  process.env.OWC_VAULT_HOME = vaultHome;
  try {
    await mkdir(path.join(rootA, ".owc"), { recursive: true });
    await mkdir(path.join(rootB, ".owc"), { recursive: true });
    await writeFile(path.join(rootA, ".owc", "knowledge.json"), "{}\n");
    await writeFile(path.join(rootB, ".owc", "knowledge.json"), "{}\n");
    const displayA = await displayForCwd(rootA);
    const displayB = await displayForCwd(rootB);
    assert.equal(displayA.isIdentity, true);
    assert.equal(displayB.isIdentity, true);
    assert.equal(existsSync(path.join(rootA, ".owc", "vault-id")), false);
    assert.equal(existsSync(path.join(rootB, ".owc", "vault-id")), false);
    assert.equal(warnings.length, 2);
    assert.equal(await displayForCwd(rootA), displayA);
    assert.equal(warnings.length, 2);
  } finally {
    console.warn = originalWarn;
    if (previousHome === undefined) delete process.env.OWC_VAULT_HOME;
    else process.env.OWC_VAULT_HOME = previousHome;
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
    await rm(vaultHome, { recursive: true, force: true });
  }
});

test("displayForCwd picks up a vault that appears after a miss", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "owc-display-later-"));
  const vaultHome = await mkdtemp(path.join(os.tmpdir(), "owc-vault-later-"));
  const previousHome = process.env.OWC_VAULT_HOME;
  const id = "ef".repeat(16);
  process.env.OWC_VAULT_HOME = vaultHome;
  try {
    await mkdir(path.join(root, ".owc"), { recursive: true });
    await writeFile(path.join(root, ".owc", "knowledge.json"), "{}\n");
    const missed = await displayForCwd(root);
    assert.equal(missed.isIdentity, true);
    const stillToken = missed.presentMessage({ role: "user", content: `ssn ${SPECIMEN}` });
    assert.equal(stillToken.content, `ssn ${SPECIMEN}`);

    const vaultDir = path.join(vaultHome, id);
    await mkdir(vaultDir, { recursive: true });
    await chmod(vaultHome, 0o700);
    await chmod(vaultDir, 0o700);
    await writeFile(path.join(root, ".owc", "vault-id"), `${id}\n`, { mode: 0o600 });
    await writeFile(path.join(vaultDir, "key"), `${"cd".repeat(32)}\n`, { mode: 0o600 });
    await writeFile(
      path.join(vaultDir, "entries.jsonl"),
      `${JSON.stringify({ t: "SSN:7K3M9Q2A", c: "SSN", r: SECRET })}\n`,
      { mode: 0o600 },
    );
    await chmod(path.join(vaultDir, "key"), 0o600);
    await chmod(path.join(vaultDir, "entries.jsonl"), 0o600);

    const opened = await displayForCwd(root);
    assert.equal(opened.isIdentity, false);
    const presented = opened.presentMessage({ role: "user", content: `ssn ${SPECIMEN}` });
    assert.equal(presented.content, `ssn ${SECRET}`);
    assert.equal(presented.rawContent, `ssn ${SPECIMEN}`);
    assert.equal(await displayForCwd(root), opened);
  } finally {
    if (previousHome === undefined) delete process.env.OWC_VAULT_HOME;
    else process.env.OWC_VAULT_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
    await rm(vaultHome, { recursive: true, force: true });
  }
});
