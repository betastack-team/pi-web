import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

const IMAGE = { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" };

function makeInner({ owc }) {
  const calls = [];
  const record = (name) => async (...args) => {
    calls.push({ name, args });
    return name === "executeBash" ? { output: "", exitCode: 0 } : null;
  };
  const inner = {
    sessionId: "session-1",
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    extensionRunner: {},
    settingsManager: { getShellPath: () => "/bin/bash" },
    sessionManager: { getCwd: () => process.cwd(), getSessionFile: () => undefined, getSessionName: () => undefined, getEntries: () => [] },
    agent: { state: {} },
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    getAllTools: () => (owc ? [{ name: "owc_read" }, { name: "write" }] : [{ name: "read" }, { name: "bash" }]),
    executeBash: record("executeBash"),
    compact: record("compact"),
    steer: record("steer"),
    followUp: record("followUp"),
    prompt: record("prompt"),
    dispose() {},
  };
  return { inner, calls };
}

function wrapperFor(t, owc) {
  const { inner, calls } = makeInner({ owc });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  return { wrapper, calls };
}

test("an OWC session refuses a ! command and never runs it", async (t) => {
  // Arrange
  const { wrapper, calls } = wrapperFor(t, true);
  // Act
  const sending = wrapper.send({ type: "bash", command: "cat notes.txt", excludeFromContext: false });
  // Assert
  await assert.rejects(sending, /owc_read/);
  assert.deepEqual(calls, []);
});

test("a session without OWC still runs a ! command", async (t) => {
  const { wrapper, calls } = wrapperFor(t, false);
  await wrapper.send({ type: "bash", command: "echo ready", excludeFromContext: true });
  assert.equal(calls[0].name, "executeBash");
});

test("an OWC session refuses images on a prompt, a steer and a follow-up", async (t) => {
  // Arrange
  const { wrapper, calls } = wrapperFor(t, true);
  for (const type of ["prompt", "steer", "follow_up"]) {
    // Act
    const sending = wrapper.send({ type, message: "what is in this?", images: [IMAGE] });
    // Assert
    await assert.rejects(sending, /image.*owc_read/su);
  }
  assert.deepEqual(calls, []);
});

test("an OWC session still takes a steer with no images", async (t) => {
  const { wrapper, calls } = wrapperFor(t, true);
  await wrapper.send({ type: "steer", message: "go on", images: [] });
  assert.equal(calls[0].name, "steer");
});

test("an OWC session refuses /compact instructions and still compacts without them", async (t) => {
  // Arrange
  const { wrapper, calls } = wrapperFor(t, true);
  // Act
  const withInstructions = wrapper.send({ type: "compact", customInstructions: "keep the client names" });
  // Assert
  await assert.rejects(withInstructions, /\/compact/);
  assert.deepEqual(calls, []);
  await wrapper.send({ type: "compact" });
  assert.deepEqual(calls.map((call) => call.args), [[undefined]]);
});

test("a session without OWC passes /compact instructions through", async (t) => {
  const { wrapper, calls } = wrapperFor(t, false);
  await wrapper.send({ type: "compact", customInstructions: "keep the schedule" });
  assert.deepEqual(calls[0].args, ["keep the schedule"]);
});
