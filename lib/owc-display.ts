import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentEventLike } from "./agent-event-wire";

/** Resolve-only view of a pi-owc vault. Display never calls tokenFor. */
export interface OwcResolveVault {
  resolve(token: string): string | undefined;
}

export interface TextPair {
  text: string;
  rawText?: string;
}

export interface OwcDisplay {
  presentMessage<T>(message: T): T;
  presentContext<T extends { messages: unknown[] }>(ctx: T): T;
  presentText(text: string): string;
  presentTextPair(text: string): TextPair;
  isIdentity: boolean;
}

const HELD_LIMIT = 16;
const OPEN_TOKEN = "⟦";
const CLOSE_TOKEN = "⟧";
const PARTIAL_TOKEN = /^⟦(?:[A-Z]{0,6}|[A-Z]{2,6}:(?:[0-9A-HJKMNP-TV-Z]{0,8})?)$/;
const TOKEN_SOURCE = "⟦([A-Z]{2,6}):([0-9A-HJKMNP-TV-Z]{8})⟧";
const TOKEN_FLAGS = "gu";
const VAULT_ID_RE = /^[0-9a-f]{32}$/i;

const PATH_KEYS = new Set([
  "path",
  "file_path",
  "filePath",
  "filename",
  "dir",
  "cwd",
  "destination",
  "old_path",
  "new_path",
]);

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const piWebDir = path.resolve(moduleDir, "..");
const projectRoot = piWebDir;

interface Engine {
  text(value: string): string;
  input(value: unknown): unknown;
}

interface PiOwcApi {
  detokenizeText(text: string, vault: OwcResolveVault): { text: string };
  detokenizeInput(input: unknown, vault: OwcResolveVault): { input: unknown };
  findRoot(start: string): string;
  openVault(root: string, opts?: { home?: string }): OwcResolveVault;
}

interface StreamBuffer {
  raw: string;
  emitted: string;
}

const warned = new Set<string>();
const displayByRoot = new Map<string, OwcDisplay>();
let loadPromise: Promise<PiOwcApi | null> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function callable(value: unknown, name: string): (...args: unknown[]) => unknown {
  if (typeof value !== "function") throw new Error(`pi-owc ${name} missing`);
  return (...args: unknown[]) => (value as (...args: unknown[]) => unknown)(...args);
}

function isResolveVault(value: unknown): value is OwcResolveVault {
  return isRecord(value) && typeof value.resolve === "function";
}

async function importFile(filePath: string): Promise<Record<string, unknown>> {
  const loaded: unknown = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(filePath).href);
  return isRecord(loaded) ? loaded : {};
}

function piOwcCandidates(): string[] {
  const candidates = [
    process.env.OWC_PI_OWC_DIR,
    path.join(projectRoot, "pi-owc"),
    path.resolve(piWebDir, "..", "pi-owc"),
  ];
  return candidates.filter((dir): dir is string => typeof dir === "string" && dir.length > 0);
}

function bindApi(
  detokenizer: Record<string, unknown>,
  vaultMod: Record<string, unknown>,
  project: Record<string, unknown>,
): PiOwcApi {
  const detokenizeTextFn = callable(detokenizer.detokenizeText, "detokenizeText");
  const detokenizeInputFn = callable(detokenizer.detokenizeInput, "detokenizeInput");
  const findRootFn = callable(project.findRoot, "findRoot");
  const openVaultFn = callable(vaultMod.openVault, "openVault");
  return {
    detokenizeText(text, vault) {
      const result = detokenizeTextFn(text, vault);
      if (!isRecord(result) || typeof result.text !== "string") return { text };
      return { text: result.text };
    },
    detokenizeInput(input, vault) {
      const result = detokenizeInputFn(input, vault);
      if (!isRecord(result) || !("input" in result)) return { input };
      return { input: result.input };
    },
    findRoot(start) {
      const root = findRootFn(start);
      if (typeof root !== "string" || root.length === 0) {
        throw new Error("pi-owc findRoot returned an empty root");
      }
      return root;
    },
    openVault(root, opts) {
      const opened = openVaultFn(root, opts);
      if (!isResolveVault(opened)) throw new Error("pi-owc openVault returned an unusable vault");
      return opened;
    },
  };
}

