// Kern gegen das Python-Werkzeug auf Zufallsangaben. Braucht nur das Python-Werkzeug, keine Fotos.
// Drei Wege muessen dieselbe XMP und dieselben Hinweise liefern: Python (Angaben wie exiftool -j sie schreibt),
// der Kern mit denselben Angaben und der Kern mit den Angaben in der Form, in der sie der Leser der Seite liefert.

import test from "node:test";
import assert from "node:assert/strict";
import { makeXmp, PROFILES } from "../site/js/core.js";
import { LookDb } from "../site/js/looks.js";
import { pyDb, publicLooksJson, runPython, toolAvailable, jsonish, rng } from "./helpers.js";

const skip = toolAvailable ? false : "das Python-Werkzeug fehlt";

const MODELS = ["X100VI", "X100VI", "X100VI", "X100V", "X-T5", "X-H2S", "X-Pro3", "X-S20", "GFX100S", "X-T30 II"];
const ORIENTS = ["Horizontal (normal)", "Horizontal (normal)", "Rotate 90 CW", "Rotate 270 CW", "Rotate 180", "Mirror horizontal", "Mirror vertical",
  "Mirror horizontal and rotate 270 CW", "Mirror horizontal and rotate 90 CW", "Unknown (9)"];
const SATS = ["0 (normal)", "0 (normal)", "+1 (medium high)", "+2 (high)", "+3 (very high)", "+4 (highest)", "-1 (medium low)", "Low", "None (B&W)",
  "B&W Red Filter", "B&W Yellow Filter", "B&W Green Filter", "B&W Sepia", "-2 (low)", "-3 (very low)", "-4 (lowest)", "Acros", "Acros Red Filter",
  "Acros Yellow Filter", "Acros Green Filter", "Film Simulation", "Unknown (0x777)"];
const FILMS = ["F0/Standard (Provia)", "F1/Studio Portrait", "F1a/Studio Portrait Enhanced Saturation", "F1b/Studio Portrait Smooth Skin Tone (Astia)",
  "F1c/Studio Portrait Increased Sharpness", "F2/Fujichrome (Velvia)", "F3/Studio Portrait Ex", "F4/Velvia", "Pro Neg. Std", "Pro Neg. Hi", "Classic Chrome",
  "Eterna", "Classic Negative", "Bleach Bypass", "Nostalgic Neg", "Reala ACE", "Unknown (0xc00)"];
const WBS = ["Auto", "Auto (white priority)", "Auto (ambiance priority)", "Daylight", "Cloudy", "Daylight Fluorescent", "Day White Fluorescent",
  "White Fluorescent", "Warm White Fluorescent", "Living Room Warm White Fluorescent", "Incandescent", "Flash", "Underwater", "Custom", "Custom2",
  "Custom3", "Kelvin", "Unknown (0x777)"];
const TONES = ["+4 (hardest)", "+3 (very hard)", "+2 (hard)", "+1 (medium hard)", "0 (normal)", "0 (normal)", "-1 (medium soft)", "-2 (soft)"];
const NRS = ["0 (normal)", "+2 (strong)", "+1 (medium strong)", "+3 (very strong)", "+4 (strongest)", "-2 (weak)", "-1 (medium weak)", "-3 (very weak)",
  "-4 (weakest)", "Low", "Normal", "Unknown (0x1234)"];
const SHARPS = ["-4 (softest)", "-3 (very soft)", "-2 (soft)", "0 (normal)", "0 (normal)", "+2 (hard)", "+3 (very hard)", "+4 (hardest)", "-1 (medium soft)",
  "+1 (medium hard)", "Film Simulation", "n/a", "Unknown (0x77)"];
const OWS = ["Off", "Off", "Weak", "Strong", "Unknown (7)"];
const GSIZES = ["Off", "Small", "Large", "Unknown (9)"];
const EVS = ["0", "+0.33", "-0.33", "+0.67", "-0.67", "+1", "-1", "+1.33", "-1.33", "+1.67", "-1.67", "+2", "-2", "+1/2", "-1/2", "+3/2", "-3/2",
  "+2.33", "-3", "+5", "+4.33", "-5"];
