import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { DETAIL_LEVEL_INIT_SCRIPT, parseDetailLevel } from "./detail-level.ts";

test("parseDetailLevel keeps known levels and maps everything else to simple", () => {
  assert.equal(parseDetailLevel("simple"), "simple");
  assert.equal(parseDetailLevel("full"), "full");
  assert.equal(parseDetailLevel(null), "simple");
  assert.equal(parseDetailLevel("garbage"), "simple");
});

test("first paint stamps the stored level and falls back to simple when storage is empty, invalid or blocked", () => {
  const cases = [["full", "full"], ["simple", "simple"], [null, "simple"], ["garbage", "simple"], [new Error("Blocked"), "simple"]];
  for (const [stored, expected] of cases) {
    const root = { dataset: {} };
    runInNewContext(DETAIL_LEVEL_INIT_SCRIPT, {
      localStorage: { getItem: () => { if (stored instanceof Error) throw stored; return stored; } },
      document: { documentElement: root },
    });
    assert.equal(root.dataset.details, expected);
  }
});
