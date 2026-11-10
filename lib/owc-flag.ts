import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { importFile, piOwcCandidates } from "./owc-display";

import { FLAG_CLASSES, FLAG_MAX_CHARS, type FlagClass } from "./owc-flag-client";

export { FLAG_CLASSES, FLAG_MAX_CHARS, type FlagClass };

export type FlagOutcome =
  | { ok: true; token: string; sweepable: boolean }
  | { ok: false; reason: "empty" | "bad-class" | "too-long" | "no-project" | "unavailable" };

export interface FlagRequest {
  cls: FlagClass;
  raw: string;
  docRef?: string;
  cwd?: string;
}

interface FlagModules {
  root: string;
  flagValue: (root: string, request: { cls: string; raw: string; docRef?: string }) => unknown;
  requestUnflag: (root: string, request: { token: string; docRef?: string }) => unknown;
}

type FlagLoad =
  | { ok: true; modules: FlagModules }
  | { ok: false; reason: "no-project" | "unavailable" };

type UnflagOutcome =
  | { ok: true }
  | { ok: false; reason: "no-project" | "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function hasProjectDirectory(cwd: string | undefined): cwd is string {
  return typeof cwd === "string" && path.isAbsolute(cwd) && isDirectory(cwd);
}

async function loadFlag(cwd: string | undefined): Promise<FlagLoad> {
  // The pi-owc install directory is not a project vault. Starting there would hide nothing this session reads.
  if (!hasProjectDirectory(cwd)) return { ok: false, reason: "no-project" };
  const override = process.env.OWC_PI_OWC_DIR;
  const candidates = override ? [override] : piOwcCandidates();
  const dir = candidates.find((candidate) => existsSync(path.join(candidate, "lib", "flag.js")));
  if (!dir) return { ok: false, reason: "unavailable" };
  const [flag, project] = await Promise.all([
    importFile(path.join(dir, "lib", "flag.js")),
    importFile(path.join(dir, "lib", "project.js")),
  ]);
  if (typeof flag.flagValue !== "function" || typeof flag.requestUnflag !== "function" || typeof project.findRoot !== "function") {
    return { ok: false, reason: "unavailable" };
  }
  const root = project.findRoot(cwd);
  if (typeof root !== "string" || root.length === 0) return { ok: false, reason: "unavailable" };
  return {
    ok: true,
    modules: {
      root,
      flagValue: flag.flagValue as FlagModules["flagValue"],
      requestUnflag: flag.requestUnflag as FlagModules["requestUnflag"],
    },
  };
}

function toOutcome(value: unknown): FlagOutcome {
  if (!isRecord(value)) return { ok: false, reason: "unavailable" };
  if (value.ok === true && typeof value.token === "string" && typeof value.sweepable === "boolean") {
    return { ok: true, token: value.token, sweepable: value.sweepable };
  }
  const reason = value.reason;
  return reason === "empty" || reason === "bad-class" || reason === "too-long" ? { ok: false, reason } : { ok: false, reason: "unavailable" };
}

/** Hides one value everywhere from now on. The value never leaves this process except into the local vault. */
export async function flagValue(request: FlagRequest): Promise<FlagOutcome> {
  try {
    const loaded = await loadFlag(request.cwd);
    if (!loaded.ok) return loaded;
    const { cls, raw, docRef } = request;
    return toOutcome(await loaded.modules.flagValue(loaded.modules.root, { cls, raw, docRef }));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Records that a person wants a token shown again. Never retires it. */
export async function requestUnflag(request: { token: string; docRef?: string; cwd?: string }): Promise<UnflagOutcome> {
  try {
    const loaded = await loadFlag(request.cwd);
    if (!loaded.ok) return loaded;
    await loaded.modules.requestUnflag(loaded.modules.root, { token: request.token, docRef: request.docRef });
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export { isFlagClass } from "./owc-flag-client";
