// Der Bau mit Versionskennung: jede Adresse der Seite traegt sie, und der gebaute Stand laeuft wie der Quellstand.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { PYTHON } from "./helpers.js";
import { buildRaf, defaults } from "./synth.js";

const root = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(process.env.F2X_TMP || os.tmpdir(), "f2x-build-"));
const out = path.join(tmp, "dist");
const build = () => spawnSync(PYTHON, ["-I", path.join(root, "tools/build.py"), "--out", out], { encoding: "utf8" });

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test("Bau: Kennung an jedem Import, am Stylesheet und am Skript", () => {
  const r = build();
  assert.equal(r.status, 0, r.stderr);
  const v = /Version ([0-9a-f]{10}),/.exec(r.stdout)[1];
  const html = fs.readFileSync(path.join(out, "raf2xmp/index.html"), "utf8");
  assert.ok(html.includes(`href="style.css?v=${v}"`));
  assert.ok(html.includes(`src="js/app.js?v=${v}"`));
  assert.ok(html.includes('href="https://ko-fi.com/'), "Links nach draussen bleiben unberuehrt");
  assert.ok(!/ko-fi\.com[^"]*\?v=/.test(html));
  let imports = 0;
  for (const f of walk(path.join(out, "raf2xmp/js"))) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      imports++;
      assert.ok(m[1].endsWith(`.js?v=${v}`), `${path.basename(f)}: ${m[1]}`);
    }
  }
  assert.ok(imports >= 10, "es gab Importe zu stempeln");
  assert.ok(fs.existsSync(path.join(out, "_headers")));
  assert.ok(!fs.existsSync(path.join(out, "raf2xmp/_headers")), "die Kopfzeilen gehoeren an die Wurzel, nicht neben die Seite");
});

test("Bau: gleicher Stand gibt gleiche Kennung", () => {
  const v1 = /Version ([0-9a-f]{10})/.exec(build().stdout)[1];
  const v2 = /Version ([0-9a-f]{10})/.exec(build().stdout)[1];
  assert.equal(v1, v2);
});

test("Bau: fremde Verzeichnisse werden nicht geleert", () => {
  const foreign = path.join(tmp, "fremd");
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, "wichtig.txt"), "x");
  const r = spawnSync(PYTHON, ["-I", path.join(root, "tools/build.py"), "--out", foreign], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.ok(fs.existsSync(path.join(foreign, "wichtig.txt")));
});

test("Gebauter Stand: laeuft wie der Quellstand (ein Lauf auf einem erfundenen Ordner)", async () => {
  build();
  const url = (rel) => pathToFileURL(path.join(out, "raf2xmp/js", rel)).href;
  const { Folder, ZipSink } = await import(url("io.js") + "?v=probe");
  const session = await import(pathToFileURL(path.join(out, "raf2xmp/js/session.js")).href + "?v=" + fs.readFileSync(path.join(out, "raf2xmp/index.html"), "utf8").match(/js\/app\.js\?v=([0-9a-f]+)/)[1]);
  const f = new Folder("");
  f.add("SYNTH0001.RAF", () => Promise.resolve(new File([buildRaf(defaults())], "SYNTH0001.RAF")));
  const sink = new ZipSink();
  const sum = await session.runSession({ folders: [f], options: {}, sink });
  assert.deepEqual([sum.made, sum.failed], [1, 0]);
  assert.equal(sink.count, 1);
});
