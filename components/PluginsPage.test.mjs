import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { PluginsPage } = await jiti.import("./PluginsPage.tsx");

const h = React.createElement;
const DESCRIPTION = "Read files from your OneDrive folder “Test Agentic Harness”. Read-only. The agent cannot reach any other folder.";
const AUTHORIZE = "https://login.example/authorize?client=test";

function decode(html) {
  return html.replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function text(html) {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function buttons(html) {
  return [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, label]) => ({ attributes, label }));
}

function page(card) {
  return decode(renderToStaticMarkup(h(I18nProvider, null, h(PluginsPage, { card }))));
}

function assertChrome(html, state) {
  assert.match(html, /data-ui="plugin-card"/);
  assert.match(html, /data-plugin="sharepoint"/);
  assert.match(html, new RegExp(`data-state="${state}"`));
  const visible = text(html);
  assert.match(visible, /^Plugins Connect a service, then ask the agent to read from it\./);
  assert.ok(visible.includes(`SharePoint ${DESCRIPTION}`), visible);
}

test("a disconnected card offers Connect", () => {
  const html = page({ state: "disconnected" });
  assertChrome(html, "disconnected");
  assert.deepEqual(buttons(html).map((button) => button.label), ["Connect"]);
  assert.doesNotMatch(html, /plugins-status-dot/);
});

test("a signing-in card waits, cancels, and links the authorize address", () => {
  const html = page({ state: "signing-in", authorizeUrl: AUTHORIZE, startedAt: 1 });
  assertChrome(html, "signing-in");
  assert.match(text(html), /Waiting for Microsoft sign-in…/);
  assert.deepEqual(buttons(html).map((button) => button.label), ["Cancel"]);
  assert.ok(html.includes(`href="${AUTHORIZE}"`));
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(text(html), /Open the sign-in window again/);
});

test("a connected card names the account and lists the folder", () => {
  const html = page({
    state: "connected",
    account: { name: "Ada Lovelace", email: "ada@example.com" },
    renews: true,
    folder: {
      name: "Test Agentic Harness",
      entries: [
        { name: "Briefing", kind: "folder", size: 0, folder: true },
        { name: "fees.xlsx", kind: "spreadsheet", size: 2048, folder: false },
      ],
    },
  });
  assertChrome(html, "connected");
  const visible = text(html);
  assert.match(visible, /Connected as Ada Lovelace/);
  assert.match(visible, /ada@example\.com/);
  assert.match(html, /plugins-status-dot/);
  assert.match(html, /class="plugins-email"[^>]*>ada@example\.com/);
  assert.match(html, /class="plugins-folder-name"[^>]*>Test Agentic Harness/);
  assert.match(visible, /Briefing folder/);
  assert.match(visible, /fees\.xlsx spreadsheet 2\.0 KB/);
  assert.deepEqual(buttons(html).map((button) => button.label), ["Disconnect"]);

  const empty = text(page({
    state: "connected",
    account: { name: "Ada Lovelace", email: "ada@example.com" },
    renews: false,
    folder: { name: "Test Agentic Harness", entries: [] },
  }));
  assert.match(empty, /This folder is empty\./);

  const broken = text(page({
    state: "connected",
    account: { name: "Ada Lovelace", email: "ada@example.com" },
    renews: true,
    folder: { name: "Test Agentic Harness", error: "The folder could not be listed." },
  }));
  assert.match(broken, /The folder could not be listed\./);
});

test("an expired card asks to reconnect", () => {
  const html = page({ state: "expired", account: { name: "Ada Lovelace", email: "ada@example.com" } });
  assertChrome(html, "expired");
  assert.match(text(html), /Your Microsoft sign-in has expired\./);
  assert.deepEqual(buttons(html).map((button) => button.label), ["Reconnect"]);
});

test("a failed card shows the message and Try again", () => {
  const html = page({ state: "failed", message: "Sign-in did not finish" });
  assertChrome(html, "failed");
  assert.match(text(html), /Sign-in did not finish/);
  assert.deepEqual(buttons(html).map((button) => button.label), ["Try again"]);
});

test("an unavailable card hides the reason until technical details are on", () => {
  const html = page({ state: "unavailable", reason: "OWC_SHAREPOINT_CLIENT_ID is missing in .env" });
  assertChrome(html, "unavailable");
  assert.match(text(html), /SharePoint is not set up on this computer\./);
  assert.match(html, /data-technical=""[^>]*>OWC_SHAREPOINT_CLIENT_ID is missing in \.env/);
  assert.deepEqual(buttons(html), []);
});
