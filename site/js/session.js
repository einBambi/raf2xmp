// Ein Lauf der Seite: Ordner durchgehen, jedes RAF lesen, XMP berechnen und ablegen. Das ist die Schleife aus main() des
// Python-Werkzeugs mit denselben Entscheidungen und Meldungen, nur dass nichts auf einer Konsole landet, sondern als
// Liste von Eintraegen (kind, folder, name, text) zurueckkommt, die die Oberflaeche zeigt. Dazu kommt, was nur im Browser noetig ist:
// vor jedem Schreiben wird nachgesehen, ob die Datei inzwischen da ist (der Scan ist dann schon Minuten alt), und zufaellige Bytes
// unter einem .RAF-Namen gelten als "kein Fujifilm-RAF" (ExifTool meldet dort einen Fehler), leere und nur aus Nullen bestehende
// Dateien dagegen als Fehler.

import { HEADER_BYTES, rafIncomplete, readRaf } from "./reader.js";
import { makeXmp, g } from "./core.js";
import { LookDb, learnFromXmp } from "./looks.js";

export const HARVEST_MAX = 3000; // so viele fremde XMPs (die neuesten) werden hoechstens gelesen
export const HARVEST_BYTES = 500000; // und je XMP so viele Bytes

export const isRaf = (name) => /\.raf$/i.test(name) && !name.startsWith("._");
const isXmp = (name) => /\.xmp$/i.test(name) && !name.startsWith("._");

// Name ohne die letzte Endung, wie Path.stem in Python
const stem = (name) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
};
export const targetName = (rafName) => stem(rafName) + ".xmp";

const FILM_LABEL = {
  provia: "PROVIA", velvia: "Velvia", astia: "ASTIA", "classic chrome": "Classic Chrome", "pro neg hi": "PRO Neg. Hi",
  "pro neg std": "PRO Neg. Std", "classic neg": "Classic Neg.", "eterna bleach": "Eterna Bleach Bypass", eterna: "ETERNA",
  "nostalgic neg": "Nostalgic Neg.", reala: "REALA ACE", acros: "ACROS", "acros ye": "ACROS + Ye", "acros r": "ACROS + R",
  "acros g": "ACROS + G", mono: "Monochrom", "mono ye": "Monochrom + Ye", "mono r": "Monochrom + R", "mono g": "Monochrom + G", sepia: "Sepia",
};
export const filmLabel = (key) => (key ? FILM_LABEL[key] || key : "Filmsimulation unbekannt");

// Die Seite hiess zuerst fuji2xmp, und das Python-Werkzeug schreibt die alte Kennung bis heute. Beide gelten als eigene.
const OURS = ['x:xmptk="raf2xmp"', 'x:xmptk="fuji2xmp"'];
const latin1 = (u8) => String.fromCharCode(...u8);

// Stammt die XMP von diesem Werkzeug? (die ersten 400 Bytes, wie in Python)
export const isOurs = (head) => {
  const text = latin1(head.subarray(0, 400));
  return OURS.some((mark) => text.includes(mark));
};

async function readHead(entry, n) {
  const file = await entry.open();
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}

// Ein Lesefehler (NotReadableError) trifft oft Dateien, die gerade aus der Cloud geholt oder geschrieben werden: einmal neu versuchen,
// mit frisch geoeffneter Datei
export async function retryRead(fn, wait = 200) {
  try {
    return await fn();
  } catch (e) {
    if (!e || e.name !== "NotReadableError") throw e;
    await new Promise((r) => setTimeout(r, wait));
    return fn();
  }
}

// Was ein Lauf vorfindet, ohne etwas zu lesen oder zu schreiben: Anzahl RAFs, Ordner mit RAFs, RAFs mit schon vorhandener XMP
export function scanSummary(folders) {
  let rafs = 0;
  let withXmp = 0;
  let rafFolders = 0;
  for (const f of folders) {
    let here = 0;
    for (const e of f.files.values()) {
      if (!isRaf(e.name)) continue;
      here++;
      if (f.has(targetName(e.name))) withXmp++;
    }
    if (here) rafFolders++;
    rafs += here;
  }
  return { rafs, withXmp, rafFolders };
}

// Wie die XMPs aus dem ZIP neben die RAFs kommen. Liegen sie in Unterordnern, droht beim Kopieren das Ersetzen ganzer Ordner.
export function zipHint(items, { safari = false } = {}) {
  const nested = items.some((i) => i.kind === "ok" && i.folder);
  const lead = safari ? "Safari entpackt das ZIP meist schon selbst. " : "";
  return nested
    ? lead + "Kopiere den Inhalt in den Ordner, den du gewählt hast. Fragt dein System nach „Ersetzen“ oder „Zusammenführen“, wähle Zusammenführen, nie Ersetzen (am Mac erscheint es mit gehaltener Wahltaste)."
    : lead + "Kopiere die .xmp-Dateien in den Ordner mit den RAFs.";
}

