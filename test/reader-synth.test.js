// Reader gegen ExifTool auf erfundenen RAFs: Sonderfaelle von Hand, dazu eine Zufallsreihe. Braucht nur exiftool, keine Fotos.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { readRaf } from "../site/js/reader.js";
import { makeXmp } from "../site/js/core.js";
import { LookDb } from "../site/js/looks.js";
import { buildRaf, defaults, T, pair16, u32 } from "./synth.js";
import { USED_KEYS, jsonish, rng, publicLooksJson, runPython, toolAvailable } from "./helpers.js";

const hasExiftool = spawnSync("exiftool", ["-ver"]).status === 0;
const skip = hasExiftool ? false : "exiftool fehlt";

async function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(process.env.F2X_TMP || os.tmpdir(), "f2x-synth-"));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// specs -> Schluessel-Vergleich. Gibt die Liste der Abweichungen zurueck (leer = gleich).
async function diff(specs) {
  return withDir(async (dir) => {
    const files = specs.map((s, i) => {
      const f = path.join(dir, "S" + String(i).padStart(4, "0") + ".RAF");
      fs.writeFileSync(f, buildRaf(s));
      return f;
    });
    const out = execFileSync("exiftool", ["-j", "-G1", "-charset", "exif=utf8", ...files], { maxBuffer: 1 << 28, encoding: "utf8" });
    const ref = JSON.parse(out);
    const bad = [];
    for (let i = 0; i < files.length; i++) {
      const r = await readRaf(await fs.openAsBlob(files[i]));
      for (const k of USED_KEYS) {
        const a = ref[i][k] === undefined ? undefined : String(ref[i][k]);
        const b = r.d[k] === undefined ? undefined : String(jsonish(r.d[k]));
        const same = k === "FujiIFD:VignettingParams" ? Boolean(a) === Boolean(b) : a === b;
        if (!same) bad.push({ i, k, exiftool: a, reader: b, spec: JSON.stringify(specs[i]).slice(0, 400) });
      }
    }
    return bad;
  });
}

const base = (over = {}) => ({ ...defaults(), ...over });
const mk = (...extra) => {
  const m = new Map(defaults().maker.map((e) => [e[0], e]));
  for (const e of extra) m.set(e[0], e);
  return [...m.values()];
};

test("Reader gegen ExifTool: Sonderfaelle", { skip }, async () => {
  const specs = [
    base(),
    // Schwarzweiss: Tonung so abgelegt wie in echten Dateien (BYTE) und in anderen Formen
    base({ maker: mk([0x1003, T.SHORT, 0x502], [0x1049, T.BYTE, -3], [0x104b, T.BYTE, 2]) }),
    base({ maker: mk([0x1003, T.SHORT, 0x302], [0x1049, T.SBYTE, 4], [0x104b, T.SBYTE, -5]) }),
    base({ maker: mk([0x1003, T.SHORT, 0x500], [0x1049, T.BYTE, 0], [0x104b, T.BYTE, 0]) }),
    base({ maker: mk([0x1003, T.SHORT, 0x502], [0x1049, T.SLONG, -3], [0x104b, T.SLONG, 2]) }),
    base({ maker: mk([0x1003, T.SHORT, 0x500], [0x1049, T.SSHORT, -300], [0x104b, T.SLONG, 0]) }),
    // Rauschminderung: alte und neue Kennung
    base({ maker: mk([0x100b, T.SHORT, 0x40]) }),
    base({ maker: mk([0x100b, T.SHORT, 0x80]) }),
    base({ maker: mk([0x100b, T.SHORT, 0x40], [0x100e, T.SHORT, 0x180]) }),
    // Belichtungskorrektur
    ...[[50, 100], [-50, 100], [150, 100], [100, 100], [-100, 100], [67, 100], [-167, 100], [1, 3], [0, 1], [33, 100], [-1, 3], [200, 100], [250, 100], [-250, 100], [7, 10], [0, 0]]
      .map((ev) => base({ expComp: ev })),
    // Ausrichtung
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((o) => base({ orientation: o })),
    // unbekannte Werte
    base({ maker: mk([0x1001, T.SHORT, 0x83], [0x1002, T.SHORT, 0x123], [0x1003, T.SHORT, 0x777], [0x1401, T.SHORT, 0xc00]) }),
    base({ maker: mk([0x100f, T.SLONG, -1500], [0x1040, T.SLONG, 8], [0x1041, T.SLONG, -8], [0x1047, T.SLONG, 48], [0x1048, T.SLONG, 7], [0x104c, T.SHORT, 5], [0x104e, T.SLONG, 9]) }),
    base({ maker: mk([0x1040, T.SLONG, 24], [0x1041, T.SLONG, -24], [0x1005, T.SHORT, 0], [0x1403, T.SHORT, 800]) }),
    base({ maker: mk([0x100a, T.SLONG, [0, 0]]) }),
    base({ maker: mk([0x100a, T.SLONG, [20, -20]]) }),
    // Zuschnitt aus der Kamera, Digital-Tele
    base({ maker: mk([0x1051, T.BYTE, 1], [0x1052, T.LONG, [1104, 736]], [0x1053, T.LONG, [2208, 1472]]), rafDir: [[0x111, pair16(5152, 7728)], [0x115, pair16(2, 3)], [0x117, u32(1)], [0x118, pair16(1280, 1920)], [0x119, pair16(2592, 3888)]] }),
    base({ rafDir: [[0x111, pair16(5152, 7728)], [0x115, pair16(9, 16)], [0x117, u32(0)]] }),
    base({ rafDir: [[0x111, pair16(5152, 7728)], [0x115, pair16(1, 1)], [0x117, u32(2)]] }),
    // fehlende Teile
    base({ vignetting: false }),
    base({ maker: null }),
    base({ noJpeg: true }),
    base({ rafDir: [] }),
    base({ model: null, make: null, iso: null, expComp: null, exifW: null, exifH: null, orientation: null }),
    base({ model: "X-T5  ", make: "FUJIFILM " }),
  ];
  const bad = await diff(specs);
  assert.deepEqual(bad, []);
});

