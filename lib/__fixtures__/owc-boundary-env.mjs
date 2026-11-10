// Loaded by `npm test` through --import: every session pi-web starts must load pi-owc,
// so test sessions load this stub unless a test names its own OWC_PI_OWC_DIR.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.OWC_PI_OWC_DIR ??= fileURLToPath(new URL("./owc-root/pi-owc", import.meta.url));

/** The stub as pi lists it, for wrapper tests that mock the SDK session. */
const stubEntry = join(process.env.OWC_PI_OWC_DIR, "extensions", "index.js");
export const OWC_EXTENSION_STUB = {
  path: stubEntry,
  resolvedPath: stubEntry,
  handlers: new Map(["input", "tool_call", "tool_result"].map((event) => [event, [() => undefined]])),
};