function loadPiOwc(): Promise<PiOwcApi | null> {
  if (loadPromise) return loadPromise;
  // A miss must not latch. pi-owc may appear later, and warnOnce already limits the log.
  const pending: Promise<PiOwcApi | null> = (async () => {
    try {
      const dir = piOwcCandidates().find((candidate) => existsSync(path.join(candidate, "lib", "detokenizer.js")));
      if (!dir) throw new Error("pi-owc not found");
      const [detokenizer, vaultMod, project] = await Promise.all([
        importFile(path.join(dir, "lib", "detokenizer.js")),
        importFile(path.join(dir, "lib", "vault.js")),
        importFile(path.join(dir, "lib", "project.js")),
      ]);
      return bindApi(detokenizer, vaultMod, project);
    } catch (error) {
      warnOnce("load", `[owc-display] pi-owc stayed unloaded (${errorMessage(error)})`);
      return null;
    }
  })();
  loadPromise = pending;
  void pending.then((api) => {
    if (api === null && loadPromise === pending) loadPromise = undefined;
  });
  return pending;
}

function vaultHome(): string {
  return process.env.OWC_VAULT_HOME ?? path.join(homedir(), ".owc-vault");
}

function copyJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => copyJson(item));
  if (!isRecord(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) copy[key] = copyJson(child);
  return copy;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => sameValue(item, right[index]));
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    return leftKeys.every((key) => sameValue(left[key], right[key]));
  }
  return false;
}

function detokenizeTextLocal(text: string, vault: OwcResolveVault): string {
  const pattern = new RegExp(TOKEN_SOURCE, TOKEN_FLAGS);
  return text.replace(pattern, (token) => vault.resolve(token) ?? token);
}

function detokenizeInputLocal(input: unknown, vault: OwcResolveVault): unknown {
  function walk(node: unknown, key: string | undefined): unknown {
    if (typeof node === "string") {
      if (key !== undefined && PATH_KEYS.has(key)) return node;
      return detokenizeTextLocal(node, vault);
    }
    if (Array.isArray(node)) return node.map((item) => walk(item, key));
    if (isRecord(node)) {
      const out: Record<string, unknown> = {};
      for (const [childKey, child] of Object.entries(node)) out[childKey] = walk(child, childKey);
      return out;
    }
    return node;
  }
  return walk(input, undefined);
}

function engineFromVault(vault: OwcResolveVault): Engine {
  return {
    text: (value) => detokenizeTextLocal(value, vault),
    input: (value) => detokenizeInputLocal(copyJson(value), vault),
  };
}

function engineFromApi(api: PiOwcApi, vault: OwcResolveVault): Engine {
  return {
    text: (value) => api.detokenizeText(value, vault).text,
    input: (value) => api.detokenizeInput(copyJson(value), vault).input,
  };
}

function createDisplay(engine: Engine, isIdentity: boolean): OwcDisplay {
  function presentTextPair(text: string): TextPair {
    const next = engine.text(text);
    if (next === text) return { text };
    return { text: next, rawText: text };
  }

  function presentBlock(block: unknown): unknown {
    if (!isRecord(block)) return block;
    if (block.type === "text" && typeof block.text === "string") {
      const pair = presentTextPair(block.text);
      if (pair.rawText === undefined) return block;
      return { ...block, text: pair.text, rawText: pair.rawText };
    }
    if (block.type === "thinking" && typeof block.thinking === "string") {
      const pair = presentTextPair(block.thinking);
      if (pair.rawText === undefined) return block;
      return { ...block, thinking: pair.text, rawThinking: pair.rawText };
    }
    if (block.type === "toolCall" && isRecord(block.input)) {
      const input = engine.input(block.input);
      if (sameValue(input, block.input)) return block;
      return { ...block, input, modelInput: copyJson(block.input) };
    }
    return block;
  }

  function presentBlocks(blocks: unknown[]): unknown[] {
    let next: unknown[] | undefined;
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const presented = presentBlock(block);
      if (presented === block) {
        if (next) next.push(block);
        continue;
      }
      next ??= blocks.slice(0, index);
      next.push(presented);
    }
    return next ?? blocks;
  }

  function presentStringContent<T extends Record<string, unknown>>(message: T): T {
    const { content } = message;
    if (typeof content === "string") {
      const pair = presentTextPair(content);
      if (pair.rawText === undefined) return message;
      return { ...message, content: pair.text, rawContent: pair.rawText };
    }
    return presentBlockContent(message);
  }

  function presentBlockContent<T extends Record<string, unknown>>(message: T): T {
    const { content } = message;
    if (!Array.isArray(content)) return message;
    const blocks = presentBlocks(content);
    if (blocks === content) return message;
    return { ...message, content: blocks };
  }

  function presentBash(message: Record<string, unknown>): Record<string, unknown> {
    let next: Record<string, unknown> | undefined;
    for (const field of ["output", "content"] as const) {
      const value = (next ?? message)[field];
      if (typeof value !== "string") continue;
      const text = engine.text(value);
      if (text === value) continue;
      next ??= { ...message };
      next[field] = text;
    }
    return next ?? message;
  }

  function presentMessage<T>(message: T): T {
    if (!isRecord(message)) return message;
    switch (message.role) {
      case "user":
      case "custom":
        return presentStringContent(message) as T;
      case "assistant":
      case "toolResult":
        return presentBlockContent(message) as T;
      case "bashExecution":
        return presentBash(message) as T;
      default:
        return message;
    }
  }

  function presentContext<T extends { messages: unknown[] }>(ctx: T): T {
    const { messages } = ctx;
    if (!Array.isArray(messages)) return ctx;
    let next: unknown[] | undefined;
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const presented = presentMessage(message);
      if (presented === message) {
        if (next) next.push(message);
        continue;
      }
      next ??= messages.slice(0, index);
      next.push(presented);
    }
    if (!next) return ctx;
    return { ...ctx, messages: next };
  }

  return {
    presentMessage,
    presentContext,
    presentText: (text) => presentTextPair(text).text,
    presentTextPair,
    isIdentity,
  };
}

