import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";
import { createJiti } from "jiti";

const SECRET = "super-secret-value-9f3a";
const previousDir = process.env.OWC_PI_OWC_DIR;
const previousUrl = process.env.OWC_DOCANONYM_URL;
const dir = await mkdtemp(path.join(os.tmpdir(), "owc-tokenizer-api-"));
const settingsFile = path.join(dir, ".owc", "settings.json");

await mkdir(path.join(dir, "lib", "docanonym"), { recursive: true });
await writeFile(path.join(dir, "lib", "project.js"), `export function findRoot(start) {
  return start;
}
`);
await writeFile(path.join(dir, "lib", "root-env.js"), `export function loadRootEnv(root, env) {
  return {
    OWC_DOCANONYM_URL: env.OWC_DOCANONYM_URL,
    OWC_UNRELATED_SECRET: ${JSON.stringify(SECRET)},
  };
}
`);
await writeFile(path.join(dir, "lib", "settings.js"), `import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const TOKENIZERS = Object.freeze(["owc", "docanonym", "union"]);

function settingsPath(root) {
  return path.join(root, ".owc", "settings.json");
}

export function usesDocAnonym(tokenizer) {
  return tokenizer === "docanonym" || tokenizer === "union";
}

export function readTokenizer(root) {
  const file = settingsPath(root);
  if (!existsSync(file)) return "owc";
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("settings.json is not valid JSON");
  }
  if (!parsed || typeof parsed.tokenizer !== "string" || parsed.tokenizer.length === 0) {
    throw new Error("settings.json tokenizer is unreadable");
  }
  // Returned as stored, including a value this UI does not list, the way a newer pi-owc would.
  return parsed.tokenizer;
}

export function writeTokenizer(root, tokenizer) {
  const file = settingsPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ tokenizer }) + "\\n");
}
`);
await writeFile(path.join(dir, "lib", "docanonym", "client.js"), `export function sendsInClear(url) {
  const parsed = new URL(url);
  if (parsed.protocol === "https:") return false;
  if (parsed.protocol === "http:") {
    const host = parsed.hostname;
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  }
  return true;
}
`);

process.env.OWC_PI_OWC_DIR = dir;
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  tsconfigPaths: true,
});
const { setTokenizer, tokenizerCard } = await jiti.import("./owc-tokenizer.ts");
const route = await jiti.import("../app/api/tokenizer/route.ts");

function assertNoOtherEnv(body) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  assert.equal(raw.includes(SECRET), false);
  assert.equal(raw.includes("OWC_UNRELATED_SECRET"), false);
}

after(async () => {
  if (previousDir === undefined) delete process.env.OWC_PI_OWC_DIR;
  else process.env.OWC_PI_OWC_DIR = previousDir;
  if (previousUrl === undefined) delete process.env.OWC_DOCANONYM_URL;
  else process.env.OWC_DOCANONYM_URL = previousUrl;
  await rm(dir, { recursive: true, force: true });
});

