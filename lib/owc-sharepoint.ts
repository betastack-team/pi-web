import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { SharePointAccount, SharePointCard, SharePointEntry } from "./api-types";
import { importFile, piOwcCandidates } from "./owc-display";

// One sign-in per process. Symbol.for keeps a second copy of this module
// (the dev server and a test loader) on the same flow. A second connect joins it.
const SIGN_IN = Symbol.for("betastack:sharepoint-sign-in");

interface SignInFlow {
  authorizeUrl: string;
  startedAt: number;
  cancelled: boolean;
  abort: () => void;
}

interface SignInRegistry {
  flow?: SignInFlow;
  failed?: string;
  starting?: Promise<SharePointCard>;
  abortStarting?: () => void;
}

interface SharePointApi {
  folderName: string;
  env: Record<string, string | undefined>;
  store: unknown;
  createSharePoint: (...args: unknown[]) => unknown;
  startSignIn: (...args: unknown[]) => unknown;
  notConnected: unknown;
}

type Opened =
  | { ok: false; card: SharePointCard }
  | { ok: true; api: SharePointApi };

const FOLDER_FALLBACK = "Test Agentic Harness";

function registry(): SignInRegistry {
  const host = globalThis as unknown as Record<symbol, SignInRegistry | undefined>;
  return host[SIGN_IN] ??= {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asFunction(value: unknown, name: string): (...args: unknown[]) => unknown {
  if (typeof value !== "function") throw new Error(`pi-owc ${name} is missing`);
  return (...args: unknown[]) => (value as (...args: unknown[]) => unknown)(...args);
}

function isPromise(value: unknown): value is Promise<unknown> {
  return isRecord(value) && typeof value.then === "function";
}

function serverFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

// An explicit OWC_PI_OWC_DIR is the only candidate, so a test double cannot
// fall through to the real pi-owc beside this repo.
function importPiOwc(filePath: string): Promise<Record<string, unknown>> {
  return importFile(filePath, String(Math.round(statSync(filePath).mtimeMs)));
}

function sharePointDir(): string | undefined {
  const override = process.env.OWC_PI_OWC_DIR;
  if (typeof override === "string" && override.length > 0) return override;
  return piOwcCandidates().find((dir) => existsSync(path.join(dir, "lib", "sharepoint.js")));
}

function unavailable(reason: string): Opened {
  return { ok: false, card: { state: "unavailable", reason } };
}

function stringEnv(value: unknown): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  if (!isRecord(value)) return env;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string") env[key] = child;
  }
  return env;
}

function configResult(value: unknown): { ok: true } | { ok: false; reason: string } {
  if (isRecord(value) && value.ok === true) return { ok: true };
  if (isRecord(value) && value.ok === false) {
    const reason = typeof value.reason === "string" && value.reason.trim().length > 0
      ? value.reason.trim()
      : "SharePoint is not configured";
    return { ok: false, reason };
  }
  return { ok: false, reason: "SharePoint configuration could not be read" };
}

function secretsOf(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const secrets: string[] = [];
  if (typeof value.accessToken === "string" && value.accessToken.length >= 8) secrets.push(value.accessToken);
  if (typeof value.refreshToken === "string" && value.refreshToken.length >= 8) secrets.push(value.refreshToken);
  return secrets;
}

function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

function accountOf(value: unknown): SharePointAccount | undefined {
  if (!isRecord(value) || !isRecord(value.account)) return undefined;
  const { name, email } = value.account;
  if (typeof name !== "string" || typeof email !== "string") return undefined;
  if (name.length === 0 || email.length === 0) return undefined;
  return { name, email };
}

function canRenew(value: unknown): boolean {
  return isRecord(value) && typeof value.refreshToken === "string" && value.refreshToken.length > 0;
}

function readStore(store: unknown): unknown {
  if (!isRecord(store) || typeof store.read !== "function") {
    throw new Error("pi-owc connection store cannot be read");
  }
  return (store.read as () => unknown)();
}

function clearStore(store: unknown): void {
  if (!isRecord(store) || typeof store.clear !== "function") {
    throw new Error("pi-owc connection store cannot be cleared");
  }
  (store.clear as () => void)();
}

