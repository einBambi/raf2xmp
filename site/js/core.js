// Kern von raf2xmp: aus den gelesenen Kameraangaben (ein Dict im Stil von "exiftool -j -G1") werden die Camera-Raw-
// Einstellungen und die XMP gebaut. Das ist eine Zeile-fuer-Zeile-Uebertragung des Python-Werkzeugs, gleiche Namen,
// gleiche Reihenfolge, gleiche Konstanten. Wer eine Zahl aendert, aendert sie dort und hier.

import { pyRound, pyFixed, pyPlusG, quoteattr, radians, degrees, istr } from "./pyfmt.js";

export const VERSION = "1.1";
export const DB_DEFAULT_MODEL = "X100VI";

// Filmsimulation (Schluessel = normalisierter exiftool-Text) -> Adobe-Profilname
export const PROFILES = {
  "provia": "Camera PROVIA/Standard",
  "velvia": "Camera Velvia/Vivid",
  "astia": "Camera ASTIA/Soft",
  "classic chrome": "Camera CLASSIC CHROME",
  "pro neg hi": "Camera Pro Neg Hi",
  "pro neg std": "Camera Pro Neg Std",
  "classic neg": "Camera CLASSIC Neg",
  "eterna bleach": "Camera BLEACH BYPASS",
  "eterna": "Camera ETERNA/Cinema",
  "nostalgic neg": "Camera NOSTALGIC Neg",
  "reala": "Camera REALA ACE v2",
  "acros": "Camera ACROS",
  "acros ye": "Camera ACROS+Ye Filter",
  "acros r": "Camera ACROS+R Filter",
  "acros g": "Camera ACROS+G Filter",
  "mono": "Camera Monochrome",
  "mono ye": "Camera Monochrome+Ye Filter",
  "mono r": "Camera Monochrome+R Filter",
  "mono g": "Camera Monochrome+G Filter",
  "sepia": "Camera Sepia",
};
const isGrayFilm = (f) => ["acros", "mono"].includes(f.split(" ")[0]);
export const GRAY_PROFILES = new Set(Object.entries(PROFILES).filter(([f]) => isGrayFilm(f)).map(([, n]) => n));

export const ORIENT = new Map([["horizontal", 1], ["rotate 180", 3], ["rotate 90 cw", 6], ["rotate 270 cw", 8]]);

// Naeherungen (alles Schaetzwerte, siehe README)
export const K_SAT = 4.9;
export const K_SAT0 = 7.5;
export const K_CLARITY = 5;
export const SIM_SAT_FIX = new Map([["velvia", 4], ["classic chrome", 4]]);
export const GREEN_SAT = 10;
export const FX_BLUE_LUM = 24;
export const K_TONE_OTHER = 0.5;
export const TONE_FIX = new Map([
  [100, [[0, 0], [12, 18], [26, 35], [40, 47], [52, 57], [72, 73], [93, 91], [120, 117], [152, 151], [180, 179], [206, 204], [230, 231], [240, 247], [248, 254], [255, 255]]],
  [200, [[0, 0], [12, 15], [26, 31], [40, 44], [52, 54], [72, 71], [93, 90], [120, 118], [152, 153], [180, 179], [206, 202], [230, 225], [240, 239], [248, 249], [255, 255]]],
  [400, [[0, 0], [12, 16], [26, 30], [40, 41], [52, 51], [72, 68], [93, 90], [120, 122], [152, 151], [180, 175], [206, 198], [230, 221], [240, 234], [248, 246], [255, 255]]],
]);
export const TONE_FIX_CC = new Map([
  [100, [[0, 0], [12, 16], [26, 33], [40, 45], [52, 56], [72, 72], [93, 90], [120, 116], [152, 149], [180, 176], [206, 201], [230, 229], [240, 244], [248, 252], [255, 255]]],
]);
export const TONE_FIX_BW = new Map([
  [100, [[0, 0], [12, 7], [26, 21], [40, 34], [52, 45], [72, 66], [93, 87], [120, 114], [152, 146], [180, 175], [206, 201], [230, 229], [240, 242], [248, 249], [255, 255]]],
  [200, [[0, 0], [12, 10], [26, 22], [40, 36], [52, 47], [72, 67], [93, 90], [120, 118], [152, 152], [180, 180], [206, 206], [230, 230], [240, 240], [248, 248], [255, 255]]],
]);
export const K_EV_NEG = 0.12;
export const K_EV_POS = 0.09;
export const SHARP_MASK = 45;
export const SHARP_AT = [[-4, 30], [-2, 45], [-1, 60], [0, 85], [4, 130]];
export const SHARP_HIISO = 40;
export const SHARP_MASK_HIISO = 20;
export const SHARP_HIISO_BW = 10;
export const GRAIN = new Map([["weak|large", [20, 25]], ["weak|small", [22, 8]], ["strong|large", [27, 30]], ["strong|small", [20, 12]]]);
export const GRAIN_FREQ = 40;
export const GRAIN_HIISO = 0.7;
export const K_HL = 8, K_WH = 4;
export const K_SH = 8, K_BL = 5;
export const MIRED_PER_STEP = 5.0;
export const TINT_PER_STEP = 3.0;

