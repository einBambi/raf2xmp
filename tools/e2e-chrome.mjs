// Ende-zu-Ende-Lauf der Seite in echtem Google Chrome (headless, eigenes Wegwerfprofil) mit echten, vollstaendigen RAFs.
// Drei Wege: Ordnerauswahl (webkitdirectory, ZIP), Ordner ablegen (Drop, ZIP), direktes Schreiben in einen Ordner (OPFS statt
// echtem Ordner, der Auswahldialog laesst sich nicht fernsteuern). Gegenstelle: die Ausgabe des Python-Werkzeugs.
//
// Aufruf: node tools/e2e-chrome.mjs <Seite> <RAF-Ordner> <Ordner mit Vorbild-XMPs> <Arbeitsordner>
//   Seite     etwa http://localhost:4173/raf2xmp/ (python3 tools/serve.py) oder die echte Adresse
//   Vorbild   python3 <Pfad zu raf2xmp.py> --no-digest --out <Ordner> <RAF-Ordner>  (die Seite liefert keine Adobe-Digests)
//   Arbeit    leerer Ordner fuer das Wegwerfprofil und die ZIPs, wird nicht aufgeraeumt
// Gebraucht: Node ab 22 (WebSocket eingebaut), Google Chrome unter macOS, unzip. Die RAFs muessen vollstaendig sein (abgeschnittene
// Dateien lehnen Seite und Werkzeug ab). Ausgabe ist ein JSON-Bericht. Der echte Auswahldialog und die Berechtigungsabfrage bleiben Handarbeit.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [BASE, RAWS, ORACLE, WORK] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const profile = fs.mkdtempSync(path.join(WORK, "chrome-profil-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { chrome: null, scenarios: {}, problems: [], requests: [], headers: null };

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1100,900", "about:blank",
], { stdio: "ignore" });
const bye = (code) => { try { chrome.kill("SIGKILL"); } catch {} process.exit(code); };
setTimeout(() => { console.error("Zeitlimit des Laufs"); bye(2); }, 280000);

