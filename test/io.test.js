// Ordner einlesen ueber die drei Wege (Handle, FileList, Drop-Eintraege), mit Attrappen der Browser-Objekte.

import test from "node:test";
import assert from "node:assert/strict";
import { Folder, scanHandle, scanFileList, scanEntries, ZipSink, DirectSink } from "../site/js/io.js";

const file = (name, rel) => {
  const f = new File(["x"], name);
  if (rel !== undefined) Object.defineProperty(f, "webkitRelativePath", { value: rel });
  return f;
};
const names = (folders) => folders.map((f) => [f.path, [...f.files.values()].map((e) => e.name).sort()]);

test("FileList (webkitdirectory): Ordnername faellt weg, Versteckte fallen raus", () => {
  const folders = scanFileList([
    file("a.RAF", "Tag/a.RAF"), file("a.xmp", "Tag/a.xmp"), file("b.RAF", "Tag/Ordner 2/b.RAF"), file("c.raf", "Tag/Ordner 2/Tief/c.raf"),
    file("._a.RAF", "Tag/._a.RAF"), file("x.RAF", "Tag/.Trash/x.RAF"), file(".DS_Store", "Tag/.DS_Store"),
  ]);
  assert.deepEqual(names(folders), [["", [".DS_Store", "a.RAF", "a.xmp"]], ["Ordner 2", ["b.RAF"]], ["Ordner 2/Tief", ["c.raf"]]]);
  assert.ok(folders[0].has("A.XMP"));
});

test("FileList: lose Dateien liegen in einem Ordner", () => {
  assert.deepEqual(names(scanFileList([file("a.RAF"), file("b.RAF")])), [["", ["a.RAF", "b.RAF"]]]);
});

// Attrappen fuer FileSystemEntry: readEntries liefert je Aufruf nur einen Teil, bis eine leere Liste kommt
const fileEntry = (name) => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(new File(["x"], name)) });
const dirEntry = (name, kids, batch = 2) => ({
  isFile: false, isDirectory: true, name,
  createReader() {
    let i = 0;
    return { readEntries: (ok) => { const part = kids.slice(i, i + batch); i += batch; ok(part); } };
  },
});

test("Drop-Eintraege: ein Ordner, in Teilen gelesen", async () => {
  const root = dirEntry("Fotos", [fileEntry("1.RAF"), fileEntry("2.RAF"), fileEntry("3.RAF"), fileEntry("._4.RAF"), dirEntry("Sub", [fileEntry("5.RAF"), fileEntry("6.xmp")]), dirEntry(".hidden", [fileEntry("7.RAF")])]);
  const folders = await scanEntries([root]);
  assert.deepEqual(names(folders), [["", ["1.RAF", "2.RAF", "3.RAF"]], ["Sub", ["5.RAF", "6.xmp"]]]);
  assert.equal((await folders[1].get("5.raf").open()).name, "5.RAF");
});

test("Drop-Eintraege: mehrere Ordner und lose Dateien behalten ihre Namen", async () => {
  const folders = await scanEntries([dirEntry("A", [fileEntry("1.RAF")]), dirEntry("B", [dirEntry("C", [fileEntry("2.RAF")])]), fileEntry("lose.RAF")]);
  assert.deepEqual(names(folders), [["", ["lose.RAF"]], ["A", ["1.RAF"]], ["B", []], ["B/C", ["2.RAF"]]]);
});

// Attrappe fuer FileSystemDirectoryHandle
const fh = (name) => ({ kind: "file", name, getFile: async () => new File(["x"], name) });
const dh = (name, kids) => ({ kind: "directory", name, async *entries() { for (const k of kids) yield [k.name, k]; } });