// Naechster freier Sicherungsname: .xmp.bak, dann .bak2, .bak3 ... (auch gegen Dateien, die nach dem Scan dazukamen)
async function backupName(folder, target, sink) {
  let name = target + ".bak";
  for (let n = 2; folder.has(name) || (sink.probe && (await sink.probe(folder, name))); n++) name = target + ".bak" + n;
  return name;
}

// Der Seite Luft zum Zeichnen lassen. setTimeout(0) bremst der Browser in Hintergrund-Tabs auf etwa eine Sekunde, ein Nachrichtenkanal nicht.
const yieldToPage = () =>
  new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });

// Lernt aus XMPs, die schon neben den RAFs liegen und nicht von diesem Werkzeug stammen (etwa von Lightroom), die Kennungen von
// Looks und Profilen fuer diese Kamera. Nur im Speicher, nichts wird gespeichert. Die neueste XMP gilt.
export async function harvest(folders, db, { signal } = {}) {
  const cands = [];
  for (const f of folders) for (const e of f.files.values()) if (isXmp(e.name)) cands.push(e);
  const dated = [];
  for (const e of cands) {
    if (signal?.aborted) break;
    try {
      const file = await e.open();
      dated.push([file.lastModified, file]);
    } catch { /* nicht lesbar: ueberspringen */ }
  }
  dated.sort((a, b) => a[0] - b[0]);
  const learned = new Map();
  for (const [, file] of dated.slice(-HARVEST_MAX)) {
    if (signal?.aborted) break;
    let raw;
    try {
      raw = new Uint8Array(await file.slice(0, HARVEST_BYTES).arrayBuffer());
    } catch { continue; }
    if (isOurs(raw)) continue;
    const got = learnFromXmp(new TextDecoder("utf-8").decode(raw));
    if (!got) continue;
    db.learn(got[0], got[1]);
    learned.set(got[1].model + "|" + got[0], { name: got[0], model: got[1].model });
  }
  return [...learned.values()].sort((a, b) => (a.model + a.name < b.model + b.name ? -1 : 1));
}

// Hinweise des Kerns, die der Seite nur Laerm machen wuerden: ein Profil allein per Name ist in Lightroom geprueft in Ordnung,
// fehlende Looks meldet die Seite je Kamera, und der WB-Shift steckt schon in den Rohdaten
const QUIET = [/^Profil .* nur per Name/, /^Look .* nicht gefunden/, /^WB-Shift /];

// Fehlertexte der Browser sind englisch und von Browser zu Browser verschieden. Die haeufigen Namen bekommen eine deutsche
// Erklaerung, bei allen anderen stehen Name und Text des Browsers da (nuetzlich fuer eine Fehlermeldung an mich).
const REASONS = {
  NotAllowedError: "Zugriff verweigert",
  SecurityError: "Zugriff verweigert",
  NotFoundError: "nicht mehr da, verschoben oder Laufwerk getrennt?",
  NotReadableError: "gesperrt, nur online oder Laufwerk getrennt?",
  NoModificationAllowedError: "schreibgeschützt oder in einem anderen Programm geöffnet?",
  InvalidStateError: "schreibgeschützt oder in einem anderen Programm geöffnet?",
  QuotaExceededError: "kein Platz mehr",
  AbortError: "abgebrochen",
};
export const reason = (e) => REASONS[e && e.name] || [e && e.name, e && e.message].filter(Boolean).join(": ") || "unbekannter Fehler";

const writeError = (e) => (e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "Schreibzugriff verweigert" : reason(e));

const item = (kind, folder, name, text, extra = {}) => ({ kind, folder: folder.path, name, text, ...extra });

