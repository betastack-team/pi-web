import { NextResponse } from "next/server";
import { getSessionEntries, readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { displayForCwd } from "@/lib/owc-display";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
  const blockIndex = blockIndexParam === null ? Number.NaN : Number(blockIndexParam);
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
    return NextResponse.json({ error: "Valid blockIndex is required" }, { status: 400 });
  }

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    // SessionManager-backed parsing preserves the SDK's malformed-line tolerance.
    const entry = getSessionEntries(filePath).find((candidate) => candidate.id === entryId);
    if (!entry || entry.type !== "message" || entry.message.role !== "assistant") {
      return NextResponse.json({ error: "Assistant message not found" }, { status: 404 });
    }

    const block = entry.message.content[blockIndex];
    if (!block || block.type !== "thinking") {
      return NextResponse.json({ error: "Thinking block not found" }, { status: 404 });
    }

    const display = await displayForCwd(readSessionHeader(filePath)?.cwd);
    const pair = display.presentTextPair(block.thinking);
    return NextResponse.json(
      pair.rawText === undefined
        ? { thinking: pair.text }
        : { thinking: pair.text, rawThinking: pair.rawText },
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
