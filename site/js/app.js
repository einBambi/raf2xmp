// Oberflaeche: Ordner annehmen (Auswahl oder Ablegen), kurz zeigen, was gefunden wurde, den Lauf starten, das Ergebnis zeigen.
// Die Arbeit selbst steckt in session.js, der Zugriff auf Dateien in io.js. Hier wird nur angezeigt und verdrahtet.

import { canWriteInPlace, scanHandle, scanFileList, scanEntries, DirectSink, ZipSink } from "./io.js";
import { runSession, scanSummary, zipHint, reason } from "./session.js";
import { ZIP_MAX_FILES } from "./zip.js";

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("de-DE");
const plural = (n, one, many) => (n === 1 ? one : many);
const sections = ["start", "busy", "plan", "run", "result"];
const MAX_ROWS = 2000; // mehr Zeilen je Gruppe malt die Seite nicht, der Rest steht als Zahl da
const OPEN_MAX = 20; // Gruppen mit mehr Zeilen sind zunaechst zugeklappt, sonst waere die Ergebnisseite viele Bildschirme lang

let source = null; // {rescan(): Promise<Folder[]>, writable, partial}
let folders = null;
let controller = null; // bricht den Lauf ab
let scanner = null; // bricht das Einlesen des Ordners ab
let zipUrl = null;
let forceZip = false; // ZIP statt Schreiben in den Ordner: per Schalter gewaehlt oder nach Schreibfehlern

// Der Fokus geht immer an eine Stelle des neuen Abschnitts, sonst springt die Tastatur an die Stelle des verschwundenen Knopfs
function show(name) {
  for (const s of sections) $(s).hidden = s !== name;
  if (name === "start") say("");
  const head = $(name).querySelector("h2") || (name === "start" ? $("choose") : null);
  if (head) head.focus({ preventScroll: false });
}

const say = (text) => { $("live").textContent = text; };

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

// --- Ordner annehmen -------------------------------------------------------------------------------------------------------

// Gibt true zurueck, wenn es etwas zu tun gibt (RAFs gefunden), sonst false (Fehler, Abbruch oder keine RAFs)
async function adopt(src, { zip = false } = {}) {
  source = src;
  forceZip = zip;
  $("blocked").hidden = true;
  show("busy");
  $("busy-text").textContent = "";
  const scan = (scanner = new AbortController());
  try {
    folders = await src.rescan((n) => { $("busy-text").textContent = nf.format(n) + " Dateien gesehen"; }, scan.signal);
  } catch (e) {
    scanner = null;
    show("start");
    if (!(e && e.name === "AbortError")) notice("Der Ordner konnte nicht gelesen werden (" + reason(e) + ").");
    return false;
  }
  scanner = null;
  return plan();
}

function notice(text, offerZip = false) {
  const box = $("blocked");
  box.replaceChildren(el("p", { textContent: text }));
  if (offerZip) {
    const b = el("button", { type: "button", className: "linkbtn", textContent: "Stattdessen als ZIP-Download" });
    b.addEventListener("click", () => $("pick").click());
    box.append(el("p", {}, b));
  }
  box.hidden = false;
  box.focus(); // liest die Meldung vor und laesst die Tab-Taste beim naechsten Schritt weitergehen
}

async function choose() {
  $("blocked").hidden = true;
  if (!canWriteInPlace()) return $("pick").click();
  let handle;
  try {
    handle = await globalThis.showDirectoryPicker({ mode: "readwrite", startIn: "pictures" });
  } catch (e) {
    if (e && e.name === "AbortError") return;
    notice("Diesen Ordner gibt der Browser nicht frei (Systemordner und der oberste Ordner von Dokumente, Downloads oder Schreibtisch sind gesperrt). Wähle einen Unterordner.", true);
    return;
  }
  adopt(handleSource(handle, true));
}

const handleSource = (handle, writable) => ({ writable, partial: false, rescan: (onCount, signal) => scanHandle(handle, { writable, onCount, signal }) });
const listSource = (files) => ({ writable: false, partial: !files.some((f) => f.webkitRelativePath), rescan: async () => scanFileList(files) });
const entrySource = (entries) => ({ writable: false, partial: !(entries.length === 1 && entries[0].isDirectory), rescan: (onCount, signal) => scanEntries(entries, { onCount, signal }) });

$("choose").addEventListener("click", choose);
$("busy-stop").addEventListener("click", () => scanner?.abort());
$("pick").addEventListener("change", (ev) => {
  const files = [...ev.target.files];
  ev.target.value = "";
  if (files.length) adopt(listSource(files));
});