test("Handle: Unterordner, Versteckte, Schreibzugriff nur wenn verlangt", async () => {
  const root = dh("R", [fh("b.RAF"), fh("a.RAF"), dh("z", [fh("1.RAF")]), dh("m", [dh("n", [fh("2.RAF")])]), dh(".Trash", [fh("3.RAF")])]);
  const ro = await scanHandle(root, { writable: false });
  assert.deepEqual(names(ro), [["", ["a.RAF", "b.RAF"]], ["m", []], ["m/n", ["2.RAF"]], ["z", ["1.RAF"]]]);
  assert.ok(ro.every((f) => f.dir === null));
  const rw = await scanHandle(root, { writable: true });
  assert.ok(rw.every((f) => f.dir !== null));
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(scanHandle(root, { signal: ac.signal }), { name: "AbortError" });
});

// Ordner-Attrappe mit Dateien im Speicher: getFileHandle wie im Browser (NotFoundError ohne create), removeEntry, steuerbare Fehler
function memDir(initial = {}, { failWrite = false, failCreate = false } = {}) {
  const files = new Map(Object.entries(initial));
  const log = [];
  const dir = {
    files, log,
    async getFileHandle(name, o = {}) {
      if (!files.has(name)) {
        if (!o.create) throw Object.assign(new Error("fehlt"), { name: "NotFoundError" });
        if (failCreate) throw Object.assign(new Error("gesperrt"), { name: "NotAllowedError" });
        files.set(name, "");
      }
      return {
        async getFile() { return new File([files.get(name)], name); },
        async createWritable() {
          return {
            async write(d) { if (failWrite) throw new Error("voll"); files.set(name, d); },
            async close() {},
            async abort() { log.push("abort " + name); },
          };
        },
      };
    },
    async removeEntry(name) { log.push("remove " + name); files.delete(name); },
  };
  return dir;
}

test("Senken: direkt schreiben, neue Datei bei Fehler wieder entfernen, vorhandene behalten", async () => {
  const d1 = memDir();
  await new DirectSink().put(new Folder("", d1), "a.xmp", "<x/>");
  assert.equal(d1.files.get("a.xmp"), "<x/>");

  const d2 = memDir({ "b.xmp": "alt" });
  await new DirectSink().put(new Folder("", d2), "b.xmp", "neu");
  assert.equal(d2.files.get("b.xmp"), "neu");

  // Schreiben schlaegt fehl: abbrechen, und die eben angelegte leere Datei verschwindet
  const d3 = memDir({}, { failWrite: true });
  await assert.rejects(new DirectSink().put(new Folder("", d3), "c.xmp", "x"), /voll/);
  assert.ok(!d3.files.has("c.xmp"));
  assert.deepEqual(d3.log, ["abort c.xmp", "remove c.xmp"]);

  // war die Datei schon da, bleibt sie, wie sie war
  const d4 = memDir({ "d.xmp": "alt" }, { failWrite: true });
  await assert.rejects(new DirectSink().put(new Folder("", d4), "d.xmp", "x"), /voll/);
  assert.equal(d4.files.get("d.xmp"), "alt");
  assert.ok(!d4.log.some((l) => l.startsWith("remove")));

  // Anlegen verweigert: Fehler weiterreichen, nichts angelegt
  const d5 = memDir({}, { failCreate: true });
  await assert.rejects(new DirectSink().put(new Folder("", d5), "e.xmp", "x"), { name: "NotAllowedError" });
  assert.equal(d5.files.size, 0);
});

test("Senken: probe findet Vorhandenes, mustBeNew ersetzt nie Fremdes", async () => {
  const d = memDir({ "a.xmp": "fremd" });
  const folder = new Folder("", d);
  const sink = new DirectSink();

  assert.equal(await sink.probe(folder, "neu.xmp"), null);
  const hit = await sink.probe(folder, "a.xmp");
  assert.equal(hit.name, "a.xmp");
  assert.equal(await (await hit.open()).text(), "fremd");

  // Andere Fehler als "nicht da" gehen weiter, damit ein unlesbares Ziel nicht fuer frei gehalten wird
  const gesperrt = { async getFileHandle() { throw Object.assign(new Error("nein"), { name: "NotAllowedError" }); } };
  await assert.rejects(sink.probe(new Folder("", gesperrt), "a.xmp"), { name: "NotAllowedError" });

  await assert.rejects(sink.put(folder, "a.xmp", "neu", { mustBeNew: true }), { name: "ExistsError" });
  assert.equal(d.files.get("a.xmp"), "fremd");

  await sink.put(folder, "b.xmp", "neu", { mustBeNew: true });
  assert.equal(d.files.get("b.xmp"), "neu");
});

