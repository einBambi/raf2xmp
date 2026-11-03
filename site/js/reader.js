// Liest aus einem Fujifilm-RAF genau die Angaben, die der Kern braucht, und gibt sie als Dict im Stil von "exiftool -j -G1"
// zurueck (gleiche Schluessel, gleiche Textformen). Gelesen werden nur ein paar kleine Ausschnitte der Datei (Kopf, Exif-Teil
// der eingebetteten Vorschau, RAF-Verzeichnis, Fuji-IFD), nie die Rohdaten. Die Wertetabellen folgen der oeffentlichen
// Beschreibung der Fuji-Herstellernotiz; geprueft wird gegen ExifTool (siehe test/).

const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
const MAX_SEGMENT = 65535 + 16;

async function slice(blob, start, len) {
  if (start < 0 || start >= blob.size || len <= 0) return new Uint8Array(0);
  return new Uint8Array(await blob.slice(start, Math.min(blob.size, start + len)).arrayBuffer());
}

const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
const ascii = (u8, from, to) => String.fromCharCode(...u8.subarray(from, to));

// --- Kopfdaten und Vollstaendigkeit --------------------------------------------------------------------------------------

export const HEADER_BYTES = 112;

// [erwartete Groesse, tatsaechliche Groesse], wenn die Datei kuerzer ist als ihr Kopf angibt, sonst null (abgebrochene Kopie)
export function rafIncomplete(head, size) {
  if (head.length < 15 || ascii(head, 0, 15) !== "FUJIFILMCCD-RAW") return null;
  if (head.length < HEADER_BYTES) return [HEADER_BYTES, size];
  const dv = view(head);
  let end = 0;
  for (const off of [0x54, 0x5c, 0x64]) end = Math.max(end, dv.getUint32(off) + dv.getUint32(off + 4)); // JPEG, RAF-Verzeichnis, Rohdaten
  return size < end ? [end, size] : null;
}

// --- IFD-Lesen -------------------------------------------------------------------------------------------------------------

// Eintraege eines IFD: Map tag -> {type, count, at, size}; at ist der Ort der Werte im Puffer (base = Bezugspunkt der Offsets)
function readIfd(dv, off, le, base) {
  const out = new Map();
  if (off < 0 || off + 2 > dv.byteLength) return out;
  const n = dv.getUint16(off, le);
  for (let i = 0; i < n; i++) {
    const p = off + 2 + 12 * i;
    if (p + 12 > dv.byteLength) break;
    const tag = dv.getUint16(p, le);
    const type = dv.getUint16(p + 2, le);
    const count = dv.getUint32(p + 4, le);
    const unit = TYPE_SIZE[type];
    if (!unit) continue;
    const size = unit * count;
    const at = size <= 4 ? p + 8 : base + dv.getUint32(p + 8, le);
    if (at < 0 || at + size > dv.byteLength) continue;
    if (!out.has(tag)) out.set(tag, { type, count, at, size });
  }
  return out;
}

function readNum(dv, at, type, le) {
  switch (type) {
    case 1: case 2: case 7: return dv.getUint8(at);
    case 6: return dv.getInt8(at);
    case 3: return dv.getUint16(at, le);
    case 8: return dv.getInt16(at, le);
    case 4: case 13: return dv.getUint32(at, le);
    case 9: return dv.getInt32(at, le);
    default: return null;
  }
}

function readStr(dv, e) {
  const u8 = new Uint8Array(dv.buffer, dv.byteOffset + e.at, e.size);
  const z = u8.indexOf(0);
  return new TextDecoder("utf-8").decode(z < 0 ? u8 : u8.subarray(0, z)).replace(/\s+$/, "");
}

// Rational wie ExifTool: auf 10 gueltige Stellen gerundet, Nenner 0 gibt "inf" (oder "undef" bei 0/0)
function readRational(dv, at, signed, le) {
  const n = signed ? dv.getInt32(at, le) : dv.getUint32(at, le);
  const d = signed ? dv.getInt32(at + 4, le) : dv.getUint32(at + 4, le);
  if (!d) return n === 0 ? 0 : n > 0 ? Infinity : -Infinity;
  return Number((n / d).toPrecision(10));
}

