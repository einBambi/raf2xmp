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
    for (const [re, what] of FORBIDDEN) assert.ok(!re.test(text), `${f} enthaelt ${what}`);
  });
}

test("Gemerkt wird nichts: der Auswahldialog bekommt keine id, es gibt keine gespeicherten Handles", () => {
  const app = code(read("js/app.js"));
  assert.ok(!/showDirectoryPicker\([^)]*\bid\s*:/.test(app));
  assert.ok(!/\bhandle\b[^;\n]*\.(?:put|set)\(/.test(app));
});

test("Seite: aussen nur Ko-fi, kein Skript, Bild, Rahmen oder Formular von anderswo", () => {
  const html = read("index.html");
  const external = [...html.matchAll(/\b(?:href|src|action)="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.ok(external.length >= 1);
  for (const u of external) assert.match(u, /^https:\/\/ko-fi\.com\//, u);
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
