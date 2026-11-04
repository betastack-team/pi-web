import { NextResponse } from "next/server";
import { isTokenizer, TOKENIZER_CHOICES, type Tokenizer } from "@/lib/api-types";
import { setTokenizer, tokenizerCard, usesDocAnonym } from "@/lib/owc-tokenizer";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function denied(): NextResponse {
  return json({ error: "Untrusted API request" }, 403);
}

function tokenizerOf(value: unknown): Tokenizer | undefined {
  if (typeof value !== "object" || value === null || !("tokenizer" in value)) return undefined;
  return isTokenizer(value.tokenizer) ? value.tokenizer : undefined;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isApiRequestAllowed(request)) return denied();
  return json(await tokenizerCard());
}

export async function PUT(request: Request): Promise<NextResponse> {
  if (!isApiRequestAllowed(request)) return denied();
  if (!hasJsonContentType(request)) {
    return json({ error: "Content-Type must be application/json" }, 415);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const tokenizer = tokenizerOf(body);
  if (!tokenizer) return json({ error: `tokenizer must be ${TOKENIZER_CHOICES.join(" or ")}` }, 400);
  try {
    if (await usesDocAnonym(tokenizer)) {
      const current = await tokenizerCard();
      if (current.state === "ready" && current.docanonymUrl === null) {
        return json({ error: "OWC_DOCANONYM_URL is not set" }, 409);
      }
    }
  } catch {
    // A failed read is the same unavailable card setTokenizer already returns.
    return json(await setTokenizer(tokenizer));
  }
  return json(await setTokenizer(tokenizer));
}
