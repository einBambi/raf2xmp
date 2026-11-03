// Dateizugriff der Seite. Es gibt drei Wege, einen Ordner zu bekommen, und zwei Wege, Ergebnisse abzulegen:
//   rein:  showDirectoryPicker oder ein per Ziehen abgelegter Ordner (Chromium, mit Schreibzugriff), <input webkitdirectory> (alle),
//          abgelegte Ordner und Dateien ueber webkitGetAsEntry (Firefox, Safari)
//   raus:  direkt neben die RAFs (nur mit Schreibzugriff), sonst als ZIP zum Herunterladen
// Alles wird zu einer Liste von Folder-Objekten (Name -> Datei, die erst beim Lesen geoeffnet wird). Der Rest der Seite
// kennt nur diese Liste und eine Senke (put), nie die Browser-Schnittstellen.

import { buildZip } from "./zip.js";

// Schluessel eines Dateinamens: ohne Gross- und Kleinschreibung und in einheitlicher Unicode-Form (macOS legt Umlaute zerlegt ab,
// andere Programme zusammengesetzt, fuer den Menschen ist es derselbe Name)
const nameKey = (name) => name.normalize("NFC").toLowerCase();

export class Folder {
  // path: relativ zum gewaehlten Ordner ("" = der Ordner selbst, Unterordner mit "/"), dir: Handle mit Schreibzugriff oder null
  constructor(path, dir = null) {
    this.path = path;
    this.dir = dir;
    this.files = new Map();
  }

  add(name, open) {
    this.files.set(nameKey(name), { name, open });
  }

  has(name) {
    return this.files.has(nameKey(name));
  }

  get(name) {
    return this.files.get(nameKey(name));
  }
}

const joinPath = (a, b) => (a ? a + "/" + b : b);

// Versteckte Ordner (.Trash, .git, ...) enthalten keine Aufnahmen, die jemand umwandeln will
const hidden = (name) => name.startsWith(".");

// --- rein ------------------------------------------------------------------------------------------------------------------------

export const canWriteInPlace = () => typeof globalThis.showDirectoryPicker === "function";

// Ein Unterordner, den der Browser nicht lesen laesst, soll nicht den ganzen Lauf kippen: er wird uebersprungen und in
// folders.unreadable genannt. Nur ein unlesbarer Hauptordner ist ein Fehler.
const unreadable = (folders) => (folders.unreadable ||= []);
const aborted = (e) => e && e.name === "AbortError";

// Ordner-Handle (File System Access API). writable: ob createWritable moeglich sein soll (dann tragen die Folder das Handle)
export async function scanHandle(root, { writable, onCount, signal } = {}) {
  const folders = [];
  let n = 0;
  async function walk(dir, path) {
    const folder = new Folder(path, writable ? dir : null);
    folders.push(folder);
    const subs = [];
    try {
      for await (const [name, h] of dir.entries()) {
        if (signal?.aborted) throw new DOMException("abgebrochen", "AbortError");
        if (h.kind === "file") {
          folder.add(name, () => h.getFile());
          if (onCount && ++n % 200 === 0) onCount(n);
        } else if (!hidden(name)) subs.push([name, h]);
      }
    } catch (e) {
      if (aborted(e) || !path) throw e;
      unreadable(folders).push(path);
      return;
    }
    for (const [name, h] of subs.sort((a, b) => (a[0] < b[0] ? -1 : 1))) await walk(h, joinPath(path, name));
  }
  await walk(root, "");
  return folders;
}

