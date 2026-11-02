"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SharePointCard, SharePointEntry } from "@/lib/api-types";

const POLL_MS = 1000;
const POPUP_NAME = "betastack-sharepoint";
const POPUP_FEATURES = "popup,width=520,height=700";

function formatBytes(size: number): string {
  if (size < 1024) return `${Math.round(size)} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isCard(value: unknown): value is SharePointCard {
  if (typeof value !== "object" || value === null) return false;
  const state = (value as { state?: unknown }).state;
  return state === "unavailable"
    || state === "disconnected"
    || state === "signing-in"
    || state === "connected"
    || state === "expired"
    || state === "failed";
}

function signInHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return undefined;
  }
  return undefined;
}

async function requestCard(method: "GET" | "POST" | "DELETE", action?: "connect" | "cancel"): Promise<SharePointCard> {
  const response = await fetch("/api/sharepoint", {
    method,
    cache: "no-store",
    headers: action ? { "content-type": "application/json" } : undefined,
    body: action ? JSON.stringify({ action }) : undefined,
  });
  if (!response.ok) throw new Error(String(response.status));
  const body: unknown = await response.json();
  if (!isCard(body)) throw new Error("unreadable");
  return body;
}

function SharePointMark() {
  return (
    <svg className="plugins-mark" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="#038387" />
      <path fill="#ffffff" d="M12.5 11h9.2l5.3 5.3V28a2 2 0 0 1-2 2h-12.5a2 2 0 0 1-2-2V13a2 2 0 0 1 2-2z" />
      <path fill="#c5ecec" d="M21.7 11v5.3h5.3" />
      <path stroke="#038387" strokeWidth="1.5" strokeLinecap="round" d="M15 20.5h8M15 24h8M15 27.5h5" />
    </svg>
  );
}

function FileList({ entries }: { entries: SharePointEntry[] }) {
  return (
    <ul className="plugins-files">
      {entries.map((entry, index) => (
        <li key={`${entry.folder ? "d" : "f"}:${entry.name}:${index}`} className="plugins-file">
          <span className="plugins-file-name" title={entry.name}>{entry.name}</span>
          <span className="plugins-file-kind">{entry.kind}</span>
          <span className="plugins-file-size">{entry.folder ? "" : formatBytes(entry.size)}</span>
        </li>
      ))}
    </ul>
  );
}

export function PluginsPage({ card: injected }: { card?: SharePointCard }) {
  const { t } = useI18n();
  const controlled = injected !== undefined;
  const [live, setLive] = useState<SharePointCard | null>(null);
  const card = injected ?? live;
  const popupRef = useRef<Window | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (controlled) return;
    let cancelled = false;
    void requestCard("GET")
      .then((next) => {
        if (!cancelled) setLive(next);
      })
      .catch(() => {
        if (!cancelled) setLive({ state: "unavailable", reason: t("pluginsPage.sharePoint.requestFailed") });
      });
    return () => {
      cancelled = true;
    };
  }, [controlled, t]);

  useEffect(() => {
    if (controlled || card?.state !== "signing-in") return;
    const timer = setInterval(() => {
      void requestCard("GET")
        .then((next) => {
          // The server saves the account before the window closes itself, so a window
          // that is gone while the sign-in still waits was closed by the user.
          if (next.state === "signing-in" && popupRef.current?.closed) {
            popupRef.current = null;
            return requestCard("POST", "cancel").then(setLive);
          }
          setLive(next);
          if (next.state === "connected") closePopup();
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [controlled, card?.state]);

  function closePopup(): void {
    try {
      popupRef.current?.close();
    } catch {
      // The browser may already have closed the window.
    }
  }

  function failRequest(): void {
    setLive({ state: "failed", message: t("pluginsPage.sharePoint.requestFailed") });
  }

  function connect(): void {
    if (busyRef.current) return;
    busyRef.current = true;
    // Open the window in this click, before the request. Browsers only allow a
    // popup that starts in the gesture; the address arrives with the response.
    const popup = window.open("about:blank", POPUP_NAME, POPUP_FEATURES);
    popupRef.current = popup;
    void requestCard("POST", "connect")
      .then((next) => {
        setLive(next);
        if (next.state !== "signing-in") closePopup();
        if (next.state !== "signing-in" || !popup) return;
        const href = signInHref(next.authorizeUrl);
        if (!href) return;
        try {
          popup.location.href = href;
        } catch {
          // A blocked or closed window leaves the "open again" link.
        }
      })
      .catch(() => failRequest())
      .finally(() => {
        busyRef.current = false;
      });
  }

  function cancel(): void {
    closePopup();
    void requestCard("POST", "cancel").then(setLive).catch(() => failRequest());
  }

  function disconnect(): void {
    closePopup();
    void requestCard("DELETE").then(setLive).catch(() => failRequest());
  }

  function action(label: string, onClick: () => void, primary: boolean) {
    return (
      <div className="plugins-actions">
        <button type="button" className={primary ? "plugins-button is-primary" : "plugins-button"} onClick={onClick}>
          {label}
        </button>
      </div>
    );
  }

  let body: ReactNode = null;
  if (card?.state === "disconnected") {
    body = action(t("pluginsPage.sharePoint.connect"), connect, true);
  } else if (card?.state === "signing-in") {
    const href = signInHref(card.authorizeUrl);
    body = (
      <>
        <p className="plugins-note" role="status">{t("pluginsPage.sharePoint.waiting")}</p>
        <div className="plugins-actions">
          <button type="button" className="plugins-button" onClick={cancel}>{t("pluginsPage.sharePoint.cancel")}</button>
          {href ? (
            <a className="plugins-link" href={href} target="_blank" rel="noopener noreferrer">
              {t("pluginsPage.sharePoint.openAgain")}
            </a>
          ) : null}
        </div>
      </>
    );
  } else if (card?.state === "connected") {
    const folder = card.folder;
    body = (
      <>
        <p className="plugins-status">
          <span className="plugins-status-dot" aria-hidden="true" />
          <span>{t("pluginsPage.sharePoint.connectedAs", { name: card.account.name })}</span>
        </p>
        <p className="plugins-email">{card.account.email}</p>
        <h3 className="plugins-folder-name">{folder.name}</h3>
        {"error" in folder ? (
          <p className="plugins-folder-error" role="alert">{folder.error}</p>
        ) : folder.entries.length === 0 ? (
          <p className="plugins-folder-empty">{t("pluginsPage.sharePoint.empty")}</p>
        ) : (
          <FileList entries={folder.entries} />
        )}
        {action(t("pluginsPage.sharePoint.disconnect"), disconnect, false)}
      </>
    );
  } else if (card?.state === "expired") {
    body = (
      <>
        <p className="plugins-note">{t("pluginsPage.sharePoint.expired")}</p>
        {action(t("pluginsPage.sharePoint.reconnect"), connect, true)}
      </>
    );
  } else if (card?.state === "failed") {
    body = (
      <>
        <p className="plugins-note" role="alert">{card.message}</p>
        {action(t("pluginsPage.sharePoint.tryAgain"), connect, true)}
      </>
    );
  } else if (card?.state === "unavailable") {
    body = (
      <>
        <p className="plugins-note">{t("pluginsPage.sharePoint.unavailable")}</p>
        <p className="plugins-reason" data-technical="">{card.reason}</p>
      </>
    );
  }

  return (
    <div className="plugins-page">
      <div className="plugins-page-inner">
        <h1 className="plugins-title">{t("pluginsPage.title")}</h1>
        <p className="plugins-lede">{t("pluginsPage.lede")}</p>
        {card ? (
          <section
            className="plugins-card"
            data-ui="plugin-card"
            data-plugin="sharepoint"
            data-state={card.state}
            aria-label={t("pluginsPage.sharePoint.title")}
          >
            <div className="plugins-card-head">
              <SharePointMark />
              <h2 className="plugins-card-title">{t("pluginsPage.sharePoint.title")}</h2>
            </div>
            <div className="plugins-card-body">{body}</div>
          </section>
        ) : (
          <p className="plugins-loading" role="status">{t("pluginsPage.loading")}</p>
        )}
      </div>
    </div>
  );
}
