/**
 * Three things a user can send that pi passes to the model with no OWC hook in between:
 * a `!` command (pi-web calls executeBash, which skips user_bash), attached images, and
 * `/compact` instructions (pi's session_before_compact hook can cancel them but not rewrite them).
 * An OWC session refuses each with a message instead of dropping it silently.
 */

/** The tool only the pi-owc extension registers: its presence is what makes a session an OWC session. */
const OWC_MARKER_TOOL = "owc_read";

const BASH_REFUSED =
  "OWC sessions do not run ! commands: the command and its output would reach the model untokenized. Ask the agent to do it, or read the file with owc_read.";
const IMAGES_REFUSED =
  "OWC sessions do not send images to the model. Save the image in the project folder and ask the agent to read it with owc_read.";
const COMPACT_INSTRUCTIONS_REFUSED =
  "OWC sessions run /compact without instructions: pi would send them to the summarizer untokenized. Run /compact with no text.";

export function hasOwcExtension(tools: ReadonlyArray<{ name: string }>): boolean {
  return tools.some((tool) => tool.name === OWC_MARKER_TOOL);
}

/** The refusal message for a command an OWC session must not run, or undefined when it may run. */
export function owcChannelRefusal(command: Record<string, unknown>): string | undefined {
  const { type } = command;
  if (type === "bash") return BASH_REFUSED;
  if ((type === "prompt" || type === "steer" || type === "follow_up") && Array.isArray(command.images) && command.images.length > 0) {
    return IMAGES_REFUSED;
  }
  const instructions = command.customInstructions;
  const noInstructions = instructions === undefined || instructions === null || (typeof instructions === "string" && instructions.trim() === "");
  if (type === "compact" && !noInstructions) {
    return COMPACT_INSTRUCTIONS_REFUSED;
  }
  return undefined;
}
