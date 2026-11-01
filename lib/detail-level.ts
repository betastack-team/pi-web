export const DETAIL_LEVELS = ["simple", "full"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

export const DEFAULT_DETAIL_LEVEL: DetailLevel = "simple";
export const DETAIL_LEVEL_STORAGE_KEY = "pi-details";

export function parseDetailLevel(value: unknown): DetailLevel {
  return DETAIL_LEVELS.find((level) => level === value) ?? DEFAULT_DETAIL_LEVEL;
}

// Runs before first paint so technical elements never flash; storage may be blocked.
export const DETAIL_LEVEL_INIT_SCRIPT = `(function(){var d=${JSON.stringify(DEFAULT_DETAIL_LEVEL)};try{var s=localStorage.getItem(${JSON.stringify(DETAIL_LEVEL_STORAGE_KEY)});if(${JSON.stringify(DETAIL_LEVELS)}.includes(s))d=s}catch(e){}document.documentElement.dataset.details=d})();`;