// Belichtungskorrektur als Text in der Schreibweise von ExifTool: "0", "+1", "-1/2", "+2/3", sonst drei Stellen ("+0.67").
// Eigene Umsetzung. Die Ausgabe soll der von ExifTool entsprechen, das pruefen die Tests (reader-synth.test.js).
export function printFraction(v) {
  if (!Number.isFinite(v)) return v < 0 ? "-Inf" : "+Inf";
  const a = Math.abs(v) * 1.00001; // kleiner Zuschlag, damit ein Wert knapp unter dem Vielfachen noch dazu zaehlt
  if (a === 0) return "0";
  const sign = v < 0 ? "-" : "+";
  for (const den of [1, 2, 3]) {
    const t = a * den;
    const n = Math.floor(t);
    // ganze Zahl, Halbe oder Drittel: t darf hoechstens 0,1 % ueber dem Vielfachen n liegen
    if (n > 0 && t - n < 0.001 * t) return sign + n + (den > 1 ? "/" + den : "");
  }
  return sign + String(Number(a.toPrecision(3)));
}

const ORIENTATION = {
  1: "Horizontal (normal)", 2: "Mirror horizontal", 3: "Rotate 180", 4: "Mirror vertical",
  5: "Mirror horizontal and rotate 270 CW", 6: "Rotate 90 CW", 7: "Mirror horizontal and rotate 90 CW", 8: "Rotate 270 CW",
};

// --- Fuji-Herstellernotiz ----------------------------------------------------------------------------------------------

const hex = (v) => "Unknown (0x" + (v >>> 0).toString(16) + ")";
const dec = (v) => "Unknown (" + v + ")";
const table = (t, fmt) => (v) => (Object.prototype.hasOwnProperty.call(t, v) ? t[v] : fmt(v));

const SHARPNESS = { 0x00: "-4 (softest)", 0x01: "-3 (very soft)", 0x02: "-2 (soft)", 0x03: "0 (normal)", 0x04: "+2 (hard)", 0x05: "+3 (very hard)",
  0x06: "+4 (hardest)", 0x82: "-1 (medium soft)", 0x84: "+1 (medium hard)", 0x8000: "Film Simulation", 0xffff: "n/a" };
const WHITE_BALANCE = { 0x0: "Auto", 0x1: "Auto (white priority)", 0x2: "Auto (ambiance priority)", 0x100: "Daylight", 0x200: "Cloudy",
  0x300: "Daylight Fluorescent", 0x301: "Day White Fluorescent", 0x302: "White Fluorescent", 0x303: "Warm White Fluorescent",
  0x304: "Living Room Warm White Fluorescent", 0x400: "Incandescent", 0x500: "Flash", 0x600: "Underwater", 0xf00: "Custom", 0xf01: "Custom2",
  0xf02: "Custom3", 0xf03: "Custom4", 0xf04: "Custom5", 0xff0: "Kelvin" };
const SATURATION = { 0x0: "0 (normal)", 0x80: "+1 (medium high)", 0x100: "+2 (high)", 0xc0: "+3 (very high)", 0xe0: "+4 (highest)",
  0x180: "-1 (medium low)", 0x200: "Low", 0x300: "None (B&W)", 0x301: "B&W Red Filter", 0x302: "B&W Yellow Filter", 0x303: "B&W Green Filter",
  0x310: "B&W Sepia", 0x400: "-2 (low)", 0x4c0: "-3 (very low)", 0x4e0: "-4 (lowest)", 0x500: "Acros", 0x501: "Acros Red Filter",
  0x502: "Acros Yellow Filter", 0x503: "Acros Green Filter", 0x8000: "Film Simulation" };
const NOISE_OLD = { 0x40: "Low", 0x80: "Normal" }; // 0x100 ("n/a") laesst ExifTool weg
const NOISE = { 0x000: "0 (normal)", 0x100: "+2 (strong)", 0x180: "+1 (medium strong)", 0x1c0: "+3 (very strong)", 0x1e0: "+4 (strongest)",
  0x200: "-2 (weak)", 0x280: "-1 (medium weak)", 0x2c0: "-3 (very weak)", 0x2e0: "-4 (weakest)" };
