import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const previousDir = process.env.OWC_PI_OWC_DIR;
const dir = await mkdtemp(path.join(os.tmpdir(), "owc-sharepoint-api-"));
await mkdir(path.join(dir, "lib"), { recursive: true });
await writeFile(path.join(dir, "lib", "project.js"), `export function findRoot(start) {
  return start;
}
`);
await writeFile(path.join(dir, "lib", "root-env.js"), `export function loadRootEnv(root, env) {
  return { ...env };
}
`);
await writeFile(path.join(dir, "lib", "sharepoint.js"), `export const NOT_CONNECTED_MESSAGE = "SharePoint is not connected.";
export const SHAREPOINT_FOLDER = "Test Agentic Harness";

export class SharePointNotConnected extends Error {
  constructor(message = NOT_CONNECTED_MESSAGE) {
    super(message);
    this.name = "SharePointNotConnected";
  }
}

const key = Symbol.for("owc-sharepoint-test-double");
if (!globalThis[key]) {
  globalThis[key] = {
    config: { ok: true },
    connection: undefined,
    entries: [],
    entriesError: null,
    entriesCalls: 0,
    signIns: 0,
    authorizeUrl: "https://login.example/authorize?client=test",
    settle: null,
  };
}
const state = globalThis[key];

export function reset() {
  state.config = { ok: true };
  state.connection = undefined;
  state.entries = [];
  state.entriesError = null;
  state.entriesCalls = 0;
  state.signIns = 0;
  state.authorizeUrl = "https://login.example/authorize?client=test";
  state.settle = null;
}

export function setConfig(config) {
  state.config = config;
}

export function setConnection(connection) {
  state.connection = connection;
}

export function setEntries(entries) {
  state.entries = entries;
}

export function setEntriesError(error) {
  state.entriesError = error;
}

export function signInCount() {
  return state.signIns;
}

export function entriesCalls() {
  return state.entriesCalls;
}

export function readConnection() {
  return state.connection;
}

export function rejectSignIn(error) {
  if (!state.settle) throw new Error("no sign-in is running");
  state.settle.reject(error);
}

export function sharePointConfig() {
  return state.config;
}

export function connectionStore() {
  return {
    path: "memory",
    read() {
      if (!state.connection) return undefined;
      return { ...state.connection, account: { ...state.connection.account } };
    },
    write(connection) {
      state.connection = connection;
    },
    clear() {
      state.connection = undefined;
    },
  };
}

export function createSharePoint() {
  return {
    async entries() {
      state.entriesCalls += 1;
      if (state.entriesError) throw state.entriesError;
      return state.entries.map((entry) => ({ ...entry }));
    },
  };
}

export function startSignIn({ signal }) {
  state.signIns += 1;
  let settle;
  const done = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  state.settle = settle;
  const abort = () => settle.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  return { authorizeUrl: state.authorizeUrl, done };
}
`);

process.env.OWC_PI_OWC_DIR = dir;
const fake = await import(pathToFileURL(path.join(dir, "lib", "sharepoint.js")).href);
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  tsconfigPaths: true,
});
const {
  cancelSharePoint,
  connectSharePoint,
  disconnectSharePoint,
  sharePointCard,
} = await jiti.import("./owc-sharepoint.ts");
const route = await jiti.import("../app/api/sharepoint/route.ts");

const ACCESS = "secret-access-token-9f3a";
const REFRESH = "secret-refresh-token-9f3a";
const ACCOUNT = { name: "Ada Lovelace", email: "ada@example.com" };
const AUTHORIZE = "https://login.example/authorize?client=test";

function savedConnection() {
  return {
    accessToken: ACCESS,
    refreshToken: REFRESH,
    expiresAt: 1,
    connectedAt: 1,
    account: { ...ACCOUNT },
  };
}

function assertNoSecrets(body) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  assert.equal(raw.includes(ACCESS), false);
  assert.equal(raw.includes(REFRESH), false);
  assert.equal(raw.includes("accessToken"), false);
  assert.equal(raw.includes("refreshToken"), false);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

after(async () => {
  await disconnectSharePoint().catch(() => {});
  if (previousDir === undefined) delete process.env.OWC_PI_OWC_DIR;
  else process.env.OWC_PI_OWC_DIR = previousDir;
  await rm(dir, { recursive: true, force: true });
});