// Belichtungskorrektur im Raster: ganze, halbe, Drittel- und Hundertstelwerte, dazu Werte knapp neben den Dritteln (da sitzen die Schwellen)
test("Reader gegen ExifTool: Belichtungskorrektur im Raster", { skip }, async () => {
  const seen = new Set();
  const evs = [];
  const add = (n, d) => {
    if (!seen.has(n + "/" + d)) { seen.add(n + "/" + d); evs.push([n, d]); }
  };
  for (const d of [1, 2, 3, 6, 10, 100, 1000]) {
    const lim = 5 * d;
    const step = Math.max(1, Math.floor((2 * lim) / 60));
    for (let n = -lim; n <= lim; n += step) add(n, d);
    for (let k = -15; k <= 15; k++) for (let e = -2; e <= 2; e++) add(Math.round((d * k) / 3) + e, d);
  }
  const bad = await diff(evs.map((ev) => base({ expComp: ev })));
  assert.deepEqual(bad.slice(0, 5), []);
});

// --- Zufallsreihe -------------------------------------------------------------------------------------------------------------

function randomSpec(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const known = (tbl, wildChance = 0.15) => (r() < wildChance ? int(0, 0x600) : pick(tbl));
  const s = defaults();
  const m = new Map();
  const put = (tag, type, v) => m.set(tag, [tag, type, v]);
  put(0x1001, T.SHORT, known([0, 1, 2, 3, 4, 5, 6, 0x82, 0x84, 0x8000, 0xffff]));
  put(0x1002, T.SHORT, known([0, 1, 2, 0x100, 0x200, 0x300, 0x301, 0x302, 0x303, 0x304, 0x400, 0x500, 0x600, 0xf00, 0xf01, 0xf02, 0xf03, 0xf04, 0xff0]));
  put(0x1003, T.SHORT, known([0, 0x80, 0x100, 0xc0, 0xe0, 0x180, 0x200, 0x300, 0x301, 0x302, 0x303, 0x310, 0x400, 0x4c0, 0x4e0, 0x500, 0x501, 0x502, 0x503, 0x8000]));
  if (r() < 0.9) put(0x1005, T.SHORT, int(2500, 10000));
  put(0x100a, T.SLONG, [int(-9, 9) * 20, int(-9, 9) * 20]);
  if (r() < 0.5) put(0x100b, T.SHORT, pick([0x40, 0x80, 0x100, 0x7]));
  if (r() < 0.9) put(0x100e, T.SHORT, known([0, 0x100, 0x180, 0x1c0, 0x1e0, 0x200, 0x280, 0x2c0, 0x2e0]));
  put(0x100f, T.SLONG, r() < 0.9 ? int(-5, 5) * 1000 : int(-6000, 6000));
  put(0x1040, T.SLONG, r() < 0.8 ? pick([-64, -48, -32, -16, 0, 16, 32]) : int(-70, 40));
  put(0x1041, T.SLONG, r() < 0.8 ? pick([-64, -48, -32, -16, 0, 16, 32]) : int(-70, 40));
  put(0x1047, T.SLONG, known([0, 32, 64], 0.1));
  put(0x1048, T.SLONG, known([0, 32, 64], 0.1));
  if (r() < 0.9) put(0x104c, T.SHORT, known([0, 16, 32], 0.1));
  put(0x104e, T.SLONG, known([0, 32, 64], 0.1));
  put(0x1401, T.SHORT, r() < 0.9 ? pick([0, 0x100, 0x110, 0x120, 0x130, 0x200, 0x300, 0x400, 0x500, 0x501, 0x600, 0x700, 0x800, 0x900, 0xa00, 0xb00]) : int(0, 0xfff));
  put(0x1403, T.SHORT, pick([100, 200, 400, 800, 0, 1]));
  if (r() < 0.4) {
    const t = pick([T.BYTE, T.BYTE, T.SBYTE, T.SLONG]);
    put(0x1049, t, int(-9, 9));
    put(0x104b, t, int(-9, 9));
  }
  if (r() < 0.5) {
    put(0x1051, T.BYTE, pick([0, 1]));
    put(0x1052, T.LONG, [int(0, 3000), int(0, 2000)]);
    put(0x1053, T.LONG, [int(100, 4000), int(100, 3000)]);
  }
  s.maker = [...m.values()];
  s.iso = pick([100, 125, 160, 200, 400, 800, 1600, 3200, 6400, 12800, 25600]);
  s.expComp = pick([[0, 1], [-33, 100], [-67, 100], [33, 100], [67, 100], [100, 100], [-100, 100], [50, 100], [-150, 100], [133, 100], [-167, 100], [500, 100], [-500, 100]]);
  s.orientation = pick([1, 1, 6, 8, 3]);
  s.exifW = pick([4416, 6240, 7728]);
  s.exifH = pick([2944, 4160, 5152]);
  const zoom = r() < 0.5;
  s.rafDir = [[0x111, pair16(5152, 7728)], [0x115, pair16(...pick([[2, 3], [9, 16], [1, 1], [4, 5], [5, 4]]))], [0x117, u32(zoom ? 1 : 0)]];
  if (zoom) s.rafDir.push([0x118, pair16(int(0, 2000), int(0, 3000))], [0x119, pair16(int(1000, 4000), int(1000, 5000))]);
  s.vignetting = r() < 0.9;
  return s;
}

