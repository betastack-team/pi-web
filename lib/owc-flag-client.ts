/** Mirrors pi-owc PII_CLASSES; flagValue still validates it, this only shapes the menu. */
export const FLAG_CLASSES = ["NAME", "SSN", "DOB", "DATE", "MRN", "PLAN", "ACCT", "DL", "EMAIL", "PHONE", "ADDR"] as const;
export type FlagClass = (typeof FLAG_CLASSES)[number];
export const FLAG_MAX_CHARS = 200;

export function isFlagClass(value: unknown): value is FlagClass {
  return typeof value === "string" && (FLAG_CLASSES as readonly string[]).includes(value);
}