// FileList aus <input webkitdirectory> oder <input multiple>. Der erste Pfadteil ist der gewaehlte Ordner selbst und faellt weg.
export function scanFileList(files) {
  const byPath = new Map();
  for (const f of files) {
    const parts = (f.webkitRelativePath || f.name).split("/");
    const name = parts.pop();
    const dirs = parts.length ? parts.slice(1) : [];
    if (name.startsWith("._") || dirs.some(hidden)) continue;
    const path = dirs.join("/");
    if (!byPath.has(path)) byPath.set(path, new Folder(path));
    byPath.get(path).add(name, () => Promise.resolve(f));
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
}

function readEntries(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function allEntries(dirEntry) {
  const reader = dirEntry.createReader();
  const out = [];
  for (;;) {
    const batch = await readEntries(reader); // liefert je Aufruf hoechstens ein paar Dutzend Eintraege, bis eine leere Liste kommt
    if (!batch.length) return out;
    out.push(...batch);
  }
}

const entryFile = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

// FileSystemEntry-Liste aus einem Drop (webkitGetAsEntry). Ein einzelner Ordner wird wie bei webkitdirectory behandelt,
// mehrere Ordner oder lose Dateien liegen in einem gemeinsamen Ausgangsordner, die Ordnernamen bleiben dann Teil des Pfads.
export async function scanEntries(entries, { onCount, signal } = {}) {
  const folders = new Map();
  let n = 0;
  const single = entries.length === 1 && entries[0].isDirectory;
  const folderAt = (path) => {
    if (!folders.has(path)) folders.set(path, new Folder(path));
    return folders.get(path);
  };
  const addFile = (entry, path) => {
    if (entry.name.startsWith("._")) return;
    folderAt(path).add(entry.name, () => entryFile(entry));
    if (onCount && ++n % 200 === 0) onCount(n);
  };
  const bad = [];
  async function walkDir(dir, path, root) {
    folderAt(path);
    let kids;
    try {
      kids = await allEntries(dir);
    } catch (e) {
      if (aborted(e) || (root && single)) throw e;
      bad.push(path || dir.name);
      return;
    }
    for (const child of kids) {
      if (signal?.aborted) throw new DOMException("abgebrochen", "AbortError");
      if (child.isFile) addFile(child, path);
      else if (child.isDirectory && !hidden(child.name)) await walkDir(child, joinPath(path, child.name), false);
    }
  }
  // Was der Mensch selbst ablegt, zaehlt auch, wenn der Name mit einem Punkt beginnt: versteckt sind nur Ordner darin
  for (const e of entries) {
    if (e.isFile) addFile(e, "");
    else if (e.isDirectory) await walkDir(e, single ? "" : e.name, true);
  }
  const out = [...folders.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  if (bad.length) out.unreadable = bad;
  return out;
}

// --- raus ------------------------------------------------------------------------------------------------------------------------

// Schreibt direkt in den Ordner (nur fuer Folder mit Handle). Chromium legt die Daten erst seperat in einer Hilfsdatei ab und tauscht beim
// Schliessen aus, so bleibt bei einem Abbruch keine halbe Datei liegen.
export class DirectSink {
  mode = "direct";

  // Liegt die Datei jetzt im Ordner? Der Scan vom Anfang kann veraltet sein (Lightroom schreibt gerade eine XMP) oder den Namen
  // anders geschrieben haben. Gibt einen Eintrag wie im Folder zurueck oder null.
  async probe(folder, name) {
    try {
      const h = await folder.dir.getFileHandle(name);
      return { name, open: () => h.getFile() };
    } catch (e) {
      if (e && e.name === "NotFoundError") return null;
      throw e;
    }
  }

  // mustBeNew: die Datei darf noch nicht da sein (ExistsError), sonst wuerde Fremdes ohne Sicherung ersetzt
  async put(folder, name, data, { mustBeNew = false } = {}) {
    const dir = folder.dir;
    let created = false;
    let handle = null;
    try {
      handle = await dir.getFileHandle(name);
    } catch (e) {
      if (!e || e.name !== "NotFoundError") throw e;
    }
    if (handle && mustBeNew) throw Object.assign(new Error("Datei liegt schon da"), { name: "ExistsError" });
    if (!handle) {
      handle = await dir.getFileHandle(name, { create: true });
      created = true;
    }
    let w;
    try {
      w = await handle.createWritable();
      await w.write(data);
      await w.close();
    } catch (e) {
      try { await w?.abort(); } catch { /* war schon zu */ }
      // Eine eben angelegte und nun leere Datei darf nicht liegen bleiben, sonst gilt sie beim naechsten Lauf als vorhanden
      if (created) {
        try { await dir.removeEntry(name); } catch { /* dann bleibt sie, aendern koennen wir es nicht */ }
      }
      throw e;
    }
  }
}

// Sammelt alles fuer ein ZIP; blob() baut es am Ende
export class ZipSink {
  mode = "zip";

  constructor() {
    this.items = [];
  }

  async put(folder, name, data) {
    this.items.push({ path: joinPath(folder.path, name), data: typeof data === "string" || data instanceof Uint8Array ? data : new Uint8Array(data) });
  }

  get count() {
    return this.items.length;
  }

  blob() {
    return buildZip(this.items);
  }
}
