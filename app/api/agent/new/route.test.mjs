import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
});

async function withOwcRoot(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-agent-new-"));
  const root = join(dir, "owc");
  const piOwcDir = join(root, "pi-owc");
  const outside = join(dir, "elsewhere");
  await mkdir(join(piOwcDir, "extensions"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(piOwcDir, "package.json"), "{}");
  const previous = process.env.OWC_PI_OWC_DIR;
  process.env.OWC_PI_OWC_DIR = piOwcDir;
  t.after(async () => {
    if (previous === undefined) delete process.env.OWC_PI_OWC_DIR;
    else process.env.OWC_PI_OWC_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  return { root, outside };
}

function post(body) {
  return new Request("http://localhost/api/agent/new", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST /api/agent/new refuses a folder outside the OWC root", async (t) => {
  const { outside } = await withOwcRoot(t);
  const { POST } = await jiti.import("./route.ts");

  const response = await POST(post({ cwd: outside, type: "ensure_session" }));

  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /not an OWC project/);
});

test("POST /api/agent/new refuses chat only", async (t) => {
  const { root } = await withOwcRoot(t);
  const { POST } = await jiti.import("./route.ts");

  const response = await POST(post({ cwd: root, type: "ensure_session", toolNames: [] }));

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Chat only is not available/);
});
