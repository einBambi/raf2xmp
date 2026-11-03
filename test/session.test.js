// Ein Lauf der Seite auf erfundenen Ordnern: Ueberspringen, Ersetzen, Sicherungen, Lernen aus fremden XMPs, ZIP.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Folder, ZipSink, DirectSink } from "../site/js/io.js";
import { runSession, scanSummary, isOurs, targetName, retryRead, zipHint, reason } from "../site/js/session.js";
import { renderLook, LOOK_VERSION } from "../site/js/core.js";
import { LOOKS } from "../site/js/looks-data.js";
import { buildRaf, defaults, T } from "./synth.js";
import { PYTHON } from "./helpers.js";

const mem = (path_, files, t0 = 1_700_000_000_000) => {
  const f = new Folder(path_);
  let i = 0;
  for (const [name, data] of Object.entries(files)) f.add(name, () => Promise.resolve(new File([data], name, { lastModified: t0 + 1000 * i++ })));
  return f;
};

// Senke, die nur mitschreibt
class MemSink {
  mode = "direct";
  puts = [];
  async put(folder, name, data) {
    this.puts.push({ folder: folder.path, name, data: typeof data === "string" ? data : Buffer.from(data).toString("latin1") });
  }
}

const raf = (over = {}) => buildRaf({ ...defaults(), ...over });
const ours = "<?xpacket begin=\"\"?>\n<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"raf2xmp\">\n</x:xmpmeta>\n";
const oursOld = ours.replace("raf2xmp", "fuji2xmp"); // so hiess die Seite zuerst, solche XMPs bleiben unsere
const foreign = "<?xpacket begin=\"\"?>\n<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Adobe XMP Core 7.0\">\n</x:xmpmeta>\n";

const run = (folders, options, sink = new MemSink()) => runSession({ folders, options, sink }).then((sum) => ({ sum, sink }));

test("Grundlauf: schreibt, ueberspringt, meldet Fehler", async () => {
  const half = raf().subarray(0, 300); // abgeschnitten, Kopf ist aber da
  const f = mem("", {
    "SYNTH0001.RAF": raf(), "SYNTH0002.raf": raf({ maker: [[0x1401, T.SHORT, 0x600], [0x1003, T.SHORT, 0x0]] }), "SYNTH0003.RAF": half,
    "NOTRAF.RAF": new TextEncoder().encode("das ist keine RAW-Datei\n"), "readme.txt": "x", "._SYNTH0001.RAF": raf(), "SYNTH0004.RAF": raf({ maker: null }),
    "LEER.RAF": new Uint8Array(0), "NULLEN.RAF": new Uint8Array(500),
  });
  assert.deepEqual(scanSummary([f]), { rafs: 7, withXmp: 0, rafFolders: 1 });
  const { sum, sink } = await run([f]);
  assert.equal(sum.total, 7);
  assert.equal(sum.made, 2);
  assert.equal(sum.skipped, 1); // NOTRAF
  assert.equal(sum.failed, 4); // abgeschnitten, ohne Herstellernotiz, leer, nur Nullen (wie bei ExifTool und im Python-Werkzeug)
  assert.deepEqual(sink.puts.map((p) => p.name), ["SYNTH0001.xmp", "SYNTH0002.xmp"]);
  assert.ok(sink.puts[0].data.includes('x:xmptk="raf2xmp"'));
  assert.ok(sink.puts[1].data.includes('crs:CameraProfile="Camera CLASSIC CHROME"'));
});