export const LOOK_SIMS = ["classic neg", "nostalgic neg", "eterna bleach", "sepia"];
export const LOOK_BASE_PROFILE = "Camera PROVIA/Standard";
export const LOOK_VERSION = ["18.7", "15.4"]; // so schreibt Lightroom (Camera Raw 18.7) den Look-Block selbst in die XMP
export const LOOK_NAMES = new Set(LOOK_SIMS.map((f) => PROFILES[f]));
export const HEX32 = /^[0-9A-Fa-f]{32}$/;

// --- kleine Helfer ---------------------------------------------------------------------------------------------------

// Wie num() in Python, mit einer Erweiterung: exiftool schreibt halbe und ganze Blendenwerte manchmal als Bruch ("+1/2"),
// Python liest da nur die 1. Der Bruch wird hier als Bruch gelesen.
export function num(v, dflt = 0.0) {
  if (v === null || v === undefined) return dflt;
  if (typeof v === "number") return v;
  const s = String(v);
  const f = /^\s*([-+]?\d+)\/(\d+)/.exec(s);
  if (f && Number(f[2]) !== 0) return Number(f[1]) / Number(f[2]);
  const m = /^\s*([-+]?\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) : dflt;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Stueckweise linear, ausserhalb konstant
export function lerpTable(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  }
  return ys[ys.length - 1];
}

// Erster vorhandener Schluessel mit Wert (0 zaehlt als Wert, wie in Python)
export function g(d, ...keys) {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(d, k) && d[k] !== null && d[k] !== undefined && d[k] !== "") return d[k];
  }
  return null;
}

// Python "x or y": null, "", 0 gelten als leer
const or = (a, b) => (a ? a : b);

export function norm(s) {
  return String(s).toLowerCase().replace(/\./g, "").replace(/[^a-z0-9 ]/g, " ").trim();
}

