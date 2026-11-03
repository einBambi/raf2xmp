// Kern gegen das Python-Werkzeug auf den exiftool-Angaben eines echten Bestands (nur lokal, F2X_CORPUS_JSON zeigt auf die Datei).
// Jede XMP muss Zeichen fuer Zeichen gleich sein, in jeder Betriebsart.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeXmp } from "../site/js/core.js";
import { pyDb, publicLooksJson, runPython, toolAvailable } from "./helpers.js";

const corpusPath = process.env.F2X_CORPUS_JSON;
const skip = !corpusPath || !fs.existsSync(corpusPath) || !toolAvailable ? "F2X_CORPUS_JSON oder das Python-Werkzeug fehlt" : false;

const MODES = [
  ["Standard", {}],
  ["--neutral", { neutral: true }],
  ["--wb recipe", { wb: "recipe" }],
  ["--tone curve", { tone: "curve" }],
  ["--no-crop --no-lens", { noCrop: true, noLens: true }],
  ["--no-aspect-crop", { noAspectCrop: true }],
  ["--no-profile", { noProfile: true }],
  ["--film sepia", { film: "sepia" }],
  ["--film velvia", { film: "velvia" }],
  ["--film acros ye", { film: "acros ye" }],
  ["--film mono g", { film: "mono g" }],
  ["--film eterna bleach", { film: "eterna bleach" }],
  ["--film reala --neutral", { film: "reala", neutral: true }],
  ["--film pro neg std", { film: "pro neg std" }],
  ["--film classic chrome", { film: "classic chrome" }],
];

test("Kern gegen Python auf dem Bestand", { skip }, async (t) => {
  const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
  const dbObj = publicLooksJson();
  for (const [name, opts] of MODES) {
    await t.test(name, () => {
      const cases = corpus.map((d) => ({ d, opts }));
      const py = runPython(cases, dbObj);
      assert.equal(py.length, corpus.length);
      let bad = 0;
      corpus.forEach((d, i) => {
        const js = makeXmp(d, opts, pyDb(dbObj));
        const ref = py[i];
        if (ref.error) assert.fail(d.SourceFile + ": Python " + ref.error);
        if (js.xmp !== ref.xmp || JSON.stringify(js.notes) !== JSON.stringify(ref.notes)) {
          if (bad++ < 3) assert.equal(js.xmp, ref.xmp, d.SourceFile);
        }
      });
      assert.equal(bad, 0, bad + " Abweichungen");
    });
  }
});