test("Vorhandene XMPs: Ueberspringen, Ersetzen, Sicherungen", async () => {
  const mk = () => mem("sub", { "A.RAF": raf(), "B.RAF": raf(), "C.RAF": raf(), "D.RAF": raf(), "B.xmp": ours, "C.xmp": foreign, "C.xmp.bak": "alt", "D.XMP": foreign });
  assert.deepEqual(scanSummary([mk()]), { rafs: 4, withXmp: 3, rafFolders: 1 });

  let r = await run([mk()], {});
  assert.deepEqual([r.sum.made, r.sum.skipped, r.sum.failed], [1, 3, 0]);
  assert.deepEqual(r.sink.puts.map((p) => p.name), ["A.xmp"]);

  r = await run([mk()], { overwrite: true });
  assert.deepEqual([r.sum.made, r.sum.skipped, r.sum.failed], [4, 0, 0]);
  assert.deepEqual(r.sink.puts.map((p) => p.name), ["A.xmp", "B.xmp", "C.xmp.bak2", "C.xmp", "D.xmp.bak", "D.xmp"]);
  assert.equal(r.sink.puts.find((p) => p.name === "C.xmp.bak2").data, foreign);
  assert.ok(isOurs(new TextEncoder().encode(ours)));
  assert.ok(isOurs(new TextEncoder().encode(oursOld)));
  assert.ok(!isOurs(new TextEncoder().encode(foreign)));
});

// Echter Ordner hinter der Senke: Namen gelten wie auf APFS gleich, egal ob zusammengesetzt oder zerlegt (NFC und NFD)
function fsDir(initial = {}) {
  const files = new Map(Object.entries(initial));
  const handle = (name) => ({
    async createWritable() {
      return { async write(d) { files.set(name, typeof d === "string" ? d : Buffer.from(d).toString("latin1")); }, async close() {}, async abort() {} };
    },
    async getFile() { return new File([files.get(name)], name); },
  });
  return {
    files,
    async getFileHandle(name, o = {}) {
      const key = [...files.keys()].find((k) => k.normalize("NFC") === name.normalize("NFC"));
      if (key !== undefined) return handle(key);
      if (!o.create) throw Object.assign(new Error("fehlt"), { name: "NotFoundError" });
      files.set(name, "");
      return handle(name);
    },
    async removeEntry(name) { files.delete(name); },
  };
}

test("Direkt: eine XMP, die erst nach dem Einlesen dazukommt, wird nie ohne Sicherung ersetzt", async () => {
  const mk = () => {
    const dir = fsDir();
    const f = new Folder("", dir);
    f.add("A.RAF", () => Promise.resolve(new File([raf()], "A.RAF")));
    // Lightroom schreibt die XMP, nachdem der Scan fertig war (und eine fruehere Sicherung liegt auch schon da)
    dir.files.set("A.xmp", foreign);
    dir.files.set("A.xmp.bak", "fruehere Sicherung");
    return { dir, f };
  };

  let { dir, f } = mk();
  let r = await run([f], {}, new DirectSink());
  assert.deepEqual([r.sum.made, r.sum.skipped, r.sum.failed], [0, 1, 0]);
  assert.equal(dir.files.get("A.xmp"), foreign);
  assert.equal(r.sum.skipped, 1);

  ({ dir, f } = mk());
  r = await run([f], { overwrite: true }, new DirectSink());
  assert.deepEqual([r.sum.made, r.sum.skipped, r.sum.failed], [1, 0, 0]);
  assert.equal(dir.files.get("A.xmp.bak"), "fruehere Sicherung"); // die alte Sicherung bleibt
  assert.equal(dir.files.get("A.xmp.bak2"), foreign); // die fremde XMP liegt gesichert daneben
  assert.ok(dir.files.get("A.xmp").includes('x:xmptk="raf2xmp"'));
});

test("Namen mit zerlegten und zusammengesetzten Umlauten gelten als gleich", async () => {
  const f = mem("", { "Ma\u0308dchen.RAF": raf(), "M\u00e4dchen.xmp": foreign });
  assert.equal(scanSummary([f]).withXmp, 1);
  const { sum, sink } = await run([f], {});
  assert.deepEqual([sum.made, sum.skipped], [0, 1]);
  assert.equal(sink.puts.length, 0);
});

test("Fehlertexte: bekannte Namen deutsch, sonst Name und Text", () => {
  assert.match(reason({ name: "NotReadableError", message: "The requested file could not be read" }), /gesperrt/);
  assert.match(reason({ name: "NotFoundError" }), /nicht mehr da/);
  assert.equal(reason({ name: "DataError", message: "kaputt" }), "DataError: kaputt");
  assert.equal(reason(null), "unbekannter Fehler");
});

