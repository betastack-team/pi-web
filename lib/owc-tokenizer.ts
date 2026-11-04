import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { isTokenizer, type Tokenizer, type TokenizerCard } from "./api-types";
import { importFile, piOwcCandidates } from "./owc-display";

type ReadyCard = Extract<TokenizerCard, { state: "ready" }>;

interface TokenizerModules {
  root: string;
  docanonymUrl: string | null;
  readTokenizer: unknown;
  writeTokenizer: unknown;
  usesDocAnonym: unknown;
  sendsInClear: unknown;
}

type Opened =
  | { ok: false; card: TokenizerCard }
  | { ok: true; modules: TokenizerModules };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

function isPromise(value: unknown): value is Promise<unknown> {
  return isRecord(value) && isCallable(value.then);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function callFn(value: unknown, name: string, args: readonly unknown[]): unknown {
  if (!isCallable(value)) throw new Error(`pi-owc ${name} is missing`);
  return value(...args);
}

async function settle(value: unknown): Promise<unknown> {
  return isPromise(value) ? await value : value;
}

// An explicit OWC_PI_OWC_DIR is the only candidate, so a test double cannot
// fall through to the real pi-owc beside this repo.
function importPiOwc(filePath: string): Promise<Record<string, unknown>> {
  return importFile(filePath, String(Math.round(statSync(filePath).mtimeMs)));
}

function tokenizerDir(): string | undefined {
  const override = process.env.OWC_PI_OWC_DIR;
  if (typeof override === "string" && override.length > 0) return override;
  return piOwcCandidates().find((dir) => existsSync(path.join(dir, "lib", "settings.js")));
}

function unavailable(reason: string): Opened {
  return { ok: false, card: { state: "unavailable", reason } };
}

function docanonymUrlFrom(env: unknown): string | null {
  if (!isRecord(env)) return null;
  const raw = env.OWC_DOCANONYM_URL;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loadTokenizer(): Promise<Opened> {
  try {
    const dir = tokenizerDir();
    if (!dir || !existsSync(path.join(dir, "lib", "settings.js"))) {
      return unavailable("pi-owc settings module was not found");
    }
    const [project, rootEnv, settings, client] = await Promise.all([
      importPiOwc(path.join(dir, "lib", "project.js")),
      importPiOwc(path.join(dir, "lib", "root-env.js")),
      importPiOwc(path.join(dir, "lib", "settings.js")),
      importPiOwc(path.join(dir, "lib", "docanonym", "client.js")),
    ]);
    const root = callFn(project.findRoot, "findRoot", [dir]);
    if (typeof root !== "string" || root.length === 0) {
      return unavailable("pi-owc findRoot returned an empty root");
    }
    const env = await settle(callFn(rootEnv.loadRootEnv, "loadRootEnv", [root, process.env]));
    return {
      ok: true,
      modules: {
        root,
        docanonymUrl: docanonymUrlFrom(env),
        readTokenizer: settings.readTokenizer,
        writeTokenizer: settings.writeTokenizer,
        usesDocAnonym: settings.usesDocAnonym,
        sendsInClear: client.sendsInClear,
      },
    };
  } catch (error) {
    return unavailable(errorMessage(error));
  }
}

async function present(modules: TokenizerModules): Promise<ReadyCard> {
  const value = await settle(callFn(modules.readTokenizer, "readTokenizer", [modules.root]));
  if (!isTokenizer(value)) {
    throw new Error("pi-owc readTokenizer returned an unexpected value");
  }
  let plainHttp = false;
  if (modules.docanonymUrl !== null) {
    const clear = await settle(callFn(modules.sendsInClear, "sendsInClear", [modules.docanonymUrl]));
    if (typeof clear !== "boolean") throw new Error("pi-owc sendsInClear did not return a boolean");
    plainHttp = clear;
  }
  return {
    state: "ready",
    tokenizer: value,
    docanonymUrl: modules.docanonymUrl,
    plainHttp,
  };
}

export async function tokenizerCard(): Promise<TokenizerCard> {
  const opened = await loadTokenizer();
  if (!opened.ok) return opened.card;
  try {
    return await present(opened.modules);
  } catch (error) {
    return { state: "unavailable", reason: errorMessage(error) };
  }
}

export async function usesDocAnonym(choice: Tokenizer): Promise<boolean> {
  const opened = await loadTokenizer();
  if (!opened.ok) {
    const reason = opened.card.state === "unavailable" ? opened.card.reason : "pi-owc settings module was not found";
    throw new Error(reason);
  }
  const result = await settle(callFn(opened.modules.usesDocAnonym, "usesDocAnonym", [choice]));
  if (typeof result !== "boolean") throw new Error("pi-owc usesDocAnonym did not return a boolean");
  return result;
}

export async function setTokenizer(choice: Tokenizer): Promise<TokenizerCard> {
  const opened = await loadTokenizer();
  if (!opened.ok) return opened.card;
  try {
    const current = await present(opened.modules);
    if (await usesDocAnonym(choice) && current.docanonymUrl === null) return current;
    await settle(callFn(opened.modules.writeTokenizer, "writeTokenizer", [opened.modules.root, choice]));
    return await present(opened.modules);
  } catch (error) {
    return { state: "unavailable", reason: errorMessage(error) };
  }
}