const TONE = { "-64": "+4 (hardest)", "-48": "+3 (very hard)", "-32": "+2 (hard)", "-16": "+1 (medium hard)", "0": "0 (normal)", "16": "-1 (medium soft)", "32": "-2 (soft)" };
const OFF_WEAK_STRONG = { 0: "Off", 32: "Weak", 64: "Strong" };
const GRAIN_SIZE = { 0: "Off", 16: "Small", 32: "Large" };
const FILM_MODE = { 0x000: "F0/Standard (Provia)", 0x100: "F1/Studio Portrait", 0x110: "F1a/Studio Portrait Enhanced Saturation",
  0x120: "F1b/Studio Portrait Smooth Skin Tone (Astia)", 0x130: "F1c/Studio Portrait Increased Sharpness", 0x200: "F2/Fujichrome (Velvia)",
  0x300: "F3/Studio Portrait Ex", 0x400: "F4/Velvia", 0x500: "Pro Neg. Std", 0x501: "Pro Neg. Hi", 0x600: "Classic Chrome", 0x700: "Eterna",
  0x800: "Classic Negative", 0x900: "Bleach Bypass", 0xa00: "Nostalgic Neg", 0xb00: "Reala ACE" };

const sharpness = table(SHARPNESS, hex);
const whiteBalance = table(WHITE_BALANCE, hex);
const saturation = table(SATURATION, hex);
const noise = table(NOISE, hex);
const noiseOld = table(NOISE_OLD, hex);
const offWeakStrong = table(OFF_WEAK_STRONG, dec);
const grainSize = table(GRAIN_SIZE, dec);
const filmMode = table(FILM_MODE, hex);
const tone = (v) => (Object.prototype.hasOwnProperty.call(TONE, v) ? TONE[v] : -v / 16);
const clarity = (v) => (v % 1000 === 0 && v >= -5000 && v <= 5000 ? String(v / 1000) : dec(v));
// ExifTool liest diese beiden Tags als vorzeichenbehaftete Bytes, egal wie sie abgelegt sind (alle Bytes des Eintrags, mit Leerzeichen getrennt)
const int8s = (dv, e) => Array.from({ length: e.size }, (_, i) => dv.getInt8(e.at + i)).join(" ");
const bwTone = (s) => (Number.parseInt(s, 10) > 0 ? "+" + s : s);

// Tag -> [Name, Umsetzung(Entry) -> Wert oder undefined]. one: erster Zahlenwert in der Form des Eintrags
function fujiTags(dv, le) {
  const one = (e) => readNum(dv, e.at, e.type, le);
  const first = (fn) => (e) => {
    const v = one(e);
    return v === null ? undefined : fn(v);
  };
  const pair = (e, fmt) => {
    if (e.count < 2) return undefined;
    const u = TYPE_SIZE[e.type];
    const a = readNum(dv, e.at, e.type, le);
    const b = readNum(dv, e.at + u, e.type, le);
    return a === null || b === null ? undefined : fmt(a, b);
  };
  return new Map([
    [0x1001, ["Sharpness", first(sharpness)]],
    [0x1002, ["WhiteBalance", first(whiteBalance)]],
    [0x1003, ["Saturation", first(saturation)]],
    [0x1005, ["ColorTemperature", first((v) => v)]],
    [0x100a, ["WhiteBalanceFineTune", (e) => pair(e, (a, b) => "Red " + (a >= 0 ? "+" : "") + a + ", Blue " + (b >= 0 ? "+" : "") + b)]],
    [0x100b, ["NoiseReduction", first((v) => (v === 0x100 ? undefined : noiseOld(v)))]],
    [0x100e, ["NoiseReduction", first(noise)]],
    [0x100f, ["Clarity", first(clarity)]],
    [0x1040, ["ShadowTone", first(tone)]],
    [0x1041, ["HighlightTone", first(tone)]],
    [0x1047, ["GrainEffectRoughness", first(offWeakStrong)]],
    [0x1048, ["ColorChromeEffect", first(offWeakStrong)]],
    [0x1049, ["BWAdjustment", (e) => bwTone(int8s(dv, e))]],
    [0x104b, ["BWMagentaGreen", (e) => bwTone(int8s(dv, e))]],
    [0x104c, ["GrainEffectSize", first(grainSize)]],
    [0x104e, ["ColorChromeFXBlue", first(offWeakStrong)]],
    [0x1051, ["CropFlag", first((v) => v)]],
    [0x1052, ["CropTopLeft", (e) => pair(e, (a, b) => a + " " + b)]],
    [0x1053, ["CropSize", (e) => pair(e, (a, b) => a + " " + b)]],
    [0x1401, ["FilmMode", first(filmMode)]],
    [0x1403, ["DevelopmentDynamicRange", first((v) => v)]],
  ]);
}