export function normModel(s) {
  const t = String(s || "").replace(/^\s*fujifilm\s+/i, "");
  return t.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const sameRect = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const FULL = [0.0, 0.0, 1.0, 1.0];

// --- Filmsimulation, Zuschnitt ---------------------------------------------------------------------------------------

// Gibt [key, bw_filter] zurueck. key null, wenn unbekannt.
export function detectFilm(d) {
  const sat = String(or(g(d, "FujiFilm:Saturation"), ""));
  const s = norm(sat);
  let filt = null;
  if (/\b(red|yellow|green|ye)\b/.test(s)) {
    filt = s.includes("red") ? "r" : s.includes("yellow") || /\bye\b/.test(s) ? "ye" : "g";
  }
  if (s.includes("acros") || s.includes("b w") || s.includes("mono") || s.includes("sepia")) {
    if (s.includes("sepia")) return ["sepia", null];
    if (s.includes("acros")) return ["acros" + (filt ? " " + filt : ""), filt];
    return ["mono" + (filt ? " " + filt : ""), filt];
  }
  const f = norm(or(g(d, "FujiFilm:FilmMode"), ""));
  const table = [
    ["eterna bleach", ["bleach"]],
    ["eterna", ["eterna", "cinema"]],
    ["classic chrome", ["classic chrome"]],
    ["classic neg", ["classic neg"]],
    ["nostalgic neg", ["nostalgic"]],
    ["pro neg hi", ["neg hi"]],
    ["pro neg std", ["neg std"]],
    ["reala", ["reala"]],
    ["velvia", ["velvia", "vivid"]],
    ["astia", ["astia", "soft"]],
    ["provia", ["provia", "standard"]],
  ];
  for (const [key, needles] of table) {
    if (needles.some((n) => f.includes(n))) return [key, null];
  }
  return [null, null];
}

// Zentrierter Ausschnitt fuer Nicht-3:2-Formate, relativ zum Sensorbild
export function aspectRect(d, enabled = true) {
  const ar = String(or(g(d, "RAF:RawImageAspectRatio"), ""));
  if (!enabled) return FULL.slice();
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/.exec(ar);
  if (!m) return FULL.slice();
  const ta = Number(m[1]);
  const tb = Number(m[2]);
  const sz = /^(\d+)x(\d+)/.exec(String(or(g(d, "RAF:RawImageCroppedSize"), "")));
  if (ta <= 0 || tb <= 0 || !sz) return FULL.slice();
  const w = Number(sz[1]);
  const h = Number(sz[2]);
  if (w <= 0 || h <= 0) return FULL.slice();
  const target = ta / tb;
  const cur = w / h;
  if (Math.abs(cur - target) < 0.01) return FULL.slice();
  if (target > cur) {
    const nh = cur / target;
    return [0.0, (1 - nh) / 2, 1.0, (1 + nh) / 2];
  }
  const nw = target / cur;
  return [(1 - nw) / 2, 0.0, (1 + nw) / 2, 1.0];
}

// Ausschnitt des Digital-Tele-Converters im Sensorraster (7728x5152) als Bruchteile, sonst null
export function zoomRect(d) {
  if (String(or(g(d, "RAF:RawZoomActive"), "")).toLowerCase() !== "yes") return null;
  const z1 = String(or(g(d, "RAF:RawZoomTopLeft"), "")).match(/\d+/g) || [];
  const z2 = String(or(g(d, "RAF:RawZoomSize"), "")).match(/\d+/g) || [];
  const full = /^(\d+)x(\d+)/.exec(String(or(g(d, "RAF:RawImageCroppedSize"), "")));
  if (z1.length !== 2 || z2.length !== 2 || !full) return null;
  const fw = Number(full[1]);
  const fh = Number(full[2]);
  if (fw <= 0 || fh <= 0) return null;
  const x = Number(z1[0]) / fw;
  const y = Number(z1[1]) / fh;
  return [x, y, x + Number(z2[0]) / fw, y + Number(z2[1]) / fh];
}

// [left, top, right, bottom] als Bruchteile im angezeigten (gedrehten) Bild oder null
export function computeCrop(d, aspect = true) {
  const base = aspectRect(d, aspect);
  let rect = null;
  let sensorRect = null;
  const flag = num(g(d, "FujiFilm:CropFlag"), 0);
  const tl = String(or(g(d, "FujiFilm:CropTopLeft"), "")).match(/\d+/g) || [];
  const sz = String(or(g(d, "FujiFilm:CropSize"), "")).match(/\d+/g) || [];
  const iw = num(g(d, "ExifIFD:ExifImageWidth"), 0);
  const ih = num(g(d, "ExifIFD:ExifImageHeight"), 0);
  // Digital Tele-Converter: RawZoom steht im Sensorraster (7728x5152) und trifft die JPG-Groesse auf den Pixel.
  // CropTopLeft/CropSize beziehen sich auf das Vorschauraster (4416x2944), das ist ca. 0,6 % zu eng (DTC 2.0).
  const zoom = zoomRect(d);
  if (zoom && sameRect(base, FULL)) sensorRect = zoom;
  if (sensorRect === null) {
    if (flag && tl.length === 2 && sz.length === 2 && iw && ih) {
      const x = Number(tl[0]) / iw;
      const y = Number(tl[1]) / ih;
      const w = Number(sz[0]) / iw;
      const h = Number(sz[1]) / ih;
      rect = [x, y, x + w, y + h];
    } else if (zoom) {
      sensorRect = zoom; // ohne CropFlag gibt es nur das Zoom-Rechteck, und das steht im Sensorraster (nicht im Ausgabebild)
    }
  }
  if (sensorRect === null && rect === null && sameRect(base, FULL)) return null;
  let out;
  if (sensorRect !== null) {
    out = sensorRect;
  } else if (rect === null) {
    out = base;
  } else {
    const bw = base[2] - base[0];
    const bh = base[3] - base[1];
    out = [base[0] + rect[0] * bw, base[1] + rect[1] * bh, base[0] + rect[2] * bw, base[1] + rect[3] * bh];
  }
  const o = ORIENT.get(String(or(g(d, "IFD0:Orientation"), "horizontal")).toLowerCase()) ?? 1;
  let [l, t, r, b] = out;
  if (o === 6) [l, t, r, b] = [1 - b, l, 1 - t, r];
  else if (o === 8) [l, t, r, b] = [t, 1 - r, b, 1 - l];
  else if (o === 3) [l, t, r, b] = [1 - r, 1 - b, 1 - l, 1 - t];
  return [l, t, r, b].map((v) => clamp(v, 0.0, 1.0));
}

// --- Look-Block und Profil-Eintrag -------------------------------------------------------------------------------------

// Der <crs:Look>-Block in der Form, wie ihn Lightroom selbst in die XMP schreibt
export function renderLook(p) {
  return (
    "<crs:Look>\n    <rdf:Description\n     crs:Name=" + quoteattr(p.name) +
    "\n     crs:Amount=\"1\"\n     crs:UUID=" + quoteattr(p.uuid) +
    "\n     crs:SupportsAmount=" + quoteattr(p.amount) +
    "\n     crs:SupportsMonochrome=" + quoteattr(p.mono) +
    "\n     crs:SupportsOutputReferred=" + quoteattr(p.outref) +
    "\n     crs:CameraModelRestriction=" + quoteattr(p.model) +
    ">\n    <crs:Group>\n     <rdf:Alt>\n      <rdf:li xml:lang=\"x-default\">" + p.group.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
    "</rdf:li>\n     </rdf:Alt>\n    </crs:Group>\n    <crs:Parameters\n     crs:Version=" + quoteattr(p.version) +
    "\n     crs:ProcessVersion=" + quoteattr(p.process) +
    "\n     crs:ConvertToGrayscale=" + quoteattr(p.gray) +
    "\n     crs:CameraProfile=" + quoteattr(p.profile) +
    "\n     crs:RGBTable=" + quoteattr(p.table) +
    "/>\n    </rdf:Description>\n   </crs:Look>"
  );
}

export function entryModel(entry) {
  let m = entry.model;
  if (!m && entry.look) {
    const r = /crs:CameraModelRestriction="([^"]*)"/.exec(entry.look);
    m = r ? r[1] : null;
  }
  return m || DB_DEFAULT_MODEL;
}