function isNotConnected(error: unknown, ctor: unknown): boolean {
  if (typeof ctor === "function" && error instanceof ctor) return true;
  return error instanceof Error && error.name === "SharePointNotConnected";
}

function parseEntries(value: unknown): { entries: SharePointEntry[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "SharePoint listing was not a list" };
  const entries: SharePointEntry[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== "string" || item.name.length === 0) {
      return { error: "SharePoint listing had an unreadable entry" };
    }
    const folder = item.folder === true;
    const size = typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0 ? item.size : 0;
    entries.push({
      name: item.name,
      kind: typeof item.kind === "string" && item.kind.length > 0 ? item.kind : folder ? "folder" : "",
      size,
      folder,
    });
  }
  return { entries };
}

async function loadSharePoint(): Promise<Opened> {
  try {
    const dir = sharePointDir();
    if (!dir || !existsSync(path.join(dir, "lib", "sharepoint.js"))) {
      return unavailable("pi-owc SharePoint module was not found");
    }
    const [sharepoint, rootEnv, project] = await Promise.all([
      importPiOwc(path.join(dir, "lib", "sharepoint.js")),
      importPiOwc(path.join(dir, "lib", "root-env.js")),
      importPiOwc(path.join(dir, "lib", "project.js")),
    ]);
    const findRoot = asFunction(project.findRoot, "findRoot");
    const loadRootEnv = asFunction(rootEnv.loadRootEnv, "loadRootEnv");
    const sharePointConfig = asFunction(sharepoint.sharePointConfig, "sharePointConfig");
    const connectionStore = asFunction(sharepoint.connectionStore, "connectionStore");
    const root = findRoot(dir);
    if (typeof root !== "string" || root.length === 0) {
      return unavailable("pi-owc findRoot returned an empty root");
    }
    const env = stringEnv(loadRootEnv(root, process.env));
    const config = configResult(sharePointConfig(env));
    if (!config.ok) return unavailable(config.reason);
    // No home from the root .env: the agent's tool resolves the store from the process environment only.
    const store = connectionStore({ root });
    if (!isRecord(store) || typeof store.read !== "function" || typeof store.clear !== "function") {
      return unavailable("pi-owc connectionStore returned an unusable store");
    }
    const folderName = typeof sharepoint.SHAREPOINT_FOLDER === "string" && sharepoint.SHAREPOINT_FOLDER.length > 0
      ? sharepoint.SHAREPOINT_FOLDER
      : FOLDER_FALLBACK;
    return {
      ok: true,
      api: {
        folderName,
        env,
        store,
        createSharePoint: asFunction(sharepoint.createSharePoint, "createSharePoint"),
        startSignIn: asFunction(sharepoint.startSignIn, "startSignIn"),
        notConnected: sharepoint.SharePointNotConnected,
      },
    };
  } catch (error) {
    return unavailable(errorMessage(error));
  }
}

function signingCard(flow: SignInFlow): SharePointCard {
  return { state: "signing-in", authorizeUrl: flow.authorizeUrl, startedAt: flow.startedAt };
}

async function listEntries(api: SharePointApi): Promise<{ entries: SharePointEntry[] } | { error: string }> {
  const client = api.createSharePoint({
    fetch: serverFetch,
    env: api.env,
    store: api.store,
    now: () => Date.now(),
  });
  if (!isRecord(client) || typeof client.entries !== "function") {
    return { error: "SharePoint client is unavailable" };
  }
  const listed: unknown = await (client.entries as () => unknown)();
  return parseEntries(listed);
}

async function readConnection(api: SharePointApi): Promise<SharePointCard> {
  const saved = readStore(api.store);
  const account = accountOf(saved);
  if (!account) return { state: "disconnected" };
  const secrets = secretsOf(saved);
  try {
    const listed = await listEntries(api);
    if ("error" in listed) {
      return {
        state: "connected",
        account,
        renews: canRenew(saved),
        folder: { name: api.folderName, error: redact(listed.error, secrets) },
      };
    }
    const after = readStore(api.store);
    return {
      state: "connected",
      account: accountOf(after) ?? account,
      renews: canRenew(after),
      folder: { name: api.folderName, entries: listed.entries },
    };
  } catch (error) {
    const still = readStore(api.store);
    const stillAccount = accountOf(still);
    if (isNotConnected(error, api.notConnected) && stillAccount) {
      return { state: "expired", account: stillAccount };
    }
    if (!stillAccount) return { state: "disconnected" };
    return {
      state: "connected",
      account: stillAccount,
      renews: canRenew(still),
      folder: { name: api.folderName, error: redact(errorMessage(error), secretsOf(still)) },
    };
  }
}

