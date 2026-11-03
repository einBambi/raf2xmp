// Das mitgelieferte Pruefstueck test/fixtures/SYNTH0001.RAF: vollstaendig erfunden, gebaut von tools/make_fixtures.py.
// Es muss sich byteidentisch neu bauen lassen, der Leser muss es lesen, und mit ExifTool (falls da) kommt dasselbe heraus.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { readRaf, rafIncomplete, HEADER_BYTES } from "../site/js/reader.js";
import { HERE, ROOT, PYTHON, USED_KEYS, jsonish } from "./helpers.js";

const fixture = path.join(HERE, "fixtures", "SYNTH0001.RAF");
const hasExiftool = spawnSync("exiftool", ["-ver"]).status === 0;

test("Pruefstueck: make_fixtures.py baut es byteidentisch nach", () => {
  // eigener Ordner, damit nichts ausversehen im Repo landet
  const dir = fs.mkdtempSync(path.join(process.env.F2X_TMP || os.tmpdir(), "f2x-fixture-"));
  try {
    const out = path.join(dir, "SYNTH0001.RAF");
    const r = spawnSync(PYTHON, ["-I", path.join(ROOT, "tools", "make_fixtures.py"), out], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.readFileSync(out).equals(fs.readFileSync(fixture)), "Pruefstueck weicht von make_fixtures.py ab");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Pruefstueck: der Leser liest es vollstaendig und ohne Warnung", async () => {
  const blob = await fs.openAsBlob(fixture);
  const head = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
  assert.equal(rafIncomplete(head, blob.size), null);
  const r = await readRaf(blob);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.warnings, []);
  assert.equal(r.d["IFD0:Make"], "FUJIFILM");
  assert.equal(r.d["IFD0:Model"], "X100VI");
  assert.equal(r.d["FujiFilm:FilmMode"], "Classic Negative");
});

test("Pruefstueck: Leser gleich ExifTool", { skip: hasExiftool ? false : "exiftool fehlt" }, async () => {
  const ref = JSON.parse(execFileSync("exiftool", ["-j", "-G1", "-charset", "exif=utf8", fixture], { encoding: "utf8" }))[0];
  const r = await readRaf(await fs.openAsBlob(fixture));
  for (const k of USED_KEYS) {
    const a = ref[k] === undefined ? undefined : String(ref[k]);
    const b = r.d[k] === undefined ? undefined : String(jsonish(r.d[k]));
    assert.equal(b, a, k);
  }
});
