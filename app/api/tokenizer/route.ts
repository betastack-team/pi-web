import { NextResponse } from "next/server";
import { setTokenizer, tokenizerCard } from "@/lib/owc-tokenizer";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function denied(): NextResponse {
  return json({ error: "Untrusted API request" }, 403);
}

function tokenizerOf(value: unknown): "owc" | "docanonym" | undefined {
  if (typeof value !== "object" || value === null || !("tokenizer" in value)) return undefined;
  const tokenizer = value.tokenizer;
  return tokenizer === "owc" || tokenizer === "docanonym" ? tokenizer : undefined;
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
  if (!tokenizer) return json({ error: "tokenizer must be owc or docanonym" }, 400);
  if (tokenizer === "docanonym") {
    const current = await tokenizerCard();
    if (current.state === "ready" && current.docanonymUrl === null) {
      return json({ error: "OWC_DOCANONYM_URL is not set" }, 409);
    }
  }
  return json(await setTokenizer(tokenizer));
}