function readMakerNote(tiff, dv, le, e, d) {
  if (e.size < 14 || ascii(tiff, e.at, e.at + 8) !== "FUJIFILM") return false;
  const mn = new DataView(tiff.buffer, tiff.byteOffset + e.at, e.size);
  const tags = fujiTags(mn, true);
  const n = mn.byteLength >= 14 ? mn.getUint16(12, true) : 0;
  for (let i = 0; i < n; i++) {
    const p = 14 + 12 * i;
    if (p + 12 > mn.byteLength) break;
    const tag = mn.getUint16(p, true);
    const type = mn.getUint16(p + 2, true);
    const count = mn.getUint32(p + 4, true);
    const unit = TYPE_SIZE[type];
    const spec = tags.get(tag);
    if (!unit || !spec) continue;
    const size = unit * count;
    const at = size <= 4 ? p + 8 : mn.getUint32(p + 8, true);
    if (count < 1 || at + size > mn.byteLength) continue;
    const v = spec[1]({ type, count, at, size });
    if (v !== undefined) d["FujiFilm:" + spec[0]] = v;
  }
  return true;
}

// --- Exif-Teil der Vorschau -------------------------------------------------------------------------------------------------

async function findExif(blob, jpos, jlen) {
  const end = Math.min(blob.size, jpos + jlen);
  let p = jpos + 2;
  const soi = await slice(blob, jpos, 2);
  if (soi.length < 2 || soi[0] !== 0xff || soi[1] !== 0xd8) return null;
  for (let guard = 0; guard < 64 && p + 4 <= end; guard++) {
    const h = await slice(blob, p, 4);
    if (h.length < 4 || h[0] !== 0xff) return null;
    const m = h[1];
    if (m === 0xff) { p += 1; continue; }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
    if (m === 0xd9 || m === 0xda) return null;
    const len = (h[2] << 8) | h[3];
    if (len < 2) return null;
    if (m === 0xe1 && len <= MAX_SEGMENT) {
      const seg = await slice(blob, p + 4, len - 2);
      if (seg.length >= 6 && ascii(seg, 0, 4) === "Exif" && seg[4] === 0 && seg[5] === 0) return seg.subarray(6);
    }
    p += 2 + len;
  }
  return null;
}

function readExif(tiff, d) {
  if (tiff.length < 8 || (tiff[0] !== 0x49 && tiff[0] !== 0x4d) || tiff[1] !== tiff[0]) return false;
  const le = tiff[0] === 0x49;
  const dv = view(tiff);
  if (dv.getUint16(2, le) !== 42) return false;
  const ifd0 = readIfd(dv, dv.getUint32(4, le), le, 0);
  const text = (tag, key) => {
    const e = ifd0.get(tag);
    if (e && e.type === 2) d[key] = readStr(dv, e);
  };
  text(0x010f, "IFD0:Make");
  text(0x0110, "IFD0:Model");
  const o = ifd0.get(0x0112);
  if (o && (o.type === 3 || o.type === 8)) {
    const v = readNum(dv, o.at, o.type, le);
    d["IFD0:Orientation"] = ORIENTATION[v] || dec(v);
  }
  const sub = ifd0.get(0x8769);
  if (!sub) return true;
  const exifIfd = readIfd(dv, readNum(dv, sub.at, sub.type, le), le, 0);
  const iso = exifIfd.get(0x8827);
  if (iso && iso.count >= 1) {
    const vals = [];
    for (let i = 0; i < iso.count; i++) vals.push(readNum(dv, iso.at + i * TYPE_SIZE[iso.type], iso.type, le));
    if (vals.every((v) => v !== null)) d["ExifIFD:ISO"] = vals.length === 1 ? vals[0] : vals.join(" ");
  }
  const ev = exifIfd.get(0x9204);
  if (ev && ev.type === 10) {
    d["ExifIFD:ExposureCompensation"] = printFraction(readRational(dv, ev.at, true, le));
  }
  for (const [tag, key] of [[0xa002, "ExifIFD:ExifImageWidth"], [0xa003, "ExifIFD:ExifImageHeight"]]) {
    const e = exifIfd.get(tag);
    if (e && (e.type === 3 || e.type === 4)) d[key] = readNum(dv, e.at, e.type, le);
  }
  const mk = exifIfd.get(0x927c);
  if (mk) readMakerNote(tiff, dv, le, mk, d);
  return true;
}