function dropFlow(flow: SignInFlow): void {
  const reg = registry();
  // Mark cancelled before abort. startSignIn rejects on abort, and that
  // rejection must not become the remembered "failed" card.
  flow.cancelled = true;
  flow.abort();
  if (reg.flow === flow) reg.flow = undefined;
}

export async function sharePointCard(): Promise<SharePointCard> {
  const reg = registry();
  if (reg.flow && !reg.flow.cancelled) return signingCard(reg.flow);
  if (reg.failed) return { state: "failed", message: reg.failed };
  const opened = await loadSharePoint();
  if (!opened.ok) return opened.card;
  return readConnection(opened.api);
}

async function beginSignIn(controller: AbortController): Promise<SharePointCard> {
  const reg = registry();
  reg.failed = undefined;
  const opened = await loadSharePoint();
  if (!opened.ok) return opened.card;
  if (controller.signal.aborted) return readConnection(opened.api);

  let started: unknown;
  try {
    started = await opened.api.startSignIn({
      fetch: serverFetch,
      env: opened.api.env,
      store: opened.api.store,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) return readConnection(opened.api);
    const message = redact(errorMessage(error), secretsOf(readStore(opened.api.store)));
    reg.failed = message;
    return { state: "failed", message };
  }

  const record = isRecord(started) ? started : undefined;
  const authorizeUrl = record && typeof record.authorizeUrl === "string" ? record.authorizeUrl : "";
  const done = record?.done;
  if (authorizeUrl.length === 0 || !isPromise(done)) {
    const message = "SharePoint sign-in did not start";
    reg.failed = message;
    return { state: "failed", message };
  }

  const safeUrl = redact(authorizeUrl, secretsOf(readStore(opened.api.store)));
  const flow: SignInFlow = {
    authorizeUrl: safeUrl,
    startedAt: Date.now(),
    cancelled: controller.signal.aborted,
    abort: () => controller.abort(),
  };
  void done.then(
    () => {
      if (reg.flow === flow) reg.flow = undefined;
    },
    (error: unknown) => {
      if (reg.flow === flow) reg.flow = undefined;
      if (flow.cancelled) return;
      try {
        const message = redact(errorMessage(error), secretsOf(readStore(opened.api.store)));
        reg.failed = message;
      } catch {
        reg.failed = "SharePoint sign-in did not finish";
      }
    },
  );
  if (flow.cancelled) return readConnection(opened.api);
  reg.flow = flow;
  return signingCard(flow);
}

export function connectSharePoint(): Promise<SharePointCard> {
  const reg = registry();
  if (reg.flow && !reg.flow.cancelled) return Promise.resolve(signingCard(reg.flow));
  if (reg.starting) return reg.starting;
  const controller = new AbortController();
  reg.abortStarting = () => controller.abort();
  const run = beginSignIn(controller).finally(() => {
    if (reg.starting === run) {
      reg.starting = undefined;
      reg.abortStarting = undefined;
    }
  });
  reg.starting = run;
  return run;
}

export async function cancelSharePoint(): Promise<SharePointCard> {
  const reg = registry();
  reg.failed = undefined;
  const flow = reg.flow;
  if (flow) dropFlow(flow);
  reg.abortStarting?.();
  return sharePointCard();
}

export async function disconnectSharePoint(): Promise<SharePointCard> {
  const reg = registry();
  reg.failed = undefined;
  const flow = reg.flow;
  if (flow) dropFlow(flow);
  reg.abortStarting?.();
  const opened = await loadSharePoint();
  if (!opened.ok) return opened.card;
  try {
    clearStore(opened.api.store);
  } catch (error) {
    return { state: "unavailable", reason: redact(errorMessage(error), secretsOf(readStore(opened.api.store))) };
  }
  return readConnection(opened.api);
}
