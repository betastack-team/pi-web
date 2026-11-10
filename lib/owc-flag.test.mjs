import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { createJiti } from "jiti";

const previousDir = process.env.OWC_PI_OWC_DIR;
const dir = await mkdtemp(path.join(os.tmpdir(), "owc-flag-api-"));
const callsFile = path.join(dir, "calls.jsonl");
const projectDir = path.join(dir, "project");
const fileCwd = path.join(dir, "notes.txt");

await mkdir(path.join(dir, "lib"), { recursive: true });
await mkdir(projectDir, { recursive: true });
await writeFile(fileCwd, "not a directory");
await writeFile(path.join(dir, "lib", "project.js"), `export function findRoot(start) {
  return start;
}
`);
await writeFile(path.join(dir, "lib", "flag.js"), `import { appendFileSync } from "node:fs";
const CALLS = ${JSON.stringify(callsFile)};
export function flagValue(root, request) {
  appendFileSync(CALLS, JSON.stringify({ fn: "flagValue", root, request }) + "\\n");
  const raw = String(request.raw).trim();
  if (!raw) return { ok: false, reason: "empty" };
  return { ok: true, token: "⟦" + request.cls + ":0123456789"[0] + "ABCDEFG⟧", sweepable: raw.length >= 6, quarantined: "/secret/path" };
}
export function requestUnflag(root, request) {
  appendFileSync(CALLS, JSON.stringify({ fn: "requestUnflag", root, request }) + "\\n");
}
`);

process.env.OWC_PI_OWC_DIR = dir;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, tsconfigPaths: true });
const route = await jiti.import("../app/api/owc-flag/route.ts");

after(async () => {
  if (previousDir === undefined) delete process.env.OWC_PI_OWC_DIR;
  else process.env.OWC_PI_OWC_DIR = previousDir;
  await rm(dir, { recursive: true, force: true });
});

const ORIGIN = "http://localhost:3000";
function call(method, body, headers = {}) {
  return new Request(`${ORIGIN}/api/owc-flag`, {
    method,
    headers: { "content-type": "application/json", host: "localhost:3000", origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function calls() {
  try {
    return (await readFile(callsFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

describe("owc-flag route", { concurrency: 1 }, () => {
  test("hides a value and answers with the token and sweepable only", async () => {
    const response = await route.POST(call("POST", { cls: "NAME", raw: "Jordan Quill", docRef: "abc", cwd: projectDir }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["ok", "sweepable", "token"]);
    assert.equal(body.sweepable, true);
    const [recorded] = await calls();
    assert.equal(recorded.root, projectDir);
    assert.deepEqual(recorded.request, { cls: "NAME", raw: "Jordan Quill", docRef: "abc" });
  });

  test("a short value reports sweepable false", async () => {
    const body = await (await route.POST(call("POST", { cls: "ACCT", raw: "Q9", cwd: projectDir }))).json();
    assert.equal(body.ok, true);
    assert.equal(body.sweepable, false);
  });

  test("an unknown class, a non-string value and a bad body are 400 and reach nothing", async () => {
    const before = (await calls()).length;
    assert.equal((await route.POST(call("POST", { cls: "NOPE", raw: "x" }))).status, 400);
    assert.equal((await route.POST(call("POST", { cls: "NAME", raw: 5 }))).status, 400);
    assert.equal((await route.POST(call("POST", "{nope"))).status, 400);
    assert.equal((await calls()).length, before);
  });

  test("pi-owc rejecting the value is a 400", async () => {
    const response = await route.POST(call("POST", { cls: "NAME", raw: "   ", cwd: projectDir }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, reason: "empty" });
  });

  test("a cross-site or non-JSON request is refused", async () => {
    assert.equal((await route.POST(call("POST", { cls: "NAME", raw: "Jordan Quill" }, { origin: "https://evil.example" }))).status, 403);
    assert.equal((await route.POST(call("POST", { cls: "NAME", raw: "Jordan Quill" }, { "content-type": "text/plain" }))).status, 415);
  });

  test("show this only records a request for a token", async () => {
    const before = (await calls()).length;
    const response = await route.DELETE(call("DELETE", { token: "⟦NAME:0ABCDEFG⟧", cwd: projectDir }));
    assert.equal(response.status, 200);
    const after = await calls();
    assert.equal(after.length, before + 1);
    assert.equal(after.at(-1).fn, "requestUnflag");
    assert.equal(after.at(-1).root, projectDir);
    assert.equal((await route.DELETE(call("DELETE", { token: "Jordan Quill" }))).status, 400);
  });

  async function assertNoProject(extra) {
    const before = await calls();
    const posted = await route.POST(call("POST", { cls: "NAME", raw: "Jordan Quill", ...extra }));
    assert.equal(posted.status, 400);
    assert.deepEqual(await posted.json(), { ok: false, reason: "no-project" });
    const removed = await route.DELETE(call("DELETE", { token: "⟦NAME:0ABCDEFG⟧", ...extra }));
    assert.equal(removed.status, 400);
    assert.deepEqual(await removed.json(), { ok: false, reason: "no-project" });
    const after = await calls();
    assert.equal(after.length, before.length);
    assert.equal(after.slice(before.length).some((entry) => entry.fn === "flagValue"), false);
  }

  test("a missing cwd is no-project and flagValue is not called", async () => {
    await assertNoProject({});
  });

  test("a relative cwd is no-project and flagValue is not called", async () => {
    await assertNoProject({ cwd: "relative/project" });
  });

  test("a non-directory cwd is no-project and flagValue is not called", async () => {
    await assertNoProject({ cwd: fileCwd });
  });
});
