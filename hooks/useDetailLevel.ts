import { useSyncExternalStore } from "react";
import { DEFAULT_DETAIL_LEVEL, DETAIL_LEVEL_STORAGE_KEY, parseDetailLevel, type DetailLevel } from "@/lib/detail-level";

// The data-details attribute on <html> is the live value: the CSS hides technical elements from it,
// and DETAIL_LEVEL_INIT_SCRIPT sets it before first paint. Storage only carries it across reloads.
const listeners = new Set<() => void>();

function readStoredLevel(): DetailLevel {
  try {
    return parseDetailLevel(window.localStorage.getItem(DETAIL_LEVEL_STORAGE_KEY));
  } catch {
    return DEFAULT_DETAIL_LEVEL;
  }
}

function applyLevel(next: DetailLevel): void {
  document.documentElement.dataset.details = next;
  listeners.forEach((listener) => listener());
}

function getSnapshot(): DetailLevel {
  return parseDetailLevel(document.documentElement.dataset.details);
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== DETAIL_LEVEL_STORAGE_KEY) return;
  applyLevel(readStoredLevel());
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function setDetailLevel(next: DetailLevel): void {
  try {
    window.localStorage.setItem(DETAIL_LEVEL_STORAGE_KEY, next);
  } catch {}
  applyLevel(next);
}

export function useDetailLevel(): DetailLevel {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_DETAIL_LEVEL);
}
