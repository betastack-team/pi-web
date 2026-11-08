import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { importFile, piOwcCandidates } from "./owc-display";

/** Mirrors pi-owc PII_CLASSES; flagValue still validates it, this only shapes the menu. */
export const FLAG_CLASSES = ["NAME", "SSN", "DOB", "DATE", "MRN", "PLAN", "ACCT", "DL", "EMAIL", "PHONE", "ADDR"] as const;
export type FlagClass = (typeof FLAG_CLASSES)[number];
export const FLAG_MAX_CHARS = 200;

export type FlagOutcome =
  | { ok: true; token: string; sweepable: boolean }
  | { ok: false; reason: "empty" | "bad-class" | "too-long" | "unavailable" };

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFlagClass(value: unknown): value is FlagClass {
  return typeof value === "string" && (FLAG_CLASSES as readonly string[]).includes(value);
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

async function loadFlag(cwd: string | undefined): Promise<FlagModules | null> {
  const override = process.env.OWC_PI_OWC_DIR;
  const candidates = override ? [override] : piOwcCandidates();
  const dir = candidates.find((candidate) => existsSync(path.join(candidate, "lib", "flag.js")));
  if (!dir) return null;
  const [flag, project] = await Promise.all([
    importFile(path.join(dir, "lib", "flag.js")),
    importFile(path.join(dir, "lib", "project.js")),
  ]);
  if (typeof flag.flagValue !== "function" || typeof flag.requestUnflag !== "function" || typeof project.findRoot !== "function") {
    return null;
  }
  const start = cwd && path.isAbsolute(cwd) && isDirectory(cwd) ? cwd : dir;
  const root = project.findRoot(start);
  if (typeof root !== "string" || root.length === 0) return null;
  return {
    root,
    flagValue: flag.flagValue as FlagModules["flagValue"],
    requestUnflag: flag.requestUnflag as FlagModules["requestUnflag"],
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
    const modules = await loadFlag(request.cwd);
    if (!modules) return { ok: false, reason: "unavailable" };
    const { cwd: _cwd, ...rest } = request;
    return toOutcome(await modules.flagValue(modules.root, rest));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Records that a person wants a token shown again. Never retires it. */
export async function requestUnflag(request: { token: string; docRef?: string; cwd?: string }): Promise<boolean> {
  try {
    const modules = await loadFlag(request.cwd);
    if (!modules) return false;
    await modules.requestUnflag(modules.root, { token: request.token, docRef: request.docRef });
    return true;
  } catch {
    return false;
  }
}
