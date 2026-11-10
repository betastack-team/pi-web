import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isStoredLocally } from "./local-file.ts";

test("a cloud placeholder (size but no blocks) is not stored locally", () => {
  assert.equal(isStoredLocally({ size: 34, blocks: 0 }), false);
});

test("an empty file counts as stored locally", () => {
  assert.equal(isStoredLocally({ size: 0, blocks: 0 }), true);
});

test("a real file on disk is stored locally", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-file-"));
  try {
    const file = path.join(dir, "notes.txt");
    fs.writeFileSync(file, "one\ntwo\n");

    assert.equal(isStoredLocally(fs.lstatSync(file)), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
