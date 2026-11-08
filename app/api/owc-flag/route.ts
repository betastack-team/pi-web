import { NextResponse } from "next/server";
import { OWC_TOKEN_SOURCE } from "@/lib/owc-tokens";
import { flagValue, isFlagClass, requestUnflag, FLAG_CLASSES } from "@/lib/owc-flag";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const TOKEN_ONLY = new RegExp(`^${OWC_TOKEN_SOURCE}$`);
const REASON_STATUS = { empty: 400, "bad-class": 400, "too-long": 400, unavailable: 503 } as const;

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function readBody(request: Request): Promise<Record<string, unknown> | NextResponse> {
  if (!isApiRequestAllowed(request)) return json({ error: "Untrusted API request" }, 403);
  if (!hasJsonContentType(request)) return json({ error: "Content-Type must be application/json" }, 415);
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Falls through to the same 400 as a non-object body.
  }
  return json({ error: "Invalid JSON" }, 400);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Hide a value. Only the user's own click reaches this; no model tool calls it. */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;
  if (!isFlagClass(body.cls)) return json({ error: `cls must be one of ${FLAG_CLASSES.join(", ")}` }, 400);
  if (typeof body.raw !== "string") return json({ error: "raw must be a string" }, 400);
  const outcome = await flagValue({
    cls: body.cls,
    raw: body.raw,
    docRef: optionalString(body.docRef),
    cwd: optionalString(body.cwd),
  });
  if (!outcome.ok) return json({ ok: false, reason: outcome.reason }, REASON_STATUS[outcome.reason]);
  return json(outcome);
}

/** Ask for a token to be shown again. A person approves it later; nothing is retired here. */
export async function DELETE(request: Request): Promise<NextResponse> {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;
  if (typeof body.token !== "string" || !TOKEN_ONLY.test(body.token)) return json({ error: "token must be a token" }, 400);
  const recorded = await requestUnflag({ token: body.token, docRef: optionalString(body.docRef), cwd: optionalString(body.cwd) });
  return recorded ? json({ ok: true }) : json({ ok: false, reason: "unavailable" }, 503);
}
