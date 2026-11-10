// Stands in for pi-owc in tests: it registers the boundary hooks pi-web requires and changes nothing.
export default function (pi) {
  pi.on("input", () => ({ action: "continue" }));
  pi.on("tool_call", () => undefined);
  pi.on("tool_result", () => undefined);
}