// {profile, digest?, grayscale, look?, source?} fuer den Profil- oder Look-Namen name und die Kamera model.
// Reihenfolge: Eintrag aus db, der zur Kamera passt (mitgeliefert oder aus den XMPs im Ordner gelernt), sonst nur der Name.
export function profileEntry(db, name, model, film) {
  let e = db.get(name, model);
  if (e && LOOK_SIMS.includes(film) && !e.look) e = null; // ein Look-Name ohne Look-Block gaebe nur das Basisprofil
  if (e && (!model || normModel(entryModel(e)) === normModel(model))) return e;
  if (LOOK_SIMS.includes(film)) return { profile: LOOK_BASE_PROFILE, grayscale: false, source: "fallback" };
  return { profile: name, grayscale: isGrayFilm(film), source: "name" };
}

// --- Einstellungen -----------------------------------------------------------------------------------------------------

export const DEFAULT_OPTS = Object.freeze({
  film: null, neutral: false, noProfile: false, wb: "asshot", tone: "sliders", noLens: false, noCrop: false, noAspectCrop: false, noDigest: false,
});

// Gibt {s, seqs, meta} zurueck. s: crs-Attribute (Text), seqs: crs-Seq-Elemente, beide in Schreibreihenfolge.
export function buildSettings(d0, opts0, db, notes) {
  const opts = { ...DEFAULT_OPTS, ...opts0 };
  let d = d0;
  const s = {};
  const seqs = {};
  let [film] = detectFilm(d);
  if (opts.film) film = opts.film;
  if (opts.neutral) {
    d = { ...d };
    for (const [k, v] of [["Saturation", "0 (normal)"], ["HighlightTone", "0 (normal)"], ["ShadowTone", "0 (normal)"],
      ["DevelopmentDynamicRange", 100], ["Clarity", 0], ["GrainEffectRoughness", "Off"],
      ["ColorChromeEffect", "Off"], ["ColorChromeFXBlue", "Off"], ["NoiseReduction", 0], ["Sharpness", 0]]) {
      d["FujiFilm:" + k] = v;
    }
  }
  const isBw = Boolean(film && isGrayFilm(film));
  const noColor = isBw || film === "sepia";

  // --- Profil -------------------------------------------------------------
  let lookXml = null;
  let noLook = false;
  if (film && !opts.noProfile) {
    const name = PROFILES[film];
    if (name) {
      const entry = profileEntry(db, name, g(d, "IFD0:Model"), film);
      s.CameraProfile = entry.profile;
      if (entry.digest && !opts.noDigest) s.CameraProfileDigest = entry.digest;
      lookXml = entry.look || null;
      if (isBw) s.ConvertToGrayscale = "True"; // nach der Filmsimulation, ein falsch gelernter Eintrag soll kein Farbbild grau machen
      if (entry.source === "name") notes.push("Profil " + name + " nur per Name geschrieben, ohne Digest");
      else if (entry.source === "fallback") {
        noLook = true;
        notes.push("Look " + name + " nicht gefunden, nur das Basisprofil PROVIA geschrieben");
      }
    }
  } else if (!film) {
    notes.push("Filmsimulation unbekannt, kein Profil gesetzt");
  }

  // --- Weissabgleich ------------------------------------------------------
  const wbMode = String(or(g(d, "FujiFilm:WhiteBalance"), ""));
  const ft = String(or(g(d, "FujiFilm:WhiteBalanceFineTune"), "")).match(/[-+]?\d+/g) || [];
  let rShift = 0.0;
  let bShift = 0.0;
  if (ft.length >= 2) {
    rShift = Number(ft[0]) / 20.0;
    bShift = Number(ft[1]) / 20.0;
  }
  if (opts.wb === "recipe" && !isBw) {
    let kelvin = num(g(d, "FujiFilm:ColorTemperature"), 0);
    if (kelvin < 2000 || !wbMode.toLowerCase().includes("kelvin")) {
      // nur Modi mit fester Farbtemperatur, fuer Leuchtstoff, Blitz und Unterwasser gibt es keinen Messwert (bleibt As Shot)
      kelvin = new Map([["daylight", 5500], ["cloudy", 6500], ["incandescent", 2900]]).get(norm(wbMode)) || 0;
    }
    if (kelvin) {
      const mired = 1e6 / kelvin - ((rShift - bShift) / 2.0) * MIRED_PER_STEP;
      if (mired === 0) throw new RangeError("float division by zero");
      s.WhiteBalance = "Custom";
      s.Temperature = istr(pyRound(clamp(1e6 / mired, 2000, 50000)));
      s.Tint = istr(pyRound(clamp(((rShift + bShift) / 2.0) * TINT_PER_STEP, -150, 150)));
    } else {
      s.WhiteBalance = "As Shot";
      s.IncrementalTemperature = istr(pyRound(((-(rShift - bShift) / 2.0) * MIRED_PER_STEP) * 10));
      s.IncrementalTint = istr(pyRound(((rShift + bShift) / 2.0) * TINT_PER_STEP));
      if (wbMode && !(norm(wbMode).startsWith("auto") || norm(wbMode).startsWith("custom"))) {
        notes.push("WB-Modus " + wbMode + " hat hier keine feste Farbtemperatur, es bleibt bei As Shot");
      }
    }
  } else {
    s.WhiteBalance = "As Shot";
    if (rShift || bShift) {
      notes.push("WB-Shift R" + pyPlusG(rShift) + " B" + pyPlusG(bShift) + " steckt bereits in den Kamera-Multiplikatoren (As Shot)");
    }
  }

  // --- Tonkurve (Highlight/Shadow) ---------------------------------------
  const hl = num(g(d, "FujiFilm:HighlightTone"));
  const sh = num(g(d, "FujiFilm:ShadowTone"));
  const dr = num(g(d, "FujiFilm:DevelopmentDynamicRange"), 100);
  const dri = Math.trunc(dr);
  const drHl = new Map([[100, 0], [200, -10], [400, -20]]).get(dri) ?? 0;
  const drSh = new Map([[100, 0], [200, 5], [400, 10]]).get(dri) ?? 0;
  if (opts.tone === "curve") {
    const pts = [[0, 0], [64, Math.trunc(pyRound(64 - sh * 6))], [192, Math.trunc(pyRound(192 + hl * 6))], [255, 255]];
    seqs.ToneCurvePV2012 = pts.map((p) => p[0] + ", " + p[1]);
    s.Highlights2012 = istr(clamp(drHl, -100, 100));
    s.Shadows2012 = istr(clamp(drSh, -100, 100));
  } else {
    s.Highlights2012 = istr(clamp(pyRound(hl * K_HL) + drHl, -100, 100));
    s.Whites2012 = istr(clamp(pyRound(hl * K_WH), -100, 100));
    s.Shadows2012 = istr(clamp(pyRound(-sh * K_SH) + drSh, -100, 100));
    s.Blacks2012 = istr(clamp(pyRound(-sh * K_BL), -100, 100));
    const table = noColor ? TONE_FIX_BW : film === "classic chrome" && TONE_FIX_CC.has(dri) ? TONE_FIX_CC : TONE_FIX;
    const fix = table.get(dri);
    if (fix && !opts.neutral) {
      const sure = ["classic neg", "classic chrome", "mono ye"].includes(film); // nur dort gegen Kamera-JPGs gemessen
      const strength = sure ? 1.0 : K_TONE_OTHER;
      seqs.ToneCurvePV2012 = fix.map(([x, y]) => x + ", " + pyRound(x + (y - x) * strength));
      if (!noColor) {
        const ev = num(g(d, "ExifIFD:ExposureCompensation"));
        const expo = ev < 0 ? K_EV_NEG * Math.sqrt(-ev) : K_EV_POS * ev;
        if (expo > 0.02) s.Exposure2012 = pyFixed(Math.min(expo, 1.5), 2);
      }
    }
  }

  // --- Farbe, Clarity, Schaerfe, Rauschen ----------------------------------
  const satRaw = String(or(g(d, "FujiFilm:Saturation"), ""));
  const color = /^\s*[-+]?\d/.test(satRaw) ? num(satRaw) : 0.0;
  if (!noColor) {
    s.Saturation = istr(clamp(pyRound(K_SAT0 + color * K_SAT + (opts.neutral ? 0 : SIM_SAT_FIX.get(film) ?? 0)), -100, 100));
  }
  const clarity = num(g(d, "FujiFilm:Clarity"));
  s.Clarity2012 = istr(clamp(pyRound(clarity * K_CLARITY), -100, 100));
  const nr = num(g(d, "FujiFilm:NoiseReduction"));
  const smooth = Math.trunc(clamp(pyRound((nr + 4) * 5), 0, 100));
  const sharp = num(g(d, "FujiFilm:Sharpness"));
  let sharpLr = Number(lerpTable(sharp, SHARP_AT.map((p) => p[0]), SHARP_AT.map((p) => p[1])));
  let mask = SHARP_MASK;
  if (num(g(d, "ExifIFD:ISO"), 0) >= 3200) {
    if (noColor) {
      sharpLr += SHARP_HIISO_BW;
    } else {
      const w = 1.0 - Math.min(1.0, smooth / 25.0);
      sharpLr += SHARP_HIISO * w;
      mask = pyRound(SHARP_MASK + (SHARP_MASK_HIISO - SHARP_MASK) * w);
    }
  }
  s.Sharpness = istr(clamp(pyRound(sharpLr), 0, 150));
  s.SharpenEdgeMasking = String(mask);
  s.LuminanceSmoothing = String(smooth);
  s.ColorNoiseReduction = "25";

  // --- Color Chrome Effect / FX Blue -------------------------------------
  const lvl = new Map([["off", 0], ["weak", 1], ["strong", 2]]);
  const cc = lvl.get(norm(or(g(d, "FujiFilm:ColorChromeEffect"), "off"))) ?? 0;
  const fx = lvl.get(norm(or(g(d, "FujiFilm:ColorChromeFXBlue"), "off"))) ?? 0;
  if (!noColor) {
    const lum = { Red: 0, Orange: 0, Yellow: 0, Green: 0, Aqua: 0, Blue: 0, Purple: 0, Magenta: 0 };
    const sat = { ...lum };
    for (const k of Object.keys(lum)) {
      lum[k] -= cc * 4;
      sat[k] += cc * 2;
    }
    sat.Green += GREEN_SAT;
    // FX Blue betont Blau/Aqua/Lila: dunkler und satter (nur Blau ist gemessen, Aqua und Lila sind geschaetzt)
    for (const [k, f, dark] of [["Blue", 1.0, FX_BLUE_LUM], ["Aqua", 0.6, 6], ["Purple", 0.5, 6]]) {
      lum[k] -= pyRound(fx * dark * f);
      sat[k] += pyRound(fx * 6 * f);
    }
    for (const k of Object.keys(lum)) {
      if (lum[k]) s["LuminanceAdjustment" + k] = String(lum[k]);
      if (sat[k]) s["SaturationAdjustment" + k] = String(sat[k]);
    }
  }

  // --- Grain ----------------------------------------------------------------
  const rough = norm(or(g(d, "FujiFilm:GrainEffectRoughness"), "off"));
  const gsize = norm(or(g(d, "FujiFilm:GrainEffectSize"), "small"));
  if (rough === "weak" || rough === "strong") {
    let [amount, size] = GRAIN.get(rough + "|" + (gsize === "large" ? "large" : "small"));
    if (num(g(d, "ExifIFD:ISO"), 0) >= 3200) amount = amount * GRAIN_HIISO;
    s.GrainAmount = String(pyRound(amount));
    s.GrainSize = String(size);
    s.GrainFrequency = String(GRAIN_FREQ);
  } else {
    s.GrainAmount = "0";
  }

  // --- S/W-Tonung ---------------------------------------------------------
  if (isBw) {
    // Warm/Kuehl (positiv = warm) und Magenta/Gruen (positiv = gruen, so steht es in der exiftool-Doku, an der Kamera nicht
    // nachgemessen) werden als Vektor im Farbkreis addiert, damit der eine Anteil den anderen nicht verdraengt.
    let vx = 0.0;
    let vy = 0.0;
    for (const [val, huePos, hueNeg] of [[num(g(d, "FujiFilm:BWAdjustment")), 40, 220], [num(g(d, "FujiFilm:BWMagentaGreen")), 120, 320]]) {
      if (val) {
        const ang = radians(val > 0 ? huePos : hueNeg);
        vx += Math.abs(val) * 2 * Math.cos(ang);
        vy += Math.abs(val) * 2 * Math.sin(ang);
      }
    }
    const amount = Math.hypot(vx, vy);
    if (amount >= 0.5) {
      const hue = pyRound(degrees(Math.atan2(vy, vx)));
      s.SplitToningHighlightHue = String(((hue % 360) + 360) % 360);
      s.SplitToningHighlightSaturation = String(Math.min(100, pyRound(amount)));
    }
  }

  // --- Objektivkorrektur ----------------------------------------------------
  // Die Kamera rechnet Randabdunklung (und laterale CA) mit den Tabellen aus der RAF heraus. Ohne diese Schluessel
  // laesst Lightroom beides stehen: die Ecken sind dann bis ca. 1 EV dunkler als im Kamera-JPG.
  if (!opts.noLens && g(d, "FujiIFD:VignettingParams")) {
    Object.assign(s, {
      AutoLateralCA: "1", LensProfileEnable: "1", LensProfileSetup: "LensDefaults",
      LensProfileName: "Camera Settings", LensProfileIsEmbedded: "True",
      LensProfileDistortionScale: "100", LensProfileVignettingScale: "100",
      LensManualDistortionAmount: "0", VignetteAmount: "0",
    });
  }

  // --- Crop -------------------------------------------------------------------
  const crop = opts.noCrop ? null : computeCrop(d, !opts.noAspectCrop);
  if (crop) {
    const [l, t, r, b] = crop;
    Object.assign(s, {
      CropLeft: pyFixed(l, 6), CropTop: pyFixed(t, 6), CropRight: pyFixed(r, 6), CropBottom: pyFixed(b, 6),
      CropAngle: "0", CropConstrainToWarp: "0", HasCrop: "True",
    });
  } else {
    s.HasCrop = "False";
  }

  return { s, seqs, meta: { film, crop, look: lookXml, noLook } };
}