// --- RAF-Verzeichnis und Fuji-IFD ---------------------------------------------------------------------------------------------

// Zwei 16-Bit-Zahlen, Reihenfolge wie ExifTool sie ausgibt (Breite zuerst), getrennt durch sep
function pairBe(dv, at, sep) {
  return dv.getUint16(at + 2) + sep + dv.getUint16(at);
}

function readRafDir(buf, d) {
  if (buf.length < 4) return false;
  const dv = view(buf);
  const n = dv.getUint32(0);
  if (n >= 256) return false;
  let p = 4;
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    if (p + 4 > buf.length) return false;
    const tag = dv.getUint16(p);
    const len = dv.getUint16(p + 2);
    const at = p + 4;
    if (at + len > buf.length) return false;
    p = at + len;
    if (seen.has(tag) || len < 4) continue;
    seen.add(tag);
    if (tag === 0x111) d["RAF:RawImageCroppedSize"] = pairBe(dv, at, "x");
    else if (tag === 0x115) d["RAF:RawImageAspectRatio"] = pairBe(dv, at, ":");
    else if (tag === 0x117) { const v = dv.getUint32(at); d["RAF:RawZoomActive"] = v === 0 ? "No" : v === 1 ? "Yes" : dec(v); }
    else if (tag === 0x118) d["RAF:RawZoomTopLeft"] = pairBe(dv, at, "x");
    else if (tag === 0x119) d["RAF:RawZoomSize"] = pairBe(dv, at, "x");
  }
  return true;
}

function readFujiIfd(buf, d) {
  if (buf.length < 8 || (buf[0] !== 0x49 && buf[0] !== 0x4d) || buf[1] !== buf[0]) return false;
  const le = buf[0] === 0x49;
  const dv = view(buf);
  if (dv.getUint16(2, le) !== 42) return false;
  const top = readIfd(dv, dv.getUint32(4, le), le, 0);
  let found = top.has(0xf010);
  const sub = top.get(0xf000);
  if (sub && (sub.type === 4 || sub.type === 13)) {
    found = readIfd(dv, dv.getUint32(sub.at, le), le, 0).has(0xf010) || found;
  }
  if (found) d["FujiIFD:VignettingParams"] = "(vorhanden)"; // nur das Vorhandensein zaehlt, die Tabelle selbst braucht der Kern nicht
  return true;
}

// --- Eingang ------------------------------------------------------------------------------------------------------------------------

// {status: "ok" | "skip" | "error", message?, d, warnings}. "ok" heisst nur: Aufbau gelesen. Ob Fuji-Angaben drinstehen, prueft der Aufrufer.
export async function readRaf(blob) {
  const d = {};
  const warnings = [];
  const head = await slice(blob, 0, 0x70);
  if (head.length < 0x70 || ascii(head, 0, 8) !== "FUJIFILM") return { status: "skip", message: "kein Fujifilm-RAF", d, warnings };
  d["File:FileType"] = "RAF";
  const hv = view(head);
  const [jpos, jlen, rpos, rlen, cpos] = [0x54, 0x58, 0x5c, 0x60, 0x64].map((o) => hv.getUint32(o));
  if (jpos & 0x8000) return { status: "skip", message: "kein Fujifilm-RAF", d, warnings };
  if (jpos) {
    const tiff = await findExif(blob, jpos, jlen);
    if (!tiff || !readExif(tiff, d)) warnings.push("Exif-Teil der Vorschau nicht lesbar");
  }
  if (rpos) {
    if (!readRafDir(await slice(blob, rpos, Math.min(rlen || 8192, 8192)), d)) warnings.push("RAF-Verzeichnis nicht lesbar");
  }
  if (cpos) readFujiIfd(await slice(blob, cpos, 2048), d);
  return { status: "ok", d, warnings };
}
