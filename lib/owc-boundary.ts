import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { piOwcCandidates } from "./owc-display";

/**
 * The pi-owc hooks that keep raw client text away from the model. A session
 * without all three sends prompts and tool results in clear.
 */
export const OWC_BOUNDARY_EVENTS = ["input", "tool_call", "tool_result"] as const;

export const NOT_OWC_PROJECT_MESSAGE =
  "This folder is not an OWC project: the OWC privacy extension is not loaded, so the session was closed.";
export const CHAT_ONLY_REFUSED_MESSAGE =
  "Chat only is not available: it loads no extensions, so the OWC privacy extension would not run.";

export class NotOwcProjectError extends Error {
  constructor(message = NOT_OWC_PROJECT_MESSAGE) {
    super(message);
    this.name = "NotOwcProjectError";
  }
}

/** The pi-owc package folder: an explicit OWC_PI_OWC_DIR is the only candidate. */
export function piOwcExtensionDir(): string | undefined {
  const override = process.env.OWC_PI_OWC_DIR;
  const candidates = typeof override === "string" && override.length > 0 ? [override] : piOwcCandidates();
  return candidates.find((dir) => existsSync(path.join(dir, "package.json")));
}

/** The OWC root is the folder that holds pi-owc, the same one .pi/settings.json names as "../pi-owc". */
export function owcRoot(): string | undefined {
  const dir = piOwcExtensionDir();
  return dir ? path.dirname(path.resolve(dir)) : undefined;
}

function realPath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

export function isInsideDir(target: string, dir: string): boolean {
  const relative = path.relative(realPath(dir), realPath(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function isInsideOwcRoot(target: string, root = owcRoot()): boolean {
  return typeof root === "string" && isInsideDir(target, root);
}

export interface LoadedExtensionLike {
  path: string;
  resolvedPath: string;
  handlers: ReadonlyMap<string, readonly unknown[]>;
}

export interface SessionExtensionsLike {
  resourceLoader: { getExtensions(): { extensions: readonly LoadedExtensionLike[] } };
  extensionRunner: { getExtensionPaths(): string[] };
}

/**
 * True when the session's extension runner holds a pi-owc extension with every
 * boundary handler registered. The runner is what pi calls on each event, so
 * this reads the live session rather than guessing from the folder.
 */
export function hasOwcBoundary(session: SessionExtensionsLike, piOwcDir = piOwcExtensionDir()): boolean {
  if (!piOwcDir) return false;
  const runnerPaths = new Set(session.extensionRunner.getExtensionPaths());
  return session.resourceLoader.getExtensions().extensions.some((extension) =>
    runnerPaths.has(extension.path)
    && isInsideDir(extension.resolvedPath, piOwcDir)
    && OWC_BOUNDARY_EVENTS.every((event) => (extension.handlers.get(event)?.length ?? 0) > 0));
}