test("Reader gegen ExifTool: Zufallsreihe", { skip }, async () => {
  const r = rng(20261103);
  const specs = Array.from({ length: 400 }, () => randomSpec(r));
  const bad = await diff(specs);
  assert.deepEqual(bad.slice(0, 5), []);
});

// --- Ende zu Ende ----------------------------------------------------------------------------------------------------------------

const MODES = [{}, { neutral: true }, { wb: "recipe" }, { tone: "curve" }, { noCrop: true, noLens: true }, { noAspectCrop: true }, { noProfile: true },
  { film: "sepia" }, { film: "acros ye", wb: "recipe" }, { film: "classic chrome" }];

test("Ende zu Ende: erfundene RAF -> Leser -> Kern gleich ExifTool -> Python", { skip: skip || (toolAvailable ? false : "Python-Werkzeug fehlt") }, async () => {
  const r = rng(20261105);
  const specs = Array.from({ length: 300 }, () => randomSpec(r));
  const dbObj = publicLooksJson();
  await withDir(async (dir) => {
    const files = specs.map((s, i) => {
      const f = path.join(dir, "E" + String(i).padStart(4, "0") + ".RAF");
      fs.writeFileSync(f, buildRaf(s));
      return f;
    });
    const ref = JSON.parse(execFileSync("exiftool", ["-j", "-G1", "-charset", "exif=utf8", ...files], { maxBuffer: 1 << 28, encoding: "utf8" }));
    const py = runPython(ref.map((d, i) => ({ d, opts: MODES[i % MODES.length] })), dbObj);
    const db = LookDb.withBuiltin();
    const bad = [];
    for (let i = 0; i < files.length; i++) {
      const rr = await readRaf(await fs.openAsBlob(files[i]));
      const js = makeXmp(rr.d, MODES[i % MODES.length], db);
      if (js.xmp !== py[i].xmp || JSON.stringify(js.notes) !== JSON.stringify(py[i].notes)) bad.push(i);
    }
    assert.deepEqual(bad.slice(0, 10), []);
  });
});
