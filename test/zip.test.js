// ZIP-Bau: Python (zipfile) und unzip muessen das Archiv lesen, Pruefsummen und Umlaute stimmen.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildZip, crc32, ZIP_MAX_FILES } from "../site/js/zip.js";
import { PYTHON, rng } from "./helpers.js";

test("crc32 wie Python", () => {
  const out = spawnSync(PYTHON, ["-c", "import zlib;print(zlib.crc32(b'123456789'), zlib.crc32(b''), zlib.crc32('Gr\\u00fc\\u00dfe'.encode()))"], { encoding: "utf8" }).stdout.trim().split(" ").map(Number);
  assert.equal(crc32(new TextEncoder().encode("123456789")), out[0]);
  assert.equal(crc32(new Uint8Array(0)), out[1]);
  assert.equal(crc32(new TextEncoder().encode("Grüße")), out[2]);
});

test("ZIP lesbar mit Python und unzip", async () => {
  const r = rng(5);
  const items = [
    { path: "SYNTH0001.xmp", data: "<x/>\n" },
    { path: "Urlaub 2026/Kinder/SYNTH0002.xmp", data: "Umlaute: äöüß\n" },
    { path: "leer.xmp", data: new Uint8Array(0) },
    { path: "zufall.bin", data: Uint8Array.from({ length: 50000 }, () => Math.floor(r() * 256)) },
    { path: "Fotos/Ärger.xmp.bak", data: "alt" },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f2x-zip-"));
  try {
    const file = path.join(dir, "t.zip");
    fs.writeFileSync(file, Buffer.from(await buildZip(items, new Date(2026, 10, 3, 14, 36, 58)).arrayBuffer()));
    const py = spawnSync(PYTHON, ["-I", "-c", `
import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps([[i.filename, i.file_size, i.compress_type, list(i.date_time), z.read(i).hex()] for i in z.infolist()]))
`, file], { encoding: "utf8" });
    assert.equal(py.status, 0, py.stderr);
    const got = JSON.parse(py.stdout);
    assert.equal(got.length, items.length);
    items.forEach((it, i) => {
      const bytes = typeof it.data === "string" ? Buffer.from(it.data) : Buffer.from(it.data);
      assert.equal(got[i][0], it.path);
      assert.equal(got[i][1], bytes.length);
      assert.equal(got[i][2], 0);
      assert.deepEqual(got[i][3], [2026, 11, 3, 14, 36, 58]);
      assert.equal(got[i][4], bytes.toString("hex"));
    });
    const un = spawnSync("unzip", ["-tq", file], { encoding: "utf8" });
    if (un.error === undefined) assert.equal(un.status, 0, un.stdout + un.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ZIP: Obergrenze", () => {
  assert.throws(() => buildZip(Array.from({ length: ZIP_MAX_FILES + 1 }, (_, i) => ({ path: "a" + i, data: "" }))), RangeError);
});