export function renderXmp(s, seqs, lookXml = null) {
  const attrs = { Version: "17.0", ProcessVersion: "15.4" };
  Object.assign(attrs, s);
  Object.assign(attrs, { HasSettings: "True", AlreadyApplied: "False" });
  const lines = [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="raf2xmp">',
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '  <rdf:Description rdf:about=""',
    '   xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"',
  ];
  for (const [k, v] of Object.entries(attrs)) lines.push("   crs:" + k + "=" + quoteattr(String(v)));
  lines[lines.length - 1] += ">";
  for (const [k, items] of Object.entries(seqs)) {
    lines.push("   <crs:" + k + "><rdf:Seq>");
    for (const i of items) lines.push("    <rdf:li>" + i + "</rdf:li>");
    lines.push("   </rdf:Seq></crs:" + k + ">");
  }
  if (lookXml) lines.push("   " + lookXml);
  lines.push("  </rdf:Description>");
  lines.push(" </rdf:RDF>", "</x:xmpmeta>", '<?xpacket end="w"?>');
  return lines.join("\n") + "\n";
}

// Bequem: Kameraangaben rein, {xmp, s, meta, notes} raus
export function makeXmp(d, opts, db) {
  const notes = [];
  const { s, seqs, meta } = buildSettings(d, opts, db, notes);
  return { xmp: renderXmp(s, seqs, meta.look), s, meta, notes };
}
