/**
 * pi-web always runs the local name finder in enforce mode.
 * Called before any session loads the OWC extension. A later read of
 * OWC_GLINER from the project .env cannot select off or shadow, because
 * loadRootEnv keeps a non-empty process value, and OWC_GLINER_LOCK wins
 * inside the extension even if that value were off.
 */
export function lockLocalGliner(): void {
  process.env.OWC_GLINER_LOCK = "enforce";
  process.env.OWC_GLINER = "enforce";
}