const drop = $("drop");
for (const type of ["dragenter", "dragover"]) {
  drop.addEventListener(type, (ev) => {
    ev.preventDefault();
    drop.dataset.over = "";
  });
}
drop.addEventListener("dragleave", (ev) => {
  if (!drop.contains(ev.relatedTarget)) delete drop.dataset.over;
});
drop.addEventListener("drop", (ev) => {
  ev.preventDefault();
  delete drop.dataset.over;
  // Die Eintraege des Drops gelten nur, solange dieser Handler laeuft: erst alles abgreifen, dann warten
  const items = [...(ev.dataTransfer?.items || [])].filter((i) => i.kind === "file");
  const handles = items.map((i) => (i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null)));
  const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  const files = [...(ev.dataTransfer?.files || [])];
  dropped(handles, entries, files);
});
// Eine Datei, die neben die Ablagezone faellt, soll nicht die Seite verlassen
for (const type of ["dragover", "drop"]) window.addEventListener(type, (ev) => { if (!drop.contains(ev.target)) ev.preventDefault(); });

async function dropped(handles, entries, files) {
  const hs = await Promise.all(handles);
  if (hs.length === 1 && hs[0] && hs[0].kind === "directory") {
    let writable = false;
    if (canWriteInPlace()) {
      try { writable = (await hs[0].requestPermission({ mode: "readwrite" })) === "granted"; } catch { /* dann eben als ZIP */ }
    }
    return adopt(handleSource(hs[0], writable));
  }
  if (entries.length) return adopt(entrySource(entries));
  if (files.length) return adopt(listSource(files));
}

// --- Vorschau und Optionen --------------------------------------------------------------------------------------------------

function options() {
  return { overwrite: $("o-overwrite").checked, crop: $("o-crop").checked, lens: $("o-lens").checked };
}

function plan() {
  const sum = scanSummary(folders);
  const direct = !forceZip && folders.length > 0 && folders[0].dir != null;
  $("plan-head").textContent = sum.rafs
    ? nf.format(sum.rafs) + " RAF-" + plural(sum.rafs, "Datei", "Dateien") + " in " + nf.format(sum.rafFolders) + " " + plural(sum.rafFolders, "Ordner", "Ordnern")
    : "Keine RAF-Dateien gefunden";
  let mode;
  if (!sum.rafs) mode = "Gesucht wird nach Dateien mit der Endung .raf, auch in Unterordnern. Wähle einen anderen Ordner.";
  else if (direct) mode = "Die XMPs werden direkt neben die RAFs geschrieben.";
  else if (source.partial) mode = "Die XMPs kommen als ZIP, die du danach neben die RAFs kopierst. Bei einzelnen Dateien sieht die Seite nicht, ob daneben schon eine .xmp liegt.";
  else mode = "Die XMPs kommen als ZIP, die du danach neben die RAFs kopierst." + (canWriteInPlace() ? "" : " Dein Browser kann nicht direkt in Ordner schreiben.");
  const tooMany = sum.rafs > 0 && !direct && sum.rafs > ZIP_MAX_FILES;
  if (tooMany) mode = "Das sind mehr RAFs, als in ein ZIP passen (höchstens " + nf.format(ZIP_MAX_FILES) + "). Wähle kleinere Ordner.";
  if (sum.withXmp === 1) mode += " Zu 1 RAF liegt schon eine .xmp daneben, die bleibt standardmäßig unberührt.";
  else if (sum.withXmp) mode += " Zu " + nf.format(sum.withXmp) + " RAFs liegt schon je eine .xmp daneben, die bleiben standardmäßig unberührt.";
  const lost = folders.unreadable || [];
  if (lost.length) mode += " Nicht lesbar und übersprungen: " + lost.slice(0, 3).join(", ") + (lost.length > 3 ? " und " + nf.format(lost.length - 3) + " weitere" : "") + ".";
  $("plan-mode").textContent = mode;
  $("o-overwrite").closest("label").hidden = !sum.rafs;
  for (const id of ["o-crop", "o-lens"]) $(id).closest("label").hidden = !sum.rafs;
  $("go").hidden = !sum.rafs || tooMany;
  $("go").textContent = direct ? "XMPs schreiben" : "ZIP erstellen";
  $("as-zip").hidden = !(direct && sum.rafs);
  show("plan");
  say($("plan-head").textContent);
  return sum.rafs > 0 && !tooMany;
}