describe("SharePoint card", { concurrency: 1 }, () => {
  beforeEach(async () => {
    process.env.OWC_PI_OWC_DIR = dir;
    fake.reset();
    await disconnectSharePoint();
  });

  test("the card is unavailable when pi-owc cannot be loaded", async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), "owc-sharepoint-missing-"));
    process.env.OWC_PI_OWC_DIR = empty;
    try {
      const card = await sharePointCard();
      assert.equal(card.state, "unavailable");
      assert.equal(typeof card.reason, "string");
      assert.ok(card.reason.length > 0);
      assertNoSecrets(card);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  test("the card is unavailable when sharePointConfig is not ok", async () => {
    const reason = "OWC_SHAREPOINT_CLIENT_ID is missing in .env or is not the app's client ID";
    fake.setConfig({ ok: false, reason });
    const card = await sharePointCard();
    assert.deepEqual(card, { state: "unavailable", reason });
    assertNoSecrets(card);
  });

  test("the card is disconnected when the store is empty", async () => {
    const card = await sharePointCard();
    assert.deepEqual(card, { state: "disconnected" });
    assert.equal(fake.entriesCalls(), 0);
    assertNoSecrets(card);
  });

  test("the card is connected with the account and folder entries", async () => {
    fake.setConnection(savedConnection());
    fake.setEntries([
      { name: "Briefing", kind: "folder", size: 0, folder: true, accessToken: ACCESS },
      { name: "fees.xlsx", kind: "spreadsheet", size: 2048, folder: false, refreshToken: REFRESH },
    ]);
    const card = await sharePointCard();
    assert.deepEqual(card, {
      state: "connected",
      account: ACCOUNT,
      renews: true,
      folder: {
        name: "Test Agentic Harness",
        entries: [
          { name: "Briefing", kind: "folder", size: 0, folder: true },
          { name: "fees.xlsx", kind: "spreadsheet", size: 2048, folder: false },
        ],
      },
    });
    assertNoSecrets(card);
  });

  test("the card is expired when listing throws SharePointNotConnected and the store still has an account", async () => {
    fake.setConnection(savedConnection());
    fake.setEntriesError(new fake.SharePointNotConnected());
    const card = await sharePointCard();
    assert.deepEqual(card, { state: "expired", account: ACCOUNT });
    assert.deepEqual(fake.readConnection().account, ACCOUNT);
    assertNoSecrets(card);
  });

  test("connect returns signing-in and a second connect joins that flow", async () => {
    const first = await connectSharePoint();
    const second = await connectSharePoint();
    assert.equal(first.state, "signing-in");
    assert.equal(first.authorizeUrl, AUTHORIZE);
    assert.equal(typeof first.startedAt, "number");
    assert.deepEqual(second, first);
    assert.equal(fake.signInCount(), 1);
    assertNoSecrets(first);
    assertNoSecrets(second);
  });

  test("cancel returns disconnected, including after the aborted sign-in rejects", async () => {
    await connectSharePoint();
    const card = await cancelSharePoint();
    assert.equal(card.state, "disconnected");
    await delay(30);
    assert.equal((await sharePointCard()).state, "disconnected");
    assertNoSecrets(card);
  });

  test("a rejected sign-in is remembered as failed until disconnect", async () => {
    fake.setConnection(savedConnection());
    await connectSharePoint();
    fake.rejectSignIn(new Error(`Sign-in did not finish ${ACCESS}`));
    await delay(30);
    const failed = await sharePointCard();
    assert.equal(failed.state, "failed");
    assert.equal(failed.message, "Sign-in did not finish [redacted]");
    assert.deepEqual(await sharePointCard(), failed);
    const cleared = await disconnectSharePoint();
    assert.equal(cleared.state, "disconnected");
    assert.equal(fake.readConnection(), undefined);
    assert.equal((await sharePointCard()).state, "disconnected");
    assertNoSecrets(failed);
    assertNoSecrets(cleared);
  });

  test("HTTP responses for the card never contain the tokens", async () => {
    fake.setConnection(savedConnection());
    fake.setEntries([
      { name: "fees.xlsx", kind: "spreadsheet", size: 12, folder: false, accessToken: ACCESS, refreshToken: REFRESH },
    ]);
    const headers = { host: "localhost" };

    const listed = await route.GET(new Request("http://localhost/api/sharepoint", { headers }));
    const listedText = await listed.text();
    assert.equal(listed.status, 200);
    assert.equal(JSON.parse(listedText).state, "connected");
    assertNoSecrets(listedText);

    const started = await route.POST(new Request("http://localhost/api/sharepoint", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ action: "connect" }),
    }));
    const startedText = await started.text();
    assert.equal(started.status, 200);
    assert.equal(JSON.parse(startedText).state, "signing-in");
    assert.equal(JSON.parse(startedText).authorizeUrl, AUTHORIZE);
    assert.equal(fake.signInCount(), 1);
    assertNoSecrets(startedText);

    const joined = await route.POST(new Request("http://localhost/api/sharepoint", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ action: "connect" }),
    }));
    const joinedText = await joined.text();
    assert.equal(JSON.parse(joinedText).startedAt, JSON.parse(startedText).startedAt);
    assert.equal(fake.signInCount(), 1);
    assertNoSecrets(joinedText);

    const removed = await route.DELETE(new Request("http://localhost/api/sharepoint", {
      method: "DELETE",
      headers,
    }));
    const removedText = await removed.text();
    assert.equal(removed.status, 200);
    assert.equal(JSON.parse(removedText).state, "disconnected");
    assert.equal(fake.readConnection(), undefined);
    assertNoSecrets(removedText);
  });
});