test("Lernen aus einer fremden XMP: Look fuer eine andere Kamera", async () => {
  const x100 = LOOKS.find((p) => p.name === "Camera CLASSIC Neg");
  const lookXml = renderLook({ ...x100, model: "X-T5", uuid: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", table: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", version: LOOK_VERSION[0], process: LOOK_VERSION[1] });
  const lr = [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0">', ' <rdf:RDF><rdf:Description',
    '   tiff:Make="FUJIFILM"', '   tiff:Model="X-T5"', '   crs:CameraProfile="Camera PROVIA/Standard"',
    '   crs:CameraProfileDigest="0123456789ABCDEF0123456789ABCDEF">', "   " + lookXml, " </rdf:Description></rdf:RDF>", "</x:xmpmeta>",
  ].join("\n");
  // Aufnahme einer X-T5 mit Classic Negative
  const xt5 = raf({ model: "X-T5", maker: [[0x1401, T.SHORT, 0x800], [0x1003, T.SHORT, 0x0]] });

  let r = await run([mem("", { "X.RAF": xt5 })], {});
  assert.equal(r.sum.lookless.get("X-T5"), 1); // ohne fremde XMP: nur das Basisprofil
  assert.ok(r.sink.puts[0].data.includes('crs:CameraProfile="Camera PROVIA/Standard"') && !r.sink.puts[0].data.includes("<crs:Look>"));

  r = await run([mem("", { "X.RAF": xt5, "fremd.xmp": lr })], {});
  assert.deepEqual(r.sum.learned, [{ name: "Camera CLASSIC Neg", model: "X-T5" }]);
  assert.equal(r.sum.lookless.size, 0);
  assert.ok(r.sink.puts[0].data.includes("<crs:Look>") && r.sink.puts[0].data.includes('crs:UUID="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"'));

  // eine eigene XMP lehrt nichts, auch eine unter dem alten Namen
  for (const mark of ["raf2xmp", "fuji2xmp"]) {
    r = await run([mem("", { "X.RAF": xt5, "fremd.xmp": lr.replace("Adobe XMP Core 7.0", mark) })], {});
    assert.deepEqual(r.sum.learned, []);
  }
});

test("Zuschnitt und Objektivkorrektur lassen sich abschalten", async () => {
  const zoom = raf({ rafDir: [[0x111, [0x14, 0x20, 0x1e, 0x30]], [0x117, [0, 0, 0, 1]], [0x118, [0x05, 0x00, 0x07, 0x80]], [0x119, [0x0a, 0x20, 0x0f, 0x30]]] });
  const a = (await run([mem("", { "Z.RAF": zoom })], {})).sink.puts[0].data;
  const b = (await run([mem("", { "Z.RAF": zoom })], { crop: false, lens: false })).sink.puts[0].data;
  assert.ok(a.includes('crs:HasCrop="True"') && a.includes("LensProfileEnable"));
  assert.ok(b.includes('crs:HasCrop="False"') && !b.includes("LensProfileEnable"));
});