$("again").addEventListener("click", reset);
$("restart").addEventListener("click", reset);

function reset() {
  clearZip();
  source = null;
  folders = null;
  show("start");
}

// --- Lauf ---------------------------------------------------------------------------------------------------------------------

$("go").addEventListener("click", start);
$("stop").addEventListener("click", () => controller?.abort());

async function start() {
  const direct = !forceZip && folders[0].dir != null;
  const sink = direct ? new DirectSink() : new ZipSink();
  controller = new AbortController();
  const items = [];
  $("bar").removeAttribute("value");
  $("run-text").textContent = "Suche nach vorhandenen XMPs von Lightroom …";
  show("run");
  try {
    const sum = await runSession({
      folders,
      options: options(),
      sink,
      signal: controller.signal,
      onItem: (it) => items.push(it),
      onPhase: (p) => { if (p === "run") $("run-text").textContent = ""; },
      onProgress: ({ done, total }) => {
        $("bar").max = total || 1;
        $("bar").value = done;
        $("run-text").textContent = nf.format(done) + " von " + nf.format(total);
      },
    });
    finish(sum, items, sink);
  } catch (e) {
    $("result-head").textContent = "Das hat nicht geklappt";
    $("result-sub").textContent = "Unerwarteter Fehler (" + reason(e) + ").";
    $("zip-row").hidden = true;
    $("callouts").replaceChildren();
    $("groups").replaceChildren();
    show("result");
  } finally {
    controller = null;
  }
}

// --- Ergebnis -----------------------------------------------------------------------------------------------------------------

