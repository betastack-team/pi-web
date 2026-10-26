import type { AgentMessage } from "./types";

/** A tool result the caller already paired by `toolCallId`. */
export type ModelViewToolResults =
  | ReadonlyMap<string, { content?: unknown }>
  | Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResultMap(
  value: ModelViewToolResults,
): value is ReadonlyMap<string, { content?: unknown }> {
  return value instanceof Map;
}

function resultForCall(
  toolResults: ModelViewToolResults | undefined,
  toolCallId: string,
): { content?: unknown } | undefined {
  if (!toolResults || !toolCallId) return undefined;
  if (isResultMap(toolResults)) return toolResults.get(toolCallId);
  const value = toolResults[toolCallId];
  return isRecord(value) ? value : undefined;
}

function appendResultRawText(parts: string[], content: unknown): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isRecord(block) || block.type !== "text" || typeof block.rawText !== "string") continue;
    parts.push(block.rawText);
  }
}

/**
 * The tokenized body for one message, in content order.
 * Returns null when the message has no tokenized sibling to show.
 * `extraRawThinking` supplies reasoning loaded after the block was stored,
 * keyed by the block's index in `content`.
 */
export function modelViewBody(
  message: AgentMessage,
  toolResultsByCallId?: ModelViewToolResults,
  extraRawThinking?: ReadonlyMap<number, string>,
): string | null {
  const parts: string[] = [];
  const content = "content" in message ? message.content : undefined;

  if (typeof content === "string") {
    if ("rawContent" in message && typeof message.rawContent === "string") parts.push(message.rawContent);
  } else if (Array.isArray(content)) {
    content.forEach((block, index) => {
      if (!isRecord(block)) return;
      if (block.type === "text") {
        if (typeof block.rawText === "string") parts.push(block.rawText);
        return;
      }
      if (block.type === "thinking") {
        const raw = typeof block.rawThinking === "string"
          ? block.rawThinking
          : extraRawThinking?.get(index);
        if (typeof raw === "string") parts.push(`thinking: ${raw}`);
        return;
      }
      if (block.type !== "toolCall") return;
      if (Object.hasOwn(block, "modelInput") && block.modelInput !== undefined) {
        const toolName = typeof block.toolName === "string" ? block.toolName : "";
        parts.push(`tool ${toolName}: ${JSON.stringify(block.modelInput ?? null, null, 2)}`);
      }
      const toolCallId = typeof block.toolCallId === "string" ? block.toolCallId : "";
      appendResultRawText(parts, resultForCall(toolResultsByCallId, toolCallId)?.content);
    });
  }

  return parts.length === 0 ? null : parts.join("\n");
}
