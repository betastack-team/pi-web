import { createAgentEventStream } from "@/lib/agent-event-stream";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { createDisplayEventTransformer, displayForCwd } from "@/lib/owc-display";

function sessionCwd(session: unknown): string {
  if (typeof session !== "object" || session === null || !("cwd" in session)) return "";
  return typeof session.cwd === "string" ? session.cwd : "";
}

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (req.signal.aborted) return new Response(null, { status: 204 });

  // Fast path: already-running session
  const session = getRpcSession(id);
  let sessionPromise;
  let sessionFile: string | null = null;
  if (session?.isAlive()) {
    sessionPromise = Promise.resolve(session);
  } else {
    sessionFile = await resolveSessionPath(id);
    if (!sessionFile) {
      return new Response("Session not found", { status: 404 });
    }
    if (req.signal.aborted) return new Response(null, { status: 204 });
    sessionPromise = startRpcSession(id, sessionFile, undefined).then((result) => result.session);
  }

  const stream = createAgentEventStream(req, id, sessionPromise, async (session) => {
    try {
      let cwd = sessionCwd(session);
      if (!cwd) {
        const headerPath = sessionFile ?? await resolveSessionPath(id);
        cwd = (headerPath && readSessionHeader(headerPath)?.cwd) || "";
      }
      const display = await displayForCwd(cwd);
      if (display.isIdentity) return undefined;
      return createDisplayEventTransformer(display);
    } catch {
      return undefined;
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
