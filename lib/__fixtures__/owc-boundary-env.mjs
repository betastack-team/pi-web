// Loaded by `npm test` through --import: every session pi-web starts must load pi-owc and sit
// inside the OWC root, so each test process gets its own OWC root holding the stub pi-owc, and
// TMPDIR points into it so the folders tests create are inside the root too. A test that names
// its own OWC_PI_OWC_DIR keeps it.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.OWC_PI_OWC_DIR) {
  const owcRoot = mkdtempSync(join(tmpdir(), "pi-web-test-owc-root-"));
  cpSync(fileURLToPath(new URL("./owc-root/pi-owc", import.meta.url)), join(owcRoot, "pi-owc"), { recursive: true });
  process.env.OWC_PI_OWC_DIR = join(owcRoot, "pi-owc");
  process.env.TMPDIR = owcRoot;
  process.on("exit", () => rmSync(owcRoot, { recursive: true, force: true }));
}

/** The stub as pi lists it, for wrapper tests that mock the SDK session. */
const stubEntry = join(process.env.OWC_PI_OWC_DIR, "extensions", "index.js");
export const OWC_EXTENSION_STUB = {
  path: stubEntry,
  resolvedPath: stubEntry,
  handlers: new Map(["input", "tool_call", "tool_result"].map((event) => [event, [() => undefined]])),
};
