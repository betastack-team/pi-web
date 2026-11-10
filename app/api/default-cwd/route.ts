import { NextResponse } from "next/server";
import { owcRoot } from "@/lib/owc-boundary";

// POST /api/default-cwd
// Returns the OWC root, the one folder tree where sessions load the OWC privacy extension.
// The client then selects it through /api/cwd/validate like any other directory.
export async function POST() {
  const root = owcRoot();
  if (!root) return NextResponse.json({ error: "The OWC root was not found next to pi-web." }, { status: 503 });
  return NextResponse.json({ cwd: root });
}
