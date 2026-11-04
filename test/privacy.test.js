// Die Zusagen der Seite, als Pruefung: kein Netz, kein Speicher im Browser, nichts von Dritten. Das stuetzt Datenschutzerklaerung und
// CSP. Faellt einer dieser Tests, muss der Text der Seite und die Datenschutzerklaerung mit geaendert werden.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const site = path.resolve(import.meta.dirname, "../site");
const read = (rel) => fs.readFileSync(path.join(site, rel), "utf8");
const jsFiles = fs.readdirSync(path.join(site, "js")).filter((f) => f.endsWith(".js"));

// Kommentare weg, damit Erklaerungen im Code nichts ausloesen
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const FORBIDDEN = [
  [/\bfetch\s*\(/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bsendBeacon\b/, "sendBeacon"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bimportScripts\b/, "importScripts"],
  [/\bnew\s+(?:Shared)?Worker\b/, "Worker"],
  [/\bserviceWorker\b/, "serviceWorker"],
  [/\blocalStorage\b/, "localStorage"],
  [/\bsessionStorage\b/, "sessionStorage"],
  [/\bindexedDB\b/, "indexedDB"],
  [/\bdocument\.cookie\b/, "document.cookie"],
  [/\bcaches\b\s*\./, "Cache API"],
  [/\bnavigator\.storage\b/, "navigator.storage"],
  [/\bimport\s*\(/, "dynamischer Import"],
  [/\beval\s*\(/, "eval"],
  [/\bnew\s+Function\b/, "new Function"],
  [/\bhttps?:\/\/(?!ns\.adobe\.com|www\.w3\.org|purl\.org)/, "Adresse nach draussen"],
];

for (const f of jsFiles) {
  test(`Kein Netz und kein Browserspeicher in js/${f}`, () => {
    const text = code(read("js/" + f));
    for (const [re, what] of FORBIDDEN) {
      // theme.js liest (nur lesen) die Hell/Dunkel-Wahl der Sitzung von janbamba.ch
      if (f === "theme.js" && what === "sessionStorage") continue;
      assert.ok(!re.test(text), `${f} enthaelt ${what}`);
    }
  });
}

test("theme.js liest nur die Sitzungswahl, schreibt nichts", () => {
  const text = code(read("js/theme.js"));
  assert.ok(!/setItem|removeItem|clear\s*\(|localStorage/.test(text));
  assert.ok(/getItem\(\s*'theme'\s*\)/.test(text));
});

test("Gemerkt wird nichts: der Auswahldialog bekommt keine id, es gibt keine gespeicherten Handles", () => {
  const app = code(read("js/app.js"));
  assert.ok(!/showDirectoryPicker\([^)]*\bid\s*:/.test(app));
  assert.ok(!/\bhandle\b[^;\n]*\.(?:put|set)\(/.test(app));
});

// Die zwei Links nach draussen, die es gibt: das Trinkgeld und der Quelltext dieser Seite
const KOFI = /^https:\/\/ko-fi\.com\//;
const SOURCE = "https://github.com/einBambi/raf2xmp";

test("Seite: aussen nur Ko-fi und der Quelltext, kein Skript, Bild, Rahmen oder Formular von anderswo", () => {
  const html = read("index.html");
  const external = [...html.matchAll(/\b(href|src|action)="(https?:[^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.ok(external.length >= 1);
  for (const [attr, u] of external) {
    assert.equal(attr, "href", "von anderswo darf nur ein Link kommen: " + u);
    assert.ok(KOFI.test(u) || u === SOURCE, u);
  }
  assert.ok(external.some(([, u]) => u === SOURCE), "Link zum Quelltext fehlt");
  assert.ok(!/<(?:iframe|object|embed|form|img)\b/i.test(html));
  assert.ok(!/<script\b(?![^>]*\bsrc=)/i.test(html), "kein Skript im Text der Seite");
  assert.ok(!/<link\b[^>]*\b(?:preconnect|prefetch|dns-prefetch|preload)\b/i.test(html));
  for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) assert.match(m[0], /rel="noopener noreferrer"/);
  const css = read("style.css");
  assert.ok(!/url\(|@import|@font-face/.test(css), "keine Schriften oder Bilder von anderswo");
});

test("Kopfzeilen: strenge Richtlinie, kein Referer, kein Rahmen", () => {
  const h = read("_headers");
  assert.match(h, /default-src 'none'/);
  assert.match(h, /script-src 'self'/);
  assert.match(h, /connect-src 'none'/);
  assert.match(h, /frame-ancestors 'none'/);
  assert.doesNotMatch(h, /unsafe-inline|unsafe-eval|https?:/);
  assert.match(h, /Referrer-Policy: no-referrer/);
});
