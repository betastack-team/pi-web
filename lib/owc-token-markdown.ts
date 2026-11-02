import type { Element as HastElement, Root as HastRoot, RootContent as HastContent } from "hast";
import type { Options as ReactMarkdownOptions } from "react-markdown";
import { markdownRehypePlugins } from "./markdown";
import { tokenSegments, type TokenSegment } from "./owc-tokens";

// Inline `code` is walked: its renderer reads `String(children)` only to spot a newline, which inline code never holds.
const SKIPPED_TAGS = new Set(["pre", "script", "style"]);
const SKIPPED_CLASS = /^(?:katex|math|language-math)/;

function tokenElement(token: Extract<TokenSegment, { kind: "token" }>): HastElement {
  const span = (className: string, value: string): HastElement => ({
    type: "element",
    tagName: "span",
    properties: { className: [className] },
    children: [{ type: "text", value }],
  });
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: ["owc-token"],
      "data-pii": token.piiClass,
      "data-pii-family": token.family,
    },
    children: [
      span("owc-token-mark", "⟦"),
      span("owc-token-class", token.piiClass),
      span("owc-token-code", `:${token.code}`),
      span("owc-token-mark", "⟧"),
    ],
  };
}

function isSkipped(node: HastElement): boolean {
  if (SKIPPED_TAGS.has(node.tagName)) return true;
  const className = node.properties?.className;
  return Array.isArray(className) && className.some((name) => SKIPPED_CLASS.test(String(name)));
}

/**
 * Wraps `⟦CLASS:CODE⟧` tokens in chips. It runs after the sanitizer on purpose:
 * the sanitizer would strip these classes, and the spans are built from text
 * the sanitizer already passed, never from raw HTML. textContent is unchanged.
 */
function rehypeOwcTokens(): (tree: HastRoot) => void {
  const visit = (parent: HastRoot | HastElement): void => {
    const next: HastContent[] = [];
    for (const child of parent.children) {
      if (child.type === "text") {
        for (const segment of tokenSegments(child.value)) {
          next.push(segment.kind === "text" ? { type: "text", value: segment.text } : tokenElement(segment));
        }
        continue;
      }
      if (child.type === "element" && !isSkipped(child)) visit(child);
      next.push(child);
    }
    parent.children = next;
  };
  return (tree) => visit(tree);
}

/** Model-view rendering: the chat pipeline, then colored token chips. */
export const markdownModelViewRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  ...(markdownRehypePlugins ?? []),
  rehypeOwcTokens,
];
