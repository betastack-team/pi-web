"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { FLAG_CLASSES, FLAG_MAX_CHARS, type FlagClass } from "@/lib/owc-flag-client";
import { OWC_TOKEN_SOURCE } from "@/lib/owc-tokens";

const TOKEN_ONLY = new RegExp(`^${OWC_TOKEN_SOURCE}$`);
const DEFAULT_CLASS: FlagClass = "NAME";

type Notice = { kind: "ok" | "error"; text: string } | null;

function selectedTextWithin(container: HTMLElement | null): string {
  const selection = window.getSelection();
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return "";
  const range = selection.getRangeAt(0);
  return container.contains(range.commonAncestorContainer) ? selection.toString().trim() : "";
}

async function post(method: "POST" | "DELETE", body: Record<string, unknown>): Promise<Response> {
  return fetch("/api/owc-flag", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * User-only controls for text the model was shown in clear: select it and hide it, or select a
 * token and ask for it to be shown again. Nothing here is reachable from a tool or a document.
 */
export function ModelViewHide({ children, cwd }: { children: ReactNode; cwd?: string }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState("");
  const [cls, setCls] = useState<FlagClass>(DEFAULT_CLASS);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const onChange = () => {
      const text = selectedTextWithin(containerRef.current);
      if (text) setSelected(text);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  const isToken = TOKEN_ONLY.test(selected);
  const tooLong = selected.length > FLAG_MAX_CHARS;

  const submit = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      if (isToken) {
        const response = await post("DELETE", { token: selected, cwd });
        setNotice(response.ok ? { kind: "ok", text: t("modelView.showRequested") } : { kind: "error", text: t("modelView.showFailed") });
        return;
      }
      const response = await post("POST", { cls, raw: selected, cwd });
      const body: unknown = await response.json().catch(() => null);
      const sweepable = typeof body === "object" && body !== null && "sweepable" in body ? body.sweepable : undefined;
      if (!response.ok || typeof sweepable !== "boolean") {
        setNotice({ kind: "error", text: t("modelView.hideFailed") });
        return;
      }
      setNotice({ kind: "ok", text: sweepable ? t("modelView.hidden") : t("modelView.hiddenShort") });
      setSelected("");
    } catch {
      setNotice({ kind: "error", text: t(isToken ? "modelView.showFailed" : "modelView.hideFailed") });
    } finally {
      setBusy(false);
    }
  }, [cls, cwd, isToken, selected, t]);

  return (
    <div ref={containerRef} data-ui="model-view-hide">
      {children}
      {selected && !tooLong && (
        <div className="model-view-hide-bar" role="group" aria-label={t(isToken ? "modelView.showThis" : "modelView.hideThis")}>
          {!isToken && (
            <select value={cls} onChange={(event) => setCls(event.target.value as FlagClass)} aria-label={t("modelView.hideClass")} disabled={busy}>
              {FLAG_CLASSES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          )}
          <button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? t("modelView.hiding") : t(isToken ? "modelView.showThis" : "modelView.hideThis")}
          </button>
        </div>
      )}
      {notice && <p className="model-view-hide-notice" data-kind={notice.kind} role="status">{notice.text}</p>}
    </div>
  );
}