const identityEngine: Engine = {
  text: (value) => value,
  input: (value) => value,
};

const identityDisplay = createDisplay(identityEngine, true);

/**
 * Synchronous seam for tests. It cannot await the runtime import of pi-owc,
 * so it uses the same token grammar. displayForCwd calls the loaded functions.
 */
export function displayFromVault(vault: OwcResolveVault | null, _root?: string): OwcDisplay {
  if (!vault) return identityDisplay;
  return createDisplay(engineFromVault(vault), false);
}

export function presentContentBlocks(display: OwcDisplay, content: unknown): unknown {
  const presented = display.presentMessage({ role: "toolResult", toolCallId: "", content });
  if (!isRecord(presented)) return content;
  return presented.content;
}

function readVaultId(root: string): string | undefined {
  const idPath = path.join(root, ".owc", "vault-id");
  if (!existsSync(idPath)) return undefined;
  const id = readFileSync(idPath, "utf8").trim();
  if (!VAULT_ID_RE.test(id)) return undefined;
  return id.toLowerCase();
}

function vaultFilesReady(root: string, id: string, home: string): boolean {
  const dir = path.join(home, id);
  return existsSync(path.join(dir, "key")) && existsSync(path.join(dir, "entries.jsonl"));
}

// openVault creates vault-id, key, and entries.jsonl when any of them is missing.
function openReadyVault(api: PiOwcApi, root: string): OwcResolveVault | undefined {
  const id = readVaultId(root);
  if (!id) return undefined;
  const home = vaultHome();
  if (!vaultFilesReady(root, id, home)) return undefined;
  return api.openVault(root, { home });
}

function displayForRoot(api: PiOwcApi, root: string): OwcDisplay {
  const cached = displayByRoot.get(root);
  if (cached) return cached;
  try {
    const vault = openReadyVault(api, root);
    if (!vault) {
      warnOnce(root, `[owc-display] no vault for ${root}`);
      return identityDisplay;
    }
    const display = createDisplay(engineFromApi(api, vault), false);
    displayByRoot.set(root, display);
    return display;
  } catch (error) {
    warnOnce(root, `[owc-display] vault stayed closed for ${root} (${errorMessage(error)})`);
    return identityDisplay;
  }
}

export async function displayForCwd(cwd: string | undefined): Promise<OwcDisplay> {
  if (!cwd) return identityDisplay;
  const api = await loadPiOwc();
  if (!api) return identityDisplay;

  const resolved = path.resolve(cwd);
  let root: string;
  try {
    root = api.findRoot(resolved);
  } catch (error) {
    const key = `missing-root\0${resolved}`;
    const cached = displayByRoot.get(key);
    if (cached) return cached;
    warnOnce(key, `[owc-display] no project root for ${resolved} (${errorMessage(error)})`);
    displayByRoot.set(key, identityDisplay);
    return identityDisplay;
  }
  return displayForRoot(api, root);
}

/** Code units at the end of `text` that form an unfinished token. A closed token is never held. */
export function heldSuffixLength(text: string): number {
  const start = Math.max(0, text.length - HELD_LIMIT);
  const mark = text.lastIndexOf(OPEN_TOKEN);
  if (mark < start) return 0;
  const suffix = text.slice(mark);
  if (suffix.endsWith(CLOSE_TOKEN)) return 0;
  if (!PARTIAL_TOKEN.test(suffix)) return 0;
  return suffix.length;
}

