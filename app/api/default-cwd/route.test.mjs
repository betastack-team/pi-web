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

test("POST /api/default-cwd returns the OWC root", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-default-cwd-"));
  const piOwcDir = join(dir, "pi-owc");
  await mkdir(piOwcDir);
  await writeFile(join(piOwcDir, "package.json"), "{}");
  const previous = process.env.OWC_PI_OWC_DIR;
  process.env.OWC_PI_OWC_DIR = piOwcDir;
  t.after(async () => {
    if (previous === undefined) delete process.env.OWC_PI_OWC_DIR;
    else process.env.OWC_PI_OWC_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const { POST } = await jiti.import("./route.ts");

  const response = await POST();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cwd: dir });
});
