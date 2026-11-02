import { NextResponse } from "next/server";
import { cancelSharePoint, connectSharePoint, disconnectSharePoint, sharePointCard } from "@/lib/owc-sharepoint";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function denied(): NextResponse {
  return json({ error: "Untrusted API request" }, 403);
}

function actionOf(value: unknown): "connect" | "cancel" | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const action = (value as { action?: unknown }).action;
  return action === "connect" || action === "cancel" ? action : undefined;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isApiRequestAllowed(request)) return denied();
  return json(await sharePointCard());
}

export async function POST(request: Request): Promise<NextResponse> {
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
  const action = actionOf(body);
  if (action === "connect") return json(await connectSharePoint());
  if (action === "cancel") return json(await cancelSharePoint());
  return json({ error: "action must be connect or cancel" }, 400);
}

export async function DELETE(request: Request): Promise<NextResponse> {
  if (!isApiRequestAllowed(request)) return denied();
  return json(await disconnectSharePoint());
}
