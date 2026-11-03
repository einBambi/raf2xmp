// Gemeinsame Hilfen der Tests: Python-Vergleichsstelle aufrufen, Look-Datenbank nach Python-Art, Pfade.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(HERE);
export const TOOL = process.env.F2X_TOOL || path.join(ROOT, "..", "fuji2xmp", "fuji2xmp.py");
export const PYTHON = process.env.F2X_PYTHON || "python3";

export const toolAvailable = fs.existsSync(TOOL);

export const publicLooksJson = () => JSON.parse(fs.readFileSync(path.join(HERE, "data", "looks-public.json"), "utf8"));

// Datenbank wie die Python-Fassung: ein Eintrag je Name, die Kamera pruefen core.js und Python gleich
export function pyDb(obj) {
  return { get: (name) => (Object.prototype.hasOwnProperty.call(obj, name) ? obj[name] : null) };
}

// Faelle durch das Python-Werkzeug schicken: cases = [{d, opts}], db = Objekt im profiles.json-Stil
export function runPython(cases, db) {
  const out = execFileSync(PYTHON, ["-I", path.join(HERE, "pyref.py"), TOOL], {
    input: JSON.stringify({ cases, db }),
    maxBuffer: 1 << 30,
    encoding: "utf8",
    timeout: 120000, // ein haengender Vergleichsprozess soll als Fehler enden, nicht den ganzen Lauf anhalten
    killSignal: "SIGKILL",
    stdio: ["pipe", "pipe", "ignore"], // die Warnungen des Werkzeugs (Look nicht gefunden) brauchen wir hier nicht
  });
  return JSON.parse(out);
}

// raf_incomplete des Python-Werkzeugs fuer eine Liste von Pfaden
export function pyIncomplete(paths) {
  const out = execFileSync(PYTHON, ["-I", path.join(HERE, "pyref.py"), TOOL], {
    input: JSON.stringify({ incomplete: paths }),
    encoding: "utf8",
    timeout: 120000,
    killSignal: "SIGKILL",
  });
  return JSON.parse(out);
}

// Alle Schluessel, die der Kern aus den Kameraangaben liest (plus Hersteller und Dateityp)
export const USED_KEYS = [
  "File:FileType", "IFD0:Make", "IFD0:Model", "IFD0:Orientation", "ExifIFD:ISO", "ExifIFD:ExposureCompensation",
  "ExifIFD:ExifImageWidth", "ExifIFD:ExifImageHeight",
  "FujiFilm:Saturation", "FujiFilm:FilmMode", "FujiFilm:WhiteBalance", "FujiFilm:WhiteBalanceFineTune", "FujiFilm:ColorTemperature",
  "FujiFilm:HighlightTone", "FujiFilm:ShadowTone", "FujiFilm:DevelopmentDynamicRange", "FujiFilm:Clarity", "FujiFilm:NoiseReduction",
  "FujiFilm:Sharpness", "FujiFilm:ColorChromeEffect", "FujiFilm:ColorChromeFXBlue", "FujiFilm:GrainEffectRoughness",
  "FujiFilm:GrainEffectSize", "FujiFilm:BWAdjustment", "FujiFilm:BWMagentaGreen", "FujiFilm:CropFlag", "FujiFilm:CropTopLeft",
  "FujiFilm:CropSize",
  "RAF:RawImageAspectRatio", "RAF:RawImageCroppedSize", "RAF:RawZoomActive", "RAF:RawZoomTopLeft", "RAF:RawZoomSize",
  "FujiIFD:VignettingParams",
];

// So macht exiftool -j aus einem Text eine Zahl: nur solche, die ohne Vorzeichen "+" und ohne fuehrende Null geschrieben sind
export function jsonish(v) {
  if (typeof v === "string" && /^-?(\d|[1-9]\d{1,14})(\.\d{1,16})?(e[-+]?\d{1,3})?$/i.test(v)) return Number(v);
  return v;
}

// Kleiner Zufallsgenerator mit festem Startwert (mulberry32), damit jede Testreihe jedes Mal gleich ausfaellt
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