function finish(sum, items, sink) {
  const zip = sink.mode === "zip";
  const verb = zip ? "im ZIP" : "geschrieben";
  const onlyExisting = !sum.made && !sum.failed && !sum.aborted && sum.skipped > 0 && items.every((i) => i.existing);
  const head = sum.aborted ? "Abgebrochen"
    : sum.failed && !sum.made ? "Das hat nicht geklappt"
    : sum.failed ? "Fertig, mit Fehlern"
    : onlyExisting ? "Nichts zu tun"
    : "Fertig";
  $("result-head").textContent = head;
  const parts = [nf.format(sum.made) + " " + plural(sum.made, "XMP", "XMPs") + " " + verb];
  if (sum.skipped) parts.push(nf.format(sum.skipped) + " übersprungen");
  parts.push(nf.format(sum.failed) + " " + plural(sum.failed, "Fehler", "Fehler"));
  $("result-sub").textContent = parts.join(", ") + ".";

  const zipRow = $("zip-row");
  clearZip();
  zipRow.hidden = !(zip && sink.count);
  if (zip && sink.count) {
    try {
      zipUrl = URL.createObjectURL(sink.blob());
      $("zip").textContent = "ZIP herunterladen (" + nf.format(sink.count) + " " + plural(sink.count, "Datei", "Dateien") + ")";
      $("zip").onclick = () => {
        const a = el("a", { href: zipUrl, download: "raf2xmp.zip" });
        document.body.append(a);
        a.click();
        a.remove();
      };
    } catch {
      zipRow.hidden = true;
      $("result-sub").textContent += " Das ZIP konnte nicht gebaut werden (mehr als " + nf.format(ZIP_MAX_FILES) + " Dateien?). Wähle kleinere Ordner.";
    }
  }

  $("zip-hint").hidden = zipRow.hidden;
  $("zip-hint").textContent = zipHint(items, { safari: navigator.vendor === "Apple Computer, Inc." });
  const call = $("callouts");
  call.replaceChildren();
  if (onlyExisting) {
    call.append(note("Zu " + (sum.skipped === 1 ? "dem RAF" : "allen " + nf.format(sum.skipped) + " RAFs") + " liegt schon eine .xmp daneben, deshalb wurde nichts geschrieben. " +
      "Zum Ersetzen unten „Mit anderen Optionen wiederholen“ wählen und „Vorhandene .xmp ersetzen“ einschalten."));
  }
  for (const [model, n] of sum.lookless) {
    call.append(note(nf.format(n) + " " + plural(n, "Foto", "Fotos") + " von der " + model + " " + plural(n, "bekam", "bekamen") +
      " nur das Basisprofil, weil die Kennungen der Looks (Classic Neg, Nostalgic Neg, Bleach Bypass, Sepia) für diese Kamera nicht eingebaut sind. " +
      "Abhilfe: In Lightroom ein Foto dieser Kamera auf den Look stellen und die Metadaten speichern, dann hier mit „Vorhandene .xmp ersetzen“ noch einmal starten. Die Seite liest die Kennung aus dieser .xmp."));
  }
  const writeFails = items.filter((i) => i.write).length;
  if (!zip && writeFails) {
    const n = note("Bei " + nf.format(writeFails) + " " + plural(writeFails, "Datei", "Dateien") + " hat der Browser das Schreiben verweigert oder abgebrochen. Das kommt vor, wenn der Ordner geschützt ist, das Schreiben gesperrt wurde oder ein anderes Programm die Datei hält. Du kannst die XMPs stattdessen als ZIP bekommen.");
    const b = el("button", { type: "button", className: "linkbtn", textContent: "Als ZIP erstellen" });
    b.addEventListener("click", async () => {
      clearZip();
      if (await adopt(source, { zip: true })) start(); // misslingt das neue Einlesen, bleibt die Meldung stehen, es laeuft nichts auf altem Stand
    });
    n.append(el("p", {}, b));
    call.append(n);
  }
  if (sum.aborted) call.append(note("Der Lauf wurde abgebrochen. Was bis dahin fertig war, ist " + (zip ? "im ZIP" : "geschrieben") + "."));
  const tips = [];
  if (sum.learned.length) tips.push("Aus vorhandenen XMPs gelernt: " + sum.learned.map((l) => l.name.replace(/^Camera /, "") + " (" + l.model + ")").join(", ") + ". Das gilt nur für diesen Lauf und wird nicht gespeichert.");
  if (zip && source && source.partial && sum.made) tips.push("Du hast einzelne Dateien statt eines Ordners gewählt, deshalb sah die Seite nicht, ob neben den RAFs schon eine .xmp liegt. Wenn du vorhandene behalten willst, ersetze beim Kopieren nichts.");
  if (sum.made) tips.push("In Lightroom: Die XMPs werden beim ersten Import gelesen. Liegen die Fotos schon im Katalog, markieren und „Metadaten aus Dateien lesen“ wählen.");
  for (const tip of tips) call.append(el("p", { className: "fine tip", textContent: tip }));

  const groups = $("groups");
  groups.replaceChildren();
  const by = (k) => items.filter((i) => i.kind === k);
  groupOf(groups, "Fehler", by("error"), { error: true });
  groupOf(groups, "Übersprungen", by("skip"));
  groupOf(groups, zip ? "Im ZIP" : "Geschrieben", by("ok"), { closed: true });
  if (sum.notes.size) {
    const rows = [...sum.notes].sort((a, b) => b[1] - a[1]).map(([text, n]) => ({ name: nf.format(n) + " ×", text, kind: "note" }));
    groupOf(groups, "Hinweise zu den Werten", rows, { closed: true });
  }

  show("result");
  say(head + ". " + $("result-sub").textContent);
}

const note = (text) => el("div", { className: "note" }, el("p", { textContent: text }));

function groupOf(parent, title, rows, { error = false, closed = false } = {}) {
  if (!rows.length) return;
  const open = !closed && rows.length <= OPEN_MAX;
  const d = el("details", { className: "group", open }, el("summary", {}, el("div", {}, title, el("span", { textContent: nf.format(rows.length) }))));
  const ul = el("ul", { className: "rows" });
  for (const r of rows.slice(0, MAX_ROWS)) {
    const name = el("b", {});
    if (r.folder) name.append(el("span", { className: "dir", textContent: r.folder + "/" }));
    name.append(r.name);
    ul.append(el("li", { className: error ? "err" : "" }, name, el("i", { textContent: r.text })));
  }
  if (rows.length > MAX_ROWS) ul.append(el("li", {}, el("span", { className: "more", textContent: "und " + nf.format(rows.length - MAX_ROWS) + " weitere" })));
  d.append(ul);
  parent.append(d);
}

function clearZip() {
  if (zipUrl) URL.revokeObjectURL(zipUrl);
  zipUrl = null;
}

$("redo").addEventListener("click", async () => {
  clearZip();
  await adopt(source, { zip: forceZip });
});

$("as-zip").addEventListener("click", () => {
  forceZip = true;
  plan();
});

// Ohne Schreibzugriff sagt die Auswahl-Schaltflaeche gleich, was vorraussichtlich passiert
if (!canWriteInPlace()) $("choose").title = "Dein Browser kann nicht in Ordner schreiben, die XMPs kommen als ZIP.";
