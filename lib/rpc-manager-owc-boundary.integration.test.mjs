import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });

const NOT_OWC_PROJECT = "This folder is not an OWC project: the OWC privacy extension is not loaded, so the session was closed.";
const CHAT_ONLY_REFUSED = "Chat only is not available: it loads no extensions, so the OWC privacy extension would not run.";

const FULL_BOUNDARY = `export default function (pi) {
  pi.on("input", () => ({ action: "continue" }));
  pi.on("tool_call", () => undefined);
  pi.on("tool_result", () => undefined);
}
`;

async function withPiOwc(t, extensionSource) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-owc-boundary-"));
  const agentDir = join(dir, "agent");
  const piOwcDir = join(dir, "owc", "pi-owc");
  const cwd = join(dir, "owc", "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(piOwcDir, "extensions"), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(join(agentDir, "settings.json"), "{}");
  await writeFile(join(piOwcDir, "package.json"), JSON.stringify({
    name: "owc-boundary-test",
    type: "module",
    keywords: ["pi-package"],
    pi: { extensions: ["./extensions/index.js"] },
  }));
  await writeFile(join(piOwcDir, "extensions", "index.js"), extensionSource);
  const previous = { agent: process.env.PI_CODING_AGENT_DIR, piOwc: process.env.OWC_PI_OWC_DIR };
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.OWC_PI_OWC_DIR = piOwcDir;
  t.after(async () => {
    for (const [key, value] of [["PI_CODING_AGENT_DIR", previous.agent], ["OWC_PI_OWC_DIR", previous.piOwc]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  return { cwd };
}

async function sessionsIn(cwd) {
  const { getRpcSessionInfos } = await jiti.import("./rpc-manager.ts");
  return getRpcSessionInfos({ includeTransient: true }).filter((info) => info.cwd === cwd);
}

test("a session loads pi-owc from the OWC root and starts with its boundary hooks", async (t) => {
  const { cwd } = await withPiOwc(t, FULL_BOUNDARY);
  const { startRpcSession } = await jiti.import("./rpc-manager.ts");
  const { hasOwcBoundary } = await jiti.import("./owc-boundary.ts");

  const { session } = await startRpcSession("__new__owc-boundary-ok", "", cwd, {});
  t.after(() => session.shutdown());

  assert.equal(hasOwcBoundary(session.inner), true);
});

test("a session whose OWC extension failed to load is closed", async (t) => {
  const { cwd } = await withPiOwc(t, `export default function () { throw new Error("broken install"); }\n`);
  const { startRpcSession } = await jiti.import("./rpc-manager.ts");

  await assert.rejects(startRpcSession("__new__owc-boundary-broken", "", cwd, {}), { message: NOT_OWC_PROJECT });

  assert.deepEqual(await sessionsIn(cwd), []);
});

test("a session whose OWC extension lacks a boundary hook is closed", async (t) => {
  const { cwd } = await withPiOwc(t, `export default function (pi) { pi.on("input", () => ({ action: "continue" })); }\n`);
  const { startRpcSession } = await jiti.import("./rpc-manager.ts");

  await assert.rejects(startRpcSession("__new__owc-boundary-partial", "", cwd, {}), { message: NOT_OWC_PROJECT });

  assert.deepEqual(await sessionsIn(cwd), []);
});

test("chat only is refused, because it would start pi without extensions", async (t) => {
  const { cwd } = await withPiOwc(t, FULL_BOUNDARY);
  const { startRpcSession } = await jiti.import("./rpc-manager.ts");

  await assert.rejects(startRpcSession("__new__owc-boundary-chat-only", "", cwd, { toolNames: [] }), { message: CHAT_ONLY_REFUSED });

  assert.deepEqual(await sessionsIn(cwd), []);
});