function committedText(display: OwcDisplay, raw: string): string {
  const held = heldSuffixLength(raw);
  const committed = held === 0 ? raw : raw.slice(0, -held);
  return display.presentText(committed);
}

function assistantUpdate(event: AgentEventLike): Record<string, unknown> | undefined {
  const update = event.assistantMessageEvent;
  if (!isRecord(update) || typeof update.type !== "string") return undefined;
  return update;
}

function withAssistantUpdate(event: AgentEventLike, update: Record<string, unknown>, patch: Record<string, unknown>): AgentEventLike {
  return { ...event, assistantMessageEvent: { ...update, ...patch } };
}

export function createDisplayEventTransformer(
  display: OwcDisplay,
): (event: AgentEventLike) => AgentEventLike | null {
  if (display.isIdentity) return (event) => event;

  const buffers = new Map<number, StreamBuffer>();

  function seed(index: number, raw: string): string {
    const emitted = committedText(display, raw);
    buffers.set(index, { raw, emitted });
    return emitted;
  }

  // toolcall_* events keep partial JSON, and toolcall_end replaces the block
  // before message_end. Only text and thinking are safe to present here.
  function presentAssistantStart(message: Record<string, unknown>): unknown {
    const { content } = message;
    if (!Array.isArray(content)) return message;
    let next: unknown[] | undefined;
    for (let index = 0; index < content.length; index += 1) {
      const block = content[index];
      let presented = block;
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
        const emitted = seed(index, block.text);
        if (emitted !== block.text) presented = { ...block, text: emitted };
      } else if (isRecord(block) && block.type === "thinking" && typeof block.thinking === "string") {
        const emitted = seed(index, block.thinking);
        if (emitted !== block.thinking) presented = { ...block, thinking: emitted };
      }
      if (presented === block) {
        if (next) next.push(block);
        continue;
      }
      next ??= content.slice(0, index);
      next.push(presented);
    }
    if (!next) return message;
    return { ...message, content: next };
  }

  function onDelta(event: AgentEventLike, update: Record<string, unknown>): AgentEventLike | null {
    if (typeof update.delta !== "string" || typeof update.contentIndex !== "number") return event;
    const index = update.contentIndex;
    const buffer = buffers.get(index) ?? { raw: "", emitted: "" };
    buffer.raw += update.delta;
    const full = committedText(display, buffer.raw);
    const piece = full.slice(buffer.emitted.length);
    buffer.emitted = full;
    buffers.set(index, buffer);
    if (piece.length === 0) return null;
    return withAssistantUpdate(event, update, { delta: piece });
  }

  function onEnd(event: AgentEventLike, update: Record<string, unknown>): AgentEventLike {
    if (typeof update.contentIndex === "number") buffers.delete(update.contentIndex);
    if (typeof update.content !== "string") return event;
    const content = display.presentText(update.content);
    if (content === update.content) return event;
    return withAssistantUpdate(event, update, { content });
  }

  return (event) => {
    if (event.type === "message_start") {
      buffers.clear();
      if (!isRecord(event.message) || event.message.role !== "assistant") return event;
      const message = presentAssistantStart(event.message);
      if (message === event.message) return event;
      return { ...event, message };
    }

    if (event.type === "message_end") {
      buffers.clear();
      if (!("message" in event)) return event;
      const message = display.presentMessage(event.message);
      if (message === event.message) return event;
      return { ...event, message };
    }

    if (event.type === "message_update") {
      const update = assistantUpdate(event);
      if (!update) return event;
      const kind = update.type;
      if (typeof kind === "string" && kind.startsWith("toolcall_")) return event;
      if (kind === "text_start" || kind === "thinking_start") {
        if (typeof update.contentIndex === "number") buffers.delete(update.contentIndex);
        return event;
      }
      if (kind === "text_delta" || kind === "thinking_delta") return onDelta(event, update);
      if (kind === "text_end" || kind === "thinking_end") return onEnd(event, update);
      return event;
    }

    if (event.type === "tool_execution_update") {
      const partial = event.partialResult;
      if (!isRecord(partial) || !Array.isArray(partial.content)) return event;
      const content = presentContentBlocks(display, partial.content);
      if (content === partial.content) return event;
      return { ...event, partialResult: { ...partial, content } };
    }

    return event;
  };
}