test("Folder: Namen gelten ohne Gross-Klein und in beiden Unicode-Schreibweisen als gleich", () => {
  const f = new Folder("");
  f.add("Ma\u0308dchen.RAF", () => Promise.resolve(new File(["x"], "x")));
  assert.ok(f.has("M\u00e4DCHEN.raf"));
  assert.equal(f.get("m\u00e4dchen.RAF").name, "Ma\u0308dchen.RAF"); // der Name bleibt, wie der Ordner ihn hat
  assert.ok(!f.has("Madchen.RAF"));
});

test("Handle: ein unlesbarer Unterordner wird gemeldet, der Rest geht weiter", async () => {
  const kaputt = (name) => ({ kind: "directory", name, async *entries() { throw Object.assign(new Error("gesperrt"), { name: "NotReadableError" }); } });
  const folders = await scanHandle(dh("R", [fh("a.RAF"), kaputt("zu"), dh("ok", [fh("b.RAF")])]), {});
  assert.deepEqual(names(folders), [["", ["a.RAF"]], ["ok", ["b.RAF"]], ["zu", []]]);
  assert.deepEqual(folders.unreadable, ["zu"]);
  await assert.rejects(scanHandle(kaputt("R"), {}), { name: "NotReadableError" }); // der gewaehlte Ordner selbst ist ein Fehler
});

test("Drop-Eintraege: unlesbare Unterordner werden gemeldet, abgelegte Ordner mit Punkt bleiben", async () => {
  const kaputt = (name) => ({
    isFile: false, isDirectory: true, name,
    createReader: () => ({ readEntries: (ok, err) => err(Object.assign(new Error("gesperrt"), { name: "NotReadableError" })) }),
  });
  const one = await scanEntries([dirEntry("Fotos", [fileEntry("1.RAF"), kaputt("zu"), dirEntry("ok", [fileEntry("2.RAF")])])]);
  assert.deepEqual(names(one), [["", ["1.RAF"]], ["ok", ["2.RAF"]], ["zu", []]]);
  assert.deepEqual(one.unreadable, ["zu"]);
  await assert.rejects(scanEntries([kaputt("Fotos")]), { name: "NotReadableError" });

  // Mehrere abgelegte Ordner: der unlesbare wird genannt, einer mit Punkt im Namen bleibt, weil man ihn selbst abgelegt hat
  const many = await scanEntries([kaputt("Zu"), dirEntry(".Alt", [fileEntry("3.RAF")]), dirEntry("B", [fileEntry("4.RAF")])]);
  assert.deepEqual(names(many), [[".Alt", ["3.RAF"]], ["B", ["4.RAF"]], ["Zu", []]]);
  assert.deepEqual(many.unreadable, ["Zu"]);

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(scanEntries([dirEntry("A", [fileEntry("1.RAF")])], { signal: ac.signal }), { name: "AbortError" });
});

test("Senken: ZIP sammeln", async () => {
  const z = new ZipSink();
  await z.put(new Folder("A/B"), "c.xmp", "text");
  await z.put(new Folder(""), "d.xmp.bak", new Uint8Array([1, 2, 3]).buffer);
  assert.deepEqual(z.items.map((i) => i.path), ["A/B/c.xmp", "d.xmp.bak"]);
  assert.equal(z.count, 2);
  assert.ok((await z.blob().arrayBuffer()).byteLength > 100);
});
