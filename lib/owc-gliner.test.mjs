import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { lockLocalGliner } = await jiti.import("./owc-gliner.ts");

test("lockLocalGliner forces enforce over an off setting", () => {
  const previousLock = process.env.OWC_GLINER_LOCK;
  const previous = process.env.OWC_GLINER;
  process.env.OWC_GLINER_LOCK = "off";
  process.env.OWC_GLINER = "shadow";
  try {
    lockLocalGliner();
    assert.equal(process.env.OWC_GLINER_LOCK, "enforce");
    assert.equal(process.env.OWC_GLINER, "enforce");
  } finally {
    if (previousLock === undefined) delete process.env.OWC_GLINER_LOCK;
    else process.env.OWC_GLINER_LOCK = previousLock;
    if (previous === undefined) delete process.env.OWC_GLINER;
    else process.env.OWC_GLINER = previous;
  }
});

test("server startup and session creation lock the finder before the extension loads", async () => {
  const instrumentation = await readFile(new URL("../instrumentation-node.ts", import.meta.url), "utf8");
  const startup = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const subagent = await readFile(new URL("./subagent-runtime.ts", import.meta.url), "utf8");
  const register = instrumentation.slice(instrumentation.indexOf("export function registerNodeInstrumentation"));
  assert.match(register, /lockLocalGliner\(\);/);
  const start = startup.slice(startup.indexOf("export async function startRpcSession"));
  assert.match(start, /lockLocalGliner\(\);/);
  const child = subagent.slice(subagent.indexOf("async function start(request: StartSubagentRequest)"));
  const servicesAt = child.indexOf("createAgentSessionServices");
  assert.ok(servicesAt > 0);
  assert.match(child.slice(0, servicesAt), /lockLocalGliner\(\)/);
});
