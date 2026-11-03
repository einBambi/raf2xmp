// Der Kern darf nur Schluessel lesen, die der Leser liefert und die die Tests gegen ExifTool abdecken (USED_KEYS).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HERE, USED_KEYS } from "./helpers.js";

test("Der Kern liest nur abgedeckte Schluessel", () => {
  const src = fs.readFileSync(path.join(HERE, "..", "site", "js", "core.js"), "utf8");
  const found = new Set([...src.matchAll(/"((?:FujiFilm|ExifIFD|IFD0|RAF|FujiIFD|File):[A-Za-z0-9]+)"/g)].map((m) => m[1]));
  const missing = [...found].filter((k) => !USED_KEYS.includes(k));
  assert.deepEqual(missing, []);
  assert.ok(found.size >= 30, "zu wenige Schluessel gefunden: " + found.size);
});