const ASPECTS = ["3:2", "3:2", "3:2", "16:9", "1:1", "4:5", "5:4", "65:24", "7:6", "0:0", "3:0"];
const SIZES = ["7728x5152", "7728x5152", "5152x7728", "6240x4160", "4416x2944", "7728x4344", "5152x5152", "0x0", "7728x0"];
// Unsinn, den exiftool als Text lassen wuerde (reine Zahlen wuerde es zur Zahl machen, und so etwas liefert der Leser nie)
const WILD = ["", "garbage", "Unknown (0x777)", "+", "-", "1/0", "+3.5", "12 34", "  9  ", "3 (x)", "0x10"];

function randomDict(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const d = { "File:FileType": "RAF", "IFD0:Make": "FUJIFILM" };
  // Wert setzen (meist), manchmal weglassen, manchmal durch Unsinn ersetzen
  const set = (k, v, absent = 0.04, wild = 0.04) => {
    const x = r();
    if (x < absent) return;
    d[k] = x < absent + wild ? pick(WILD) : v;
  };
  const bw = () => {
    const v = int(-9, 9);
    return r() < 0.1 ? [v, int(-9, 9), 0, 0].join(" ").replace(/^(\d)/, "+$1") : v > 0 ? "+" + v : String(v);
  };
  const twoInts = (a, b) => int(0, a) + (r() < 0.9 ? " " : "x") + int(0, b);

  set("IFD0:Model", pick(MODELS), 0.03);
  set("IFD0:Orientation", pick(ORIENTS), 0.03);
  set("ExifIFD:ISO", pick([100, 125, 160, 200, 400, 800, 1600, 3200, 3200, 6400, 12800, 25600, 51200]), 0.03);
  set("ExifIFD:ExposureCompensation", pick(EVS), 0.03);
  const wide = pick([[4416, 2944], [6240, 4160], [7728, 5152], [4416, 2944], [3000, 2000]]);
  set("ExifIFD:ExifImageWidth", wide[0], 0.04, 0.01);
  set("ExifIFD:ExifImageHeight", wide[1], 0.04, 0.01);

  set("FujiFilm:Saturation", pick(SATS));
  set("FujiFilm:FilmMode", pick(FILMS));
  set("FujiFilm:WhiteBalance", pick(WBS));
  set("FujiFilm:WhiteBalanceFineTune", "Red " + (r() < 0.5 ? "+" : "-") + int(0, 9) * 20 + ", Blue " + (r() < 0.5 ? "+" : "-") + int(0, 9) * 20);
  set("FujiFilm:ColorTemperature", r() < 0.8 ? pick([2500, 3200, 4500, 5000, 5500, 6000, 6500, 7500, 10000]) : int(1000, 12000), 0.1, 0.02);
  const tone = () => (r() < 0.8 ? pick(TONES) : -int(-70, 40) / 16);
  set("FujiFilm:HighlightTone", tone());
  set("FujiFilm:ShadowTone", tone());
  set("FujiFilm:DevelopmentDynamicRange", pick([100, 100, 100, 200, 400, 800, 0, 50]));
  set("FujiFilm:Clarity", r() < 0.85 ? String(int(-5, 5)) : "Unknown (" + int(-6000, 6000) + ")");
  set("FujiFilm:NoiseReduction", pick(NRS));
  set("FujiFilm:Sharpness", pick(SHARPS));
  set("FujiFilm:ColorChromeEffect", pick(OWS));
  set("FujiFilm:ColorChromeFXBlue", pick(OWS));
  set("FujiFilm:GrainEffectRoughness", pick(OWS));
  set("FujiFilm:GrainEffectSize", pick(GSIZES));
  if (r() < 0.6) {
    set("FujiFilm:BWAdjustment", bw(), 0.1);
    set("FujiFilm:BWMagentaGreen", bw(), 0.1);
  }
  if (r() < 0.4) {
    set("FujiFilm:CropFlag", pick([0, 1, 1]), 0.05);
    set("FujiFilm:CropTopLeft", twoInts(2000, 1500), 0.05);
    set("FujiFilm:CropSize", twoInts(4416, 2944), 0.05);
  }
  set("RAF:RawImageAspectRatio", pick(ASPECTS), 0.05);
  set("RAF:RawImageCroppedSize", pick(SIZES), 0.05);
  if (r() < 0.6) {
    set("RAF:RawZoomActive", pick(["No", "Yes", "Yes", "Unknown (2)"]), 0.02);
    set("RAF:RawZoomTopLeft", twoInts(2500, 1700).replace(" ", "x"), 0.05);
    set("RAF:RawZoomSize", twoInts(7728, 5152).replace(" ", "x"), 0.05);
  }
  if (r() < 0.9) d["FujiIFD:VignettingParams"] = "(vorhanden)";
  return d;
}

