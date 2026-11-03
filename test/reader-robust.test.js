// Der Leser darf bei kaputten, abgeschnittenen und zufaellig veraenderten Dateien nie werfen und nie haengen.

import test from "node:test";
import assert from "node:assert/strict";
import { readRaf, rafIncomplete, HEADER_BYTES } from "../site/js/reader.js";
import { buildRaf, defaults } from "./synth.js";
import { rng } from "./helpers.js";

test("Leser: veraenderte und abgeschnittene Dateien", async () => {
  const r = rng(20261106);
  const base = buildRaf(defaults());
  const bad = [];
  for (let i = 0; i < 3000; i++) {
    const bytes = Uint8Array.from(base);
    const mode = i % 4;
    if (mode === 0) { // einzelne Bytes veraendern
      for (let k = 0; k < 1 + Math.floor(r() * 12); k++) bytes[Math.floor(r() * bytes.length)] = Math.floor(r() * 256);
    } else if (mode === 1) { // Kopf veraendern (Offsets und Laengen)
      for (let k = 0; k < 1 + Math.floor(r() * 6); k++) bytes[0x3c + Math.floor(r() * 0x40)] = Math.floor(r() * 256);
    } else if (mode === 2) { // Zahlen im Kopf auf Extremwerte
      for (const off of [0x54, 0x58, 0x5c, 0x60, 0x64, 0x68]) if (r() < 0.4) new DataView(bytes.buffer).setUint32(off, [0, 1, 0xffffffff, 0x7fffffff, 0x80000000, 0x10000][Math.floor(r() * 6)]);
    }
    const cut = mode === 3 ? Math.floor(r() * bytes.length) : bytes.length;
    const blob = new Blob([bytes.subarray(0, cut)]);
    const t0 = performance.now();
    try {
      const res = await readRaf(blob);
      assert.ok(["ok", "skip", "error"].includes(res.status), "Status " + res.status);
      rafIncomplete(new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer()), blob.size);
    } catch (e) {
      bad.push({ i, mode, cut, fehler: String(e).slice(0, 120) });
    }
    if (performance.now() - t0 > 500) bad.push({ i, mode, langsam: Math.round(performance.now() - t0) });
  }
  assert.deepEqual(bad.slice(0, 8), []);
});
