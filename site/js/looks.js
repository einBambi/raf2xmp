// Profil- und Look-Kennungen. Mitgeliefert sind nur die Kennungen der vier Fuji-Looks (siehe looks-data.js). Alles Weitere
// lernt die Seite aus XMPs, die Lightroom neben die RAFs geschrieben hat, und zwar nur im Speicher fuer diesen Lauf.

import { LOOKS } from "./looks-data.js";
import { PROFILES, GRAY_PROFILES, LOOK_NAMES, LOOK_VERSION, HEX32, renderLook, normModel, entryModel } from "./core.js";

// Eintraege je Kamera und Name. get() liefert zuerst Gelerntes, dann Mitgeliefertes (wie in Python: gelernt vor mitgeliefert).
export class LookDb {
  constructor() {
    this.builtin = new Map();
    this.learned = new Map();
  }

  static withBuiltin(rows = LOOKS) {
    const db = new LookDb();
    for (const p of rows) {
      const look = renderLook({ ...p, version: LOOK_VERSION[0], process: LOOK_VERSION[1] });
      db.#put(db.builtin, p.model, p.name, { profile: p.profile, grayscale: p.gray === "True", model: p.model, look });
    }
    return db;
  }

  #put(map, model, name, entry) {
    const k = normModel(model);
    if (!map.has(k)) map.set(k, new Map());
    map.get(k).set(name, entry);
  }

  learn(name, entry) {
    this.#put(this.learned, entryModel(entry), name, entry);
  }

  get(name, model) {
    if (model) {
      const k = normModel(model);
      return this.learned.get(k)?.get(name) ?? this.builtin.get(k)?.get(name) ?? null;
    }
    for (const m of [this.learned, this.builtin]) {
      for (const byName of m.values()) if (byName.has(name)) return byName.get(name);
    }
    return null;
  }

  // Kameras, fuer die alle vier Looks vorliegen
  hasLooksFor(model) {
    const k = normModel(model);
    return [...LOOK_NAMES].every((n) => this.learned.get(k)?.has(n) || this.builtin.get(k)?.has(n));
  }
}

// (Name, Eintrag) aus dem Text einer von Lightroom geschriebenen XMP, sonst null. Name ist der Profilname, bei einem Look dessen Name.
export function xmpProfileEntry(t) {
  const prof = /^\s*crs:CameraProfile="([^"]*)"/m.exec(t);
  const dig = /^\s*crs:CameraProfileDigest="([^"]*)"/m.exec(t);
  if (!prof || !dig || prof[1] === "Embedded" || !HEX32.test(dig[1])) return null;
  let name = prof[1];
  let look = null;
  const lm = /<crs:Look>.*?<\/crs:Look>/s.exec(t);
  if (lm) {
    const n = /crs:Name="([^"]*)"/.exec(lm[0]);
    if (n) {
      // die Staerke (crs:Amount) gehoert zum einzelnen Foto, im Bestand soll immer der volle Look stehen
      look = lm[0].replace(/(crs:Amount=)"[^"]*"/, '$1"1"');
      name = n[1];
    }
  }
  // Graustufen nach dem Profilnamen, nicht nach diesem einen Foto: wer ein PROVIA-Bild in Lightroom auf Schwarzweiss stellt, darf PROVIA nicht grau lernen
  const entry = { profile: prof[1], digest: dig[1], grayscale: GRAY_PROFILES.has(name) };
  const mod = /tiff:Model="([^"]*)"/.exec(t);
  if (mod) entry.model = mod[1]; // der Digest gilt nur fuer diese Kamera
  if (look) entry.look = look;
  return [name, entry];
}

const KNOWN = new Set(Object.values(PROFILES));

// Lernen aus dem Text einer XMP, die nicht von diesem Werkzeug stammt. Gibt [Name, Eintrag] zurueck, wenn sie taugt.
export function learnFromXmp(text) {
  if (/x:xmptk="(?:raf|fuji)2xmp"/.test(text.slice(0, 400))) return null;
  const make = /tiff:Make="([^"]*)"/.exec(text);
  const got = make && make[1].toLowerCase().includes("fuji") ? xmpProfileEntry(text) : null;
  if (!got || !KNOWN.has(got[0]) || !KNOWN.has(got[1].profile) || !("model" in got[1])) return null;
  if (LOOK_NAMES.has(got[0]) && !got[1].look) return null; // ein Look ohne Look-Block waere nur das Basisprofil
  return got;
}