describe("tokenizer card", { concurrency: 1 }, () => {
  beforeEach(async () => {
    process.env.OWC_PI_OWC_DIR = dir;
    delete process.env.OWC_DOCANONYM_URL;
    await rm(path.join(dir, ".owc"), { recursive: true, force: true });
  });

  test("a missing settings file is the OWC tokenizer", async () => {
    process.env.OWC_DOCANONYM_URL = "  https://doc.example/anonymize  ";
    const card = await tokenizerCard();
    assert.deepEqual(card, {
      state: "ready",
      tokenizer: "owc",
      docanonymUrl: "https://doc.example/anonymize",
      plainHttp: false,
    });
    assertNoOtherEnv(card);
  });

  test("plain HTTP to another machine sets plainHttp", async () => {
    process.env.OWC_DOCANONYM_URL = "http://10.1.2.3:9/doc";
    const remote = await tokenizerCard();
    assert.equal(remote.state, "ready");
    assert.equal(remote.plainHttp, true);
    assert.equal(remote.docanonymUrl, "http://10.1.2.3:9/doc");

    process.env.OWC_DOCANONYM_URL = "http://127.0.0.1:9/doc";
    const loopback = await tokenizerCard();
    assert.equal(loopback.plainHttp, false);
    assertNoOtherEnv(remote);
    assertNoOtherEnv(loopback);
  });

  test("a missing or blank DocAnonym URL is null", async () => {
    const missing = await tokenizerCard();
    assert.deepEqual(missing, {
      state: "ready",
      tokenizer: "owc",
      docanonymUrl: null,
      plainHttp: false,
    });
    process.env.OWC_DOCANONYM_URL = "   ";
    const blank = await tokenizerCard();
    assert.equal(blank.docanonymUrl, null);
    assert.equal(blank.plainHttp, false);
    assertNoOtherEnv(missing);
    assertNoOtherEnv(blank);
  });

  test("a bad settings file is unavailable and is not rewritten", async () => {
    await mkdir(path.join(dir, ".owc"), { recursive: true });
    await writeFile(settingsFile, "{");
    const card = await tokenizerCard();
    assert.equal(card.state, "unavailable");
    assert.equal(card.reason, "settings.json is not valid JSON");
    const again = await setTokenizer("owc");
    assert.deepEqual(again, card);
    assert.equal(await readFile(settingsFile, "utf8"), "{");
    assertNoOtherEnv(card);
  });

  test("setTokenizer round-trips the settings file", async () => {
    process.env.OWC_DOCANONYM_URL = "https://doc.example/anonymize";
    const on = await setTokenizer("docanonym");
    assert.equal(on.tokenizer, "docanonym");
    assert.equal(JSON.parse(await readFile(settingsFile, "utf8")).tokenizer, "docanonym");
    const off = await setTokenizer("owc");
    assert.deepEqual(off, {
      state: "ready",
      tokenizer: "owc",
      docanonymUrl: "https://doc.example/anonymize",
      plainHttp: false,
    });
    assert.equal(JSON.parse(await readFile(settingsFile, "utf8")).tokenizer, "owc");
    assert.deepEqual(await tokenizerCard(), off);
    assertNoOtherEnv(on);
    assertNoOtherEnv(off);
  });

  test("a union round trip writes the settings file", async () => {
    process.env.OWC_DOCANONYM_URL = "https://doc.example/anonymize";
    const card = await setTokenizer("union");
    assert.equal(card.tokenizer, "union");
    assert.equal(await readFile(settingsFile, "utf8"), "{\"tokenizer\":\"union\"}\n");
    assertNoOtherEnv(card);
  });

  test("PUT union without OWC_DOCANONYM_URL answers 409 and leaves the file alone", async () => {
    const written = await setTokenizer("owc");
    assert.equal(written.tokenizer, "owc");
    const before = await readFile(settingsFile, "utf8");
    const refused = await route.PUT(new Request("http://localhost/api/tokenizer", {
      method: "PUT",
      headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ tokenizer: "union" }),
    }));
    const refusedText = await refused.text();
    assert.equal(refused.status, 409);
    assert.equal(await readFile(settingsFile, "utf8"), before);
    assertNoOtherEnv(refusedText);
  });

  test("a tokenizer value from a newer build shows the card as unavailable", async () => {
    await mkdir(path.join(dir, ".owc"), { recursive: true });
    const stored = "{\"tokenizer\":\"future\"}\n";
    await writeFile(settingsFile, stored);
    const card = await tokenizerCard();
    assert.equal(card.state, "unavailable");
    assert.equal(card.reason, "pi-owc readTokenizer returned an unexpected value");
    assert.equal(await readFile(settingsFile, "utf8"), stored);
    assertNoOtherEnv(card);
  });

  test("the route reads and writes the card and refuses a DocAnonym choice without a URL", async () => {
    process.env.OWC_DOCANONYM_URL = "https://doc.example/anonymize";
    const headers = { host: "localhost", "content-type": "application/json" };

    const listed = await route.GET(new Request("http://localhost/api/tokenizer", { headers }));
    const listedText = await listed.text();
    assert.equal(listed.status, 200);
    assert.equal(JSON.parse(listedText).tokenizer, "owc");
    assertNoOtherEnv(listedText);

    const saved = await route.PUT(new Request("http://localhost/api/tokenizer", {
      method: "PUT",
      headers,
      body: JSON.stringify({ tokenizer: "docanonym" }),
    }));
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).tokenizer, "docanonym");

    delete process.env.OWC_DOCANONYM_URL;
    const refused = await route.PUT(new Request("http://localhost/api/tokenizer", {
      method: "PUT",
      headers,
      body: JSON.stringify({ tokenizer: "docanonym" }),
    }));
    const refusedText = await refused.text();
    assert.equal(refused.status, 409);
    assert.equal(JSON.parse(await readFile(settingsFile, "utf8")).tokenizer, "docanonym");
    assertNoOtherEnv(refusedText);

    const turnedOff = await route.PUT(new Request("http://localhost/api/tokenizer", {
      method: "PUT",
      headers,
      body: JSON.stringify({ tokenizer: "owc" }),
    }));
    assert.equal(turnedOff.status, 200);
    assert.equal(JSON.parse(await readFile(settingsFile, "utf8")).tokenizer, "owc");

    for (const body of [JSON.stringify({}), JSON.stringify({ tokenizer: "both" }), "null"]) {
      const rejected = await route.PUT(new Request("http://localhost/api/tokenizer", {
        method: "PUT",
        headers,
        body,
      }));
      const rejectedText = await rejected.text();
      assert.equal(rejected.status, 400);
      assert.match(rejectedText, /owc or docanonym or union/);
    }

    const notJson = await route.PUT(new Request("http://localhost/api/tokenizer", {
      method: "PUT",
      headers: { host: "localhost" },
      body: JSON.stringify({ tokenizer: "owc" }),
    }));
    assert.equal(notJson.status, 415);
  });
});
