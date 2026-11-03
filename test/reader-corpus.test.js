// Reader gegen ExifTool auf echten RAFs (nur lokal): F2X_RAF_DIRS = Ordner mit RAFs, durch ":" getrennt.
// Verglichen werden alle Schluessel, die der Kern liest, als Text. ExifTool laeuft nur im Test, die Seite braucht es nicht.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readRaf, rafIncomplete, HEADER_BYTES } from "../site/js/reader.js";
import { USED_KEYS, jsonish, pyIncomplete } from "./helpers.js";

const dirs = (process.env.F2X_RAF_DIRS || "").split(":").filter(Boolean);
const skip = dirs.length === 0 ? "F2X_RAF_DIRS fehlt" : false;

function listRafs(dir) {
  return fs.readdirSync(dir).filter((n) => /\.raf$/i.test(n) && !n.startsWith("._")).sort().map((n) => path.join(dir, n));
}

for (const dir of dirs) {
  test("Reader gegen ExifTool: " + path.basename(dir), { skip }, async () => {
    const files = listRafs(dir);
    assert.ok(files.length > 0, "keine RAFs in " + dir);
    const ref = JSON.parse(execFileSync("exiftool", ["-j", "-G1", "-charset", "filename=utf8", "-charset", "exif=utf8", ...files], { maxBuffer: 1 << 30, encoding: "utf8" }));
    let compared = 0;
    for (let i = 0; i < files.length; i++) {
      const blob = await fs.openAsBlob(files[i]);
      const r = await readRaf(blob);
      assert.equal(r.status, "ok", files[i]);
      const ex = ref[i];
      for (const k of USED_KEYS) {
        const a = ex[k] === undefined ? undefined : String(ex[k]);
        const b = r.d[k] === undefined ? undefined : String(jsonish(r.d[k]));
        if (k === "FujiIFD:VignettingParams") {
          assert.equal(Boolean(b), Boolean(a), path.basename(files[i]) + " " + k);
        } else {
          assert.equal(b, a, path.basename(files[i]) + " " + k);
        }
        compared++;
      }
    }
    assert.ok(compared > 0);
    // Vollstaendigkeitspruefung wie in Python (die Testdaten sind absichtlich gekuerzt)
    const py = pyIncomplete(files);
    for (let i = 0; i < files.length; i++) {
      const blob = await fs.openAsBlob(files[i]);
      const head = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
      assert.deepEqual(rafIncomplete(head, blob.size), py[i], files[i]);
    }
  });
}
