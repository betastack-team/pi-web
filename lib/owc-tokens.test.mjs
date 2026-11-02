import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { tokenSegments, countTokens } = await jiti.import("./owc-tokens.ts");

test("splits adjacent tokens without empty text between them", () => {
  const segments = tokenSegments("Hi ⟦NAME:XP43H61B⟧⟦EMAIL:AAAAAAAA⟧!");
  assert.deepEqual(segments.map((s) => s.kind), ["text", "token", "token", "text"]);
  assert.equal(segments[1].piiClass, "NAME");
  assert.equal(segments[1].code, "XP43H61B");
  assert.equal(segments[1].family, "person");
  assert.equal(segments[2].family, "contact");
});

test("text without tokens is one text segment", () => {
  assert.deepEqual(tokenSegments("plain"), [{ kind: "text", text: "plain" }]);
  assert.deepEqual(tokenSegments(""), []);
});

test("an unknown class falls into the other family", () => {
  assert.equal(tokenSegments("⟦ZZZ:XP43H61B⟧")[0].family, "other");
  assert.equal(tokenSegments("⟦CONSTRUCTOR:XP43H61B⟧").length, 1);
});

test("joining every segment returns the input exactly", () => {
  const input = "a ⟦SSN:XP43H61B⟧⟦DOB:XP43H61B⟧ b ⟦bad:XP43H61B⟧ ⟦NAME:XP43H61B";
  assert.equal(tokenSegments(input).map((s) => s.text).join(""), input);
});

test("counts tokens across parts, sorted by count then class", () => {
  const counts = countTokens([
    { kind: "text", text: "⟦NAME:XP43H61B⟧ ⟦NAME:XP43H61C⟧ ⟦EMAIL:XP43H61B⟧" },
    { kind: "toolInput", toolName: "x", json: '{"a":"⟦ACCT:XP43H61B⟧"}' },
  ]);
  assert.deepEqual(counts.map((c) => [c.piiClass, c.count]), [["NAME", 2], ["ACCT", 1], ["EMAIL", 1]]);
});