async function waitVersion() {
  for (let i = 0; i < 150; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return await r.json(); } catch {}
    await sleep(100);
  }
  throw new Error("Chrome startet nicht");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const handlers = new Map();
    ws.addEventListener("open", () => resolve({
      send(method, params = {}, sessionId) {
        const myId = ++id;
        ws.send(JSON.stringify({ id: myId, method, params, sessionId }));
        return new Promise((res, rej) => pending.set(myId, { res, rej, method }));
      },
      on(method, cb) { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(cb); },
    }));
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`)); else p.res(msg.result);
      } else if (msg.method) (handlers.get(msg.method) || []).forEach((cb) => cb(msg.params, msg.sessionId));
    });
    ws.addEventListener("error", (e) => reject(new Error("WebSocket: " + (e.message || "Fehler"))));
  });
}

// aeltere Staende des Python-Werkzeugs schrieben noch die alte Kennung, die gleichen wir an
const norm = (t) => t.replaceAll('x:xmptk="fuji2xmp"', 'x:xmptk="raf2xmp"');

function compare(got /* Map name -> text */, label) {
  const want = new Map(fs.readdirSync(ORACLE).filter((n) => n.endsWith(".xmp")).map((n) => [n, norm(fs.readFileSync(path.join(ORACLE, n), "utf8"))]));
  const out = { erwartet: want.size, erhalten: got.size, gleich: 0, anders: [], fehlt: [], zuviel: [] };
  for (const [n, t] of want) {
    if (!got.has(n)) { out.fehlt.push(n); continue; }
    if (got.get(n) === t) out.gleich++;
    else {
      const a = got.get(n).split("\n"), b = t.split("\n");
      const i = a.findIndex((l, k) => l !== b[k]);
      out.anders.push({ name: n, zeile: i + 1, erhalten: a[i], erwartet: b[i] });
    }
  }
  for (const n of got.keys()) if (!want.has(n)) out.zuviel.push(n);
  report.scenarios[label].vergleich = out;
}

try {
  const v = await waitVersion();
  report.chrome = v.Browser;
  const cdp = await connect(v.webSocketDebuggerUrl);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);
  for (const d of ["Page", "Runtime", "DOM", "Network", "Log"]) await S(d + ".enable");

  cdp.on("Runtime.exceptionThrown", (p) => report.problems.push({ art: "exception", text: (p.exceptionDetails.exception?.description || p.exceptionDetails.text) }));
  cdp.on("Runtime.consoleAPICalled", (p) => { if (["error", "warning"].includes(p.type)) report.problems.push({ art: "console." + p.type, text: p.args.map((a) => a.value ?? a.description).join(" ") }); });
  cdp.on("Log.entryAdded", (p) => { if (["error", "warning"].includes(p.entry.level)) report.problems.push({ art: "log." + p.entry.source, text: `${p.entry.text} ${p.entry.url || ""}` }); });
  cdp.on("Network.requestWillBeSent", (p) => report.requests.push(p.request.url));
  cdp.on("Network.responseReceived", (p) => { if (p.type === "Document" && p.response.url === BASE) report.headers = p.response.headers; });
  let downloads = [];
  cdp.on("Browser.downloadWillBegin", (p) => downloads.push({ name: p.suggestedFilename, state: "begin" }));
  cdp.on("Browser.downloadProgress", (p) => { if (p.state === "completed") downloads.push({ state: "completed" }); });

  const ev = async (expr) => {
    const r = await S("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error("Auswertung: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expr, what, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(expr)) return Date.now() - t0; await sleep(80); }
    throw new Error("Zeitueberschreitung: " + what);
  };
  const shown = (id) => `!document.getElementById('${id}').hidden`;
  const text = (id) => ev(`document.getElementById('${id}').textContent.trim()`);
  const open = async () => {
    await S("Page.navigate", { url: BASE });
    await waitFor("document.readyState === 'complete' && !!document.getElementById('pick')", "Seite geladen");
  };
  const fileInput = async (id, files) => {
    const { result } = await S("Runtime.evaluate", { expression: `document.getElementById('${id}')` });
    await S("DOM.setFileInputFiles", { objectId: result.objectId, files });
  };
  const zipRoundTrip = async (label, dlDir) => {
    fs.mkdirSync(dlDir, { recursive: true });
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir, eventsEnabled: true });
    downloads = [];
    await ev("document.getElementById('zip').click()");
    for (let i = 0; i < 200 && !downloads.some((d) => d.state === "completed"); i++) await sleep(100);
    const zips = fs.readdirSync(dlDir).filter((n) => n.endsWith(".zip"));
    report.scenarios[label].zip = zips;
    if (!zips.length) return new Map();
    const dir = path.join(dlDir, "entpackt");
    fs.mkdirSync(dir, { recursive: true });
    execFileSync("unzip", ["-q", "-o", path.join(dlDir, zips[0]), "-d", dir]);
    const got = new Map();
    const walk = (d, rel = "") => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name), rel + e.name + "/"); else got.set(rel + e.name, fs.readFileSync(path.join(d, e.name), "utf8")); } };
    walk(dir);
    return got;
  };
  const planAndRun = async (label) => {
    const sc = report.scenarios[label];
    sc.plan = { kopf: await text("plan-head"), modus: await text("plan-mode") };
    const t0 = Date.now();
    await ev("document.getElementById('go').click()");
    await waitFor(shown("result"), "Ergebnis");
    sc.laufMs = Date.now() - t0;
    sc.ergebnis = { kopf: await text("result-head"), unter: await text("result-sub") };
  };

  // A: Ordnerauswahl (Eingabefeld mit webkitdirectory), Ergebnis als ZIP
  report.scenarios.A_auswahl = {};
  await open();
  const t0 = Date.now();
  await fileInput("pick", [RAWS]);
  await waitFor(shown("plan"), "Plan (Auswahl)");
  report.scenarios.A_auswahl.scanMs = Date.now() - t0;
  await planAndRun("A_auswahl");
  compare(await zipRoundTrip("A_auswahl", path.join(WORK, "dl-A")), "A_auswahl");

  // B: Ordner ablegen. Headless gibt es keine Berechtigungsabfrage, deshalb zwei Wege mit je einem Kunstgriff:
  //    B1 ohne getAsFileSystemHandle (so laeuft es in Firefox und Safari ueber webkitGetAsEntry),
  //    B2 mit Handle, aber verweigertem Schreibzugriff (Chrome, wenn jemand die Abfrage ablehnt)
  const dropScenario = async (label, setup) => {
    report.scenarios[label] = {};
    await open();
    await ev(setup);
    const box = await ev("(() => { const r = document.getElementById('drop').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
    const data = { items: [], files: [RAWS], dragOperationsMask: 1 };
    const t1 = Date.now();
    for (const type of ["dragEnter", "dragOver", "drop"]) await S("Input.dispatchDragEvent", { type, x: box.x, y: box.y, data });
    await waitFor(shown("plan"), "Plan (" + label + ")", 20000);
    report.scenarios[label].scanMs = Date.now() - t1;
    await planAndRun(label);
    compare(await zipRoundTrip(label, path.join(WORK, "dl-" + label)), label);
  };
  await dropScenario("B1_ablegen_entries", "(() => { DataTransferItem.prototype.getAsFileSystemHandle = undefined; return true; })()");
  await dropScenario("B2_ablegen_handle_verweigert", "(() => { FileSystemHandle.prototype.requestPermission = async () => 'denied'; return true; })()");

  // C: direkt in einen Ordner schreiben (OPFS-Ordner statt Auswahldialog), mit den echten Dateien als Inhalt
  report.scenarios.C_direkt = {};
  await open();
  const files = fs.readdirSync(RAWS).filter((n) => n.endsWith(".RAF")).map((n) => path.join(RAWS, n));
  await ev("(() => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.id = 'e2e-files'; document.body.appendChild(i); return true; })()");
  await fileInput("e2e-files", files);
  const tc = Date.now();
  await ev(`(async () => {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry('e2e', { recursive: true }); } catch {}
    const dir = await root.getDirectoryHandle('e2e', { create: true });
    for (const f of document.getElementById('e2e-files').files) {
      const h = await dir.getFileHandle(f.name, { create: true });
      const w = await h.createWritable(); await w.write(f); await w.close();
    }
    window.showDirectoryPicker = async () => dir;
    return true;
  })()`);
  report.scenarios.C_direkt.kopierenMs = Date.now() - tc;
  await ev("document.getElementById('choose').click()");
  await waitFor(shown("plan"), "Plan (direkt)");
  await planAndRun("C_direkt");
  const written = await ev(`(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e');
    const out = {};
    for await (const [name, h] of dir.entries()) if (name.endsWith('.xmp')) out[name] = await (await h.getFile()).text();
    return out;
  })()`);
  compare(new Map(Object.entries(written)), "C_direkt");

  // Zweiter Lauf im selben Ordner: alles uebersprungen, nichts doppelt
  await ev("document.getElementById('redo').click()");
  await waitFor(shown("plan"), "Plan (zweiter Lauf)");
  report.scenarios.C_direkt.zweiterLauf = { plan: await text("plan-head") };
  await ev("document.getElementById('go').click()");
  await waitFor(shown("result"), "Ergebnis (zweiter Lauf)");
  report.scenarios.C_direkt.zweiterLauf.ergebnis = await text("result-sub");

  report.fremdeAnfragen = [...new Set(report.requests.map((u) => new URL(u).origin))];
} catch (e) {
  report.fehler = String(e && e.stack || e);
}
fs.writeFileSync(path.join(WORK, "report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
bye(report.fehler ? 1 : 0);
