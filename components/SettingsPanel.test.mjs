import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const loginSource = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");

test("the trust dialog Settings › MCP opens stacks above Settings", () => {
  const zIndex = (selector) => Number(cssSource.match(new RegExp(`\\${selector} \\{[^}]*z-index: (\\d+);`))?.[1]);
  assert.ok(zIndex(".project-trust-backdrop") > zIndex(".settings-dialog-backdrop"));
});

test("the login page returns only to a destination safeLoginDestination() accepts", () => {
  assert.match(loginSource, /safeLoginDestination\(destination, window\.location\.origin\)/);
});

test("General shows Tokenizer after Chat at both detail levels", async () => {
  const source = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
  const chat = source.indexOf('t("settings.chat")');
  const tokenizer = source.indexOf('t("settings.tokenizer")');
  const sidebar = source.indexOf('t("settings.sidebar")');
  assert.ok(chat !== -1 && tokenizer > chat && sidebar > tokenizer);
  const section = source.slice(tokenizer, sidebar);
  assert.equal(section.includes("data-technical"), false);
  assert.match(section, /ConfigSwitch/);
  assert.match(section, /settings\.tokenizerUseDocAnonym/);
  assert.match(section, /settings\.tokenizerDescription/);
  assert.match(section, /settings\.tokenizerPlainHttp/);
  assert.match(section, /settings\.tokenizerMissingUrl/);
  assert.match(section, /role="alert"/);
  assert.match(section, /state === "unavailable"/);
});