function randomOpts(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const o = {};
  if (r() < 0.2) o.film = pick(Object.keys(PROFILES));
  if (r() < 0.15) o.neutral = true;
  if (r() < 0.08) o.noProfile = true;
  if (r() < 0.4) o.wb = "recipe";
  if (r() < 0.3) o.tone = "curve";
  if (r() < 0.1) o.noLens = true;
  if (r() < 0.1) o.noCrop = true;
  if (r() < 0.15) o.noAspectCrop = true;
  if (r() < 0.1) o.noDigest = true;
  return o;
}

// Der Kern darf werfen, wenn Python wirft (beide rechnen mit einem Nenner 0); sonst muessen XMP und Hinweise stimmen
function run(d, opts, db) {
  try {
    const r = makeXmp(d, opts, db);
    return { xmp: r.xmp, notes: r.notes, film: r.meta.film, noLook: r.meta.noLook };
  } catch (e) {
    return { error: String(e) };
  }
}

// Erste abweichende Zeile (oder Fehler/Hinweise), damit ein Befund sofort lesbar ist
function firstDiff(js, ref) {
  if (js.error || ref.error) return { js: js.error || "ok", py: ref.error || "ok" };
  const a = js.xmp.split("\n");
  const b = ref.xmp.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return { zeile: i, js: a[i], py: b[i] };
  return { js: JSON.stringify([js.notes, js.film, js.noLook]), py: JSON.stringify([ref.notes, ref.film, ref.noLook]) };
}

const jsonForm = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, jsonish(v)]));

test("Kern gegen Python auf Zufallsangaben", { skip }, () => {
  const r = rng(Number(process.env.F2X_FUZZ_SEED) || 20261104);
  const dbObj = publicLooksJson();
  const dbs = [["Python-artige Datenbank", pyDb(dbObj)], ["Datenbank der Seite", LookDb.withBuiltin()]];
  const N = Number(process.env.F2X_FUZZ_N) || 3000;
  const cases = [];
  for (let i = 0; i < N; i++) {
    const reader = randomDict(r);
    cases.push({ reader, d: jsonForm(reader), opts: randomOpts(r) });
  }
  const py = runPython(cases.map((c) => ({ d: c.d, opts: c.opts })), dbObj);
  assert.equal(py.length, N);
  const seen = { errors: 0, looks: 0, fallback: 0, curve: 0, recipe: 0, crop: 0, bw: 0 };
  const bad = [];
  cases.forEach((c, i) => {
    const ref = py[i];
    if (ref.error) seen.errors++;
    else {
      if (ref.xmp.includes("<crs:Look>")) seen.looks++;
      if (ref.noLook) seen.fallback++;
      if (ref.xmp.includes("ToneCurvePV2012")) seen.curve++;
      if (ref.xmp.includes("crs:Temperature=")) seen.recipe++;
      if (ref.xmp.includes("crs:HasCrop=\"True\"")) seen.crop++;
      if (ref.xmp.includes("SplitToning")) seen.bw++;
    }
    for (const [dbName, db] of dbs) {
      for (const [form, d] of [["ExifTool-Form", c.d], ["Leser-Form", c.reader]]) {
        const js = run(d, c.opts, db);
        const ok = ref.error ? Boolean(js.error) : js.xmp === ref.xmp && JSON.stringify(js.notes) === JSON.stringify(ref.notes)
          && js.film === ref.film && js.noLook === ref.noLook;
        if (!ok) bad.push({ i, dbName, form, opts: c.opts, d: c.reader, ...firstDiff(js, ref) });
      }
    }
  });
  // Die Reihe soll die Zweige auch wirklich treffen
  for (const [k, min] of Object.entries({ looks: 30, fallback: 30, curve: 300, recipe: 100, crop: 300, bw: 100 })) {
    assert.ok(seen[k] >= min, "Zweig " + k + " nur " + seen[k] + " mal getroffen: " + JSON.stringify(seen));
  }
  assert.deepEqual(bad.slice(0, 3), []);
  assert.equal(bad.length, 0, bad.length + " Abweichungen, Faelle " + [...new Set(bad.map((b) => b.i))].slice(0, 20).join(", "));
});