test("ZIP: Pfade, Inhalt, Sicherung, Abbruch", async () => {
  const folders = [mem("", { "R.RAF": raf(), "R.xmp": foreign }), mem("Tag 1/Mädchen", { "S.RAF": raf() })];
  const sink = new ZipSink();
  const sum = await runSession({ folders, options: { overwrite: true }, sink });
  assert.equal(sum.made, 2);
  assert.deepEqual(sink.items.map((i) => i.path), ["R.xmp.bak", "R.xmp", "Tag 1/Mädchen/S.xmp"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f2x-ses-"));
  try {
    const z = path.join(dir, "o.zip");
    fs.writeFileSync(z, Buffer.from(await sink.blob().arrayBuffer()));
    const py = spawnSync(PYTHON, ["-I", "-c", "import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps(z.namelist()))", z], { encoding: "utf8" });
    assert.deepEqual(JSON.parse(py.stdout), ["R.xmp.bak", "R.xmp", "Tag 1/Mädchen/S.xmp"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const ac = new AbortController();
  ac.abort();
  const stopped = await runSession({ folders: [mem("", { "R.RAF": raf() })], sink: new MemSink(), signal: ac.signal });
  assert.equal(stopped.aborted, true);
  assert.equal(stopped.made, 0);
  assert.equal(targetName("a.b.RAF"), "a.b.xmp");
});

test("Lesen: einmal neu versuchen bei NotReadableError, sonst nicht", async () => {
  const notReadable = () => Object.assign(new Error("gesperrt"), { name: "NotReadableError" });
  let n = 0;
  assert.equal(await retryRead(async () => { if (++n === 1) throw notReadable(); return "da"; }, 1), "da");
  assert.equal(n, 2);
  n = 0;
  await assert.rejects(retryRead(async () => { n++; throw notReadable(); }, 1), { name: "NotReadableError" });
  assert.equal(n, 2); // nur ein zweiter Versuch
  n = 0;
  await assert.rejects(retryRead(async () => { n++; throw new TypeError("anders"); }, 1), TypeError);
  assert.equal(n, 1);
});

test("Lauf: eine Datei, die beim ersten Lesen scheitert, wird beim zweiten gelesen", async () => {
  const f = new Folder("");
  let opens = 0;
  f.add("SYNTH0001.RAF", async () => {
    if (++opens === 1) throw Object.assign(new Error("Platzhalter"), { name: "NotReadableError" });
    return new File([raf()], "SYNTH0001.RAF");
  });
  const { sum, sink } = await run([f]);
  assert.equal(opens, 2);
  assert.deepEqual([sum.made, sum.failed], [1, 0]);
  assert.equal(sink.puts.length, 1);
});

test("ZIP-Anleitung: flach oder mit Unterordnern, Safari nur bei Safari", () => {
  const ok = (folder) => ({ kind: "ok", folder, name: "A.RAF" });
  const flat = zipHint([ok("")]);
  assert.match(flat, /Kopiere die \.xmp-Dateien/);
  assert.doesNotMatch(flat, /Safari/);
  const nested = zipHint([ok(""), ok("2026/mai")]);
  assert.match(nested, /Zusammenführen/);
  assert.match(nested, /nie Ersetzen/);
  const safari = zipHint([ok("")], { safari: true });
  assert.match(safari, /^Safari entpackt das ZIP je nach Einstellung selbst, sonst genügt ein Doppelklick\. Kopiere die \.xmp-Dateien/);
  assert.doesNotMatch(safari, /meist/); // das ZIP wird nicht versprochen: Safari entpackt nur, wenn die Einstellung es erlaubt
  assert.match(zipHint([ok(""), ok("2026/mai")], { safari: true }), /^Safari entpackt das ZIP je nach Einstellung selbst, sonst genügt ein Doppelklick\. Kopiere den Inhalt/);
  assert.doesNotMatch(zipHint([{ kind: "skip", folder: "x", name: "B.RAF" }]), /Zusammenführen/); // nur geschriebene zaehlen
});

test("Schreibfehler: als Fehler mit Kennzeichen, der Lauf geht weiter", async () => {
  const f = mem("", { "A.RAF": raf(), "B.RAF": raf() });
  let n = 0;
  const sink = { mode: "direct", async put() { if (++n === 1) throw Object.assign(new Error("gesperrt"), { name: "NotAllowedError" }); } };
  const items = [];
  const sum = await runSession({ folders: [f], options: {}, sink, onItem: (i) => items.push(i) });
  assert.deepEqual([sum.made, sum.failed], [1, 1]);
  const bad = items.find((i) => i.kind === "error");
  assert.equal(bad.write, true);
  assert.match(bad.text, /Schreibzugriff verweigert/);
  assert.equal(items.filter((i) => i.write).length, 1);
});
