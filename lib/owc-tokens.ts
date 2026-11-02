import type { ModelViewPart } from "./owc-model-view";

export const OWC_TOKEN_SOURCE = "⟦([A-Z]{2,6}):([0-9A-HJKMNP-TV-Z]{8})⟧";

export type PiiFamily = "person" | "contact" | "place" | "money" | "id" | "time" | "other";

export const PII_FAMILY: Readonly<Record<string, PiiFamily>> = {
  NAME: "person",
  EMAIL: "contact",
  PHONE: "contact",
  ADDR: "place",
  ACCT: "money",
  PLAN: "money",
  SSN: "id",
  DL: "id",
  MRN: "id",
  DOB: "time",
  DATE: "time",
};

export type TokenSegment =
  | { kind: "text"; text: string }
  | { kind: "token"; text: string; piiClass: string; code: string; family: PiiFamily };

export function piiFamily(piiClass: string): PiiFamily {
  return Object.hasOwn(PII_FAMILY, piiClass) ? PII_FAMILY[piiClass] : "other";
}

/** Splits text into plain runs and tokens; joining every `text` returns the input. */
export function tokenSegments(text: string): TokenSegment[] {
  const segments: TokenSegment[] = [];
  const pattern = new RegExp(OWC_TOKEN_SOURCE, "g");
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    segments.push({
      kind: "token",
      text: match[0],
      piiClass: match[1],
      code: match[2],
      family: piiFamily(match[1]),
    });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

function partText(part: ModelViewPart): string {
  return part.kind === "toolInput" ? part.json : part.text;
}

export function countTokens(
  parts: readonly ModelViewPart[],
): Array<{ piiClass: string; family: PiiFamily; count: number }> {
  const counts = new Map<string, number>();
  for (const part of parts) {
    for (const segment of tokenSegments(partText(part))) {
      if (segment.kind === "token") counts.set(segment.piiClass, (counts.get(segment.piiClass) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([piiClass, count]) => ({ piiClass, family: piiFamily(piiClass), count }))
    .sort((a, b) => b.count - a.count || a.piiClass.localeCompare(b.piiClass));
}