// options: {overwrite, crop, lens}. sink: DirectSink oder ZipSink. Gibt die Zusammenfassung zurueck, jeder Eintrag geht zusaetzlich an onItem.
export async function runSession({ folders, options = {}, sink, signal, onItem = () => {}, onProgress = () => {}, onPhase = () => {} }) {
  const o = { overwrite: false, crop: true, lens: true, ...options };
  const opts = { noCrop: !o.crop, noLens: !o.lens };
  const db = LookDb.withBuiltin();

  const rafFolders = folders.filter((f) => [...f.files.values()].some((e) => isRaf(e.name)));
  const jobs = [];
  for (const f of rafFolders) {
    for (const e of [...f.files.values()].filter((x) => isRaf(x.name)).sort((a, b) => (a.name < b.name ? -1 : 1))) jobs.push({ folder: f, entry: e });
  }

  onPhase("learn");
  let learned = [];
  try {
    learned = await harvest(rafFolders, db, { signal });
  } catch { /* Lernen ist eine Zugabe, nie ein Grund zum Abbruch */ }

  const sum = { made: 0, skipped: 0, failed: 0, total: jobs.length, aborted: false, learned, lookless: new Map(), notes: new Map(), models: new Map() };
  const written = new Set();
  const push = (it) => {
    if (it.kind === "ok") sum.made++;
    else if (it.kind === "skip") sum.skipped++;
    else if (it.kind === "error") sum.failed++;
    onItem(it);
  };

  onPhase("run");
  for (let i = 0; i < jobs.length; i++) {
    if (signal?.aborted) {
      sum.aborted = true;
      break;
    }
    const { folder, entry } = jobs[i];
    onProgress({ done: i, total: jobs.length });
    if (i % 25 === 24) await yieldToPage();
    try {
      await one(folder, entry);
    } catch (e) {
      push(item("error", folder, entry.name, "unerwartet (" + reason(e) + ")"));
    }
  }
  onProgress({ done: jobs.length, total: jobs.length });
  return sum;

  async function one(folder, entry) {
    let file;
    let head;
    let r;
    try {
      ({ file, head, r } = await retryRead(async () => {
        const f = await entry.open();
        const h = new Uint8Array(await f.slice(0, HEADER_BYTES).arrayBuffer());
        // ist die Datei unvollstaendig, lohnt das Weiterlesen nicht
        return { file: f, head: h, r: rafIncomplete(h, f.size) ? null : await readRaf(f) };
      }));
    } catch (e) {
      return push(item("error", folder, entry.name, "nicht lesbar (" + reason(e) + ")"));
    }
    const inc = rafIncomplete(head, file.size);
    if (inc) return push(item("error", folder, entry.name, "Datei unvollständig (" + inc[1] + " von " + inc[0] + " Bytes), abgebrochene Kopie?"));
    // Wie bei ExifTool ("File is empty", "Entire file is binary zeros") ein Fehler, nicht "kein Fujifilm-RAF": so endet eine missglueckte Kopie nicht in "Fertig"
    if (file.size === 0) return push(item("error", folder, entry.name, "Datei leer (0 Bytes), abgebrochene Kopie?"));
    if (head.length && head.every((b) => b === 0)) return push(item("error", folder, entry.name, "Datei besteht nur aus Nullen, abgebrochene Kopie?"));
    const d = r.d;
    if (r.status === "skip" || (!("FujiFilm:FilmMode" in d) && !("FujiFilm:Saturation" in d))) {
      if (r.status !== "skip" && d["File:FileType"] === "RAF") {
        return push(item("error", folder, entry.name, "RAF ohne lesbare Fuji-Angaben" + (r.warnings.length ? " (" + r.warnings.join("; ") + ")" : "")));
      }
      return push(item("skip", folder, entry.name, "kein Fujifilm-RAF"));
    }
    const target = targetName(entry.name);
    const key = (folder.path + "/" + target).normalize("NFC").toLowerCase();
    if (written.has(key)) return push(item("skip", folder, entry.name, "gleicher Name in diesem Lauf schon geschrieben"));
    written.add(key);
    let existing = folder.get(target);
    const skipExisting = () => push(item("skip", folder, entry.name, "vorhanden, nicht ersetzt", { existing: true }));
    if (existing && !o.overwrite) return skipExisting();

    let made;
    try {
      made = makeXmp(d, opts, db);
    } catch (e) {
      return push(item("error", folder, entry.name, "Berechnung fehlgeschlagen (" + reason(e) + ")"));
    }

    try {
      // Der Scan ist vom Anfang des Laufs: inzwischen kann eine XMP dazugekommen sein (Lightroom schreibt gerade eine), und eine
      // fremde darf nie ausversehen ohne Sicherung ersetzt werden
      if (!existing && sink.probe) {
        existing = await sink.probe(folder, target);
        if (existing && !o.overwrite) return skipExisting();
      }
      let backup = null;
      if (existing && !isOurs(await readHead(existing, 400))) {
        backup = await backupName(folder, target, sink);
        const old = await (await existing.open()).arrayBuffer();
        await sink.put(folder, backup, new Uint8Array(old), { mustBeNew: true });
        folder.add(backup, () => Promise.resolve(new File([old], backup)));
      }
      await sink.put(folder, target, made.xmp, { mustBeNew: !existing });
      folder.add(target, () => Promise.resolve(new File([made.xmp], target)));
      const model = String(g(d, "IFD0:Model") || "unbekannte Kamera");
      sum.models.set(model, (sum.models.get(model) || 0) + 1);
      for (const n of made.notes) if (!QUIET.some((q) => q.test(n))) sum.notes.set(n, (sum.notes.get(n) || 0) + 1);
      let text = filmLabel(made.meta.film);
      if (made.meta.crop) text += ", mit Zuschnitt";
      if (made.meta.noLook) {
        text += ", ohne Look";
        sum.lookless.set(model, (sum.lookless.get(model) || 0) + 1);
      }
      if (backup) text += ", vorhandene XMP gesichert als " + backup;
      push(item("ok", folder, entry.name, text, { film: made.meta.film, crop: Boolean(made.meta.crop), noLook: made.meta.noLook, notes: made.notes, backup }));
    } catch (e) {
      if (e && e.name === "ExistsError") return skipExisting(); // in letzter Sekunde dazugekommen, nichts wurde ersetzt
      push(item("error", folder, target, "nicht schreibbar (" + writeError(e) + ")", { write: true }));
    }
  }
}
