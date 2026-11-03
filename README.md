# raf2xmp

English: [README.en.md](README.en.md)

Liest die Rezepte aus Fujifilm-RAFs (Filmsimulation, Farbe, Lichter und Schatten, Korn und so weiter) und legt daneben Sidecars
(.xmp) für Adobe Lightroom an, damit ein RAF dort dem JPG aus der Kamera nahekommt. Eine Annäherung, kein exaktes Abbild.

Alles läuft im Browser. Es gibt keinen Server, keinen Upload und kein Konto. Die Seite läuft unter
<https://www.janbamba.ch/raf2xmp/>.

Die Seite ist reines JavaScript ohne Framework und ohne Pakete von Dritten. Das Gegenstück auf der Kommandozeile ist ein
Python-Werkzeug `raf2xmp.py` (bis zum 03.11.2026 unter dem Namen `fuji2xmp`, es gehört nicht zu diesem Repository), dessen
Rechenkern die Seite Zeile für Zeile nachbildet. Eine bewusste Abweichung steht unter „Grenzen“.

## Zusagen und wie sie geprüft werden

| Zusage | Wodurch abgesichert |
| --- | --- |
| Die Fotos verlassen den Rechner nicht, die Seite verbindet sich mit nichts | Content Security Policy mit `connect-src 'none'` und `default-src 'none'` (`site/_headers`), Test `test/privacy.test.js` sucht im Quelltext nach `fetch`, `XMLHttpRequest`, `sendBeacon`, WebSocket, Worker und Adressen nach draußen |
| Es wird nichts im Browser gespeichert | derselbe Test sucht nach `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, Cache API, Service Worker; dem Auswahldialog wird keine `id` mitgegeben, Ordner werden nicht gemerkt |
| Keine Dritten | keine Schriften, Skripte oder Bilder von anderswo, der Test prüft die Seite auf fremde Adressen (erlaubt sind nur der Ko-fi-Link und der Link auf den Quelltext) |
| In den XMPs steht nur das Rezept | die Datei besteht aus `crs:`-Einstellungen, kein Ort, keine Seriennummer, keine Aufnahmedaten |
| Vorhandenes wird nicht überschrieben | Vorgabe ist Überspringen. Vor jedem Schreiben schaut die Seite noch einmal im Ordner nach (`DirectSink.probe`, `put(..., { mustBeNew })`), damit auch eine .xmp, die Lightroom erst während des Laufs anlegt, nie ohne Sicherung ersetzt wird. Beim Ersetzen wird eine fremde .xmp vorher als `.xmp.bak` (bei Belegung `.xmp.bak2` und so weiter) gesichert, eine eigene ohne Sicherung ersetzt. Namen gelten wie auf dem Mac ohne Groß-Klein und in beiden Unicode-Schreibweisen als gleich |

Wer die Seite betreibt, muss Datenschutzerklärung und Seitentexte anpassen, sobald sich eine dieser Zusagen ändert.

## Aufbau

```
site/
  index.html, style.css      eine Seite, kein Framework, keine Schriftdateien, Hell und Dunkel folgen dem System
  _headers                   Kopfzeilen für Cloudflare Pages (CSP, Referrer-Policy, nosniff, ...)
  js/
    reader.js                liest aus einer RAF nur wenige Kilobyte: Kopf, Exif im Vorschaubild, Herstellernotiz, Verzeichnis
    core.js                  Rechenkern, Zeile für Zeile aus dem Python-Werkzeug übernommen
    pyfmt.js                 Python-Rundung und Formatierung (round half even, %.Nf, vorzeichenbehaftete Null)
    looks.js, looks-data.js  Kennungen der Looks (Classic Neg, Nostalgic Neg, Bleach Bypass, Sepia) und Lernen aus fremden XMPs
    session.js               ein Lauf: Ordner durchgehen, lesen, rechnen, ablegen, Ergebnisliste
    io.js                    Ordner lesen und schreiben (File System Access API, Ordnerauswahl, Ablegen) und die Senken
    zip.js                   ZIP ohne Kompression, wenn der Browser nicht in Ordner schreiben kann
    app.js                   Oberfläche
tools/
  serve.py                   Entwicklungsserver mit denselben Kopfzeilen wie später
  build.py                   baut ein ausrollbares Verzeichnis mit Versionskennung hinter jedem Dateinamen
  make_looks.py              erzeugt js/looks-data.js
  make_fixtures.py           baut ein winziges erfundenes RAF-Prüfstück
  preflight.sh               Prüfung vor jedem Push in ein öffentliches Repository (siehe „Mitmachen“)
  e2e-chrome.mjs             Ende-zu-Ende-Lauf in echtem Chrome (headless) mit echten RAFs
test/                        Tests (Node, `node --test`), Vergleiche mit dem Python-Werkzeug und mit ExifTool
  fixtures/SYNTH0001.RAF     erfundenes Prüfstück (keine Aufnahme, keine Seriennummer, kein Ort)
  data/looks-public.json     Look-Kennungen im Format des Python-Werkzeugs (Adobe-nah, siehe NOTICE.md)
.github/ISSUE_TEMPLATE/      Formular für fehlende Look-Kennungen
```

Schreiben direkt in den Ordner können Chrome, Edge und manche andere Chromium-Browser. In Safari und Firefox liest die Seite den
Ordner über die Auswahl oder per Ablegen und liefert die XMPs als ZIP.

## Entwickeln

Gebraucht werden Node ab 22 und Python 3 (nur Standardbibliothek), dazu `unzip`. ExifTool ist optional. Es gibt nichts zu
installieren, `package.json` hat keine Abhängigkeiten.

```bash
python3 tools/serve.py          # http://localhost:4173/raf2xmp/ (Port per Umgebungsvariable PORT)
npm test                        # alle Tests
python3 tools/build.py --out dist
```

## Tests

`npm test` startet alle Tests mit dem Test-Runner von Node. Tests, die mehr brauchen als Node und Python, überspringen sich
selbst:

* Ist **ExifTool** installiert, vergleichen die Tests den Leser mit ExifTool, auf erfundenen RAFs und auf dem Prüfstück.
* Zeigt `F2X_TOOL` auf das **Python-Werkzeug** (`raf2xmp.py`), vergleichen sie zusätzlich den Rechenkern Zeichen für Zeichen mit
  Python, auch auf Zufallsangaben. Ohne Angabe sucht `test/helpers.js` unter `../raf2xmp/raf2xmp.py`.

Weitere Umgebungsvariablen, alle optional:

| Variable | Wirkung |
| --- | --- |
| `F2X_CORPUS_JSON` | ExifTool-Angaben eines echten Bestands (`exiftool -j -G1`), vergleicht den Rechenkern mit Python |
| `F2X_RAF_DIRS` | Ordner mit echten RAFs, durch `:` getrennt, vergleicht den Leser mit ExifTool |
| `F2X_PYTHON` | Python-Programm für die Tests (Vorgabe `python3`) |
| `F2X_TMP` | Ordner für temporäre Dateien der Tests |
| `F2X_FUZZ_N`, `F2X_FUZZ_SEED` | Zahl der Zufallsfälle (Vorgabe 3000) und Startwert der Zufallsreihe |

Die beiden mit echten Dateien sind für Menschen gedacht, die ihren eigenen Bestand prüfen wollen. Private Dateien gehören nie ins
Repository. Alle übrigen Tests brauchen keine Fotos: Sie bauen winzige erfundene RAFs (`test/synth.js`, `tools/make_fixtures.py`)
und vergleichen sie mit ExifTool.

### Ende zu Ende in echtem Chrome

`tools/e2e-chrome.mjs` startet Chrome headless mit Wegwerfprofil und spielt drei Wege durch: Ordnerauswahl, Ablegen und direktes
Schreiben (mit einem Ordner aus dem Browserspeicher statt des echten Auswahldialogs). Danach vergleicht es die XMPs mit denen des
Python-Werkzeugs. Gebraucht werden Chrome unter macOS, Node ab 22, `unzip` und vollständige, echte RAFs (abgeschnittene lehnen
Seite und Werkzeug ab). Die Seite liefert keine Adobe-Digests, deshalb entsteht die Vorlage mit `--no-digest`:

```bash
python3 /pfad/zu/raf2xmp.py --no-digest --out /pfad/vorbild /pfad/raws
python3 tools/serve.py &
node tools/e2e-chrome.mjs http://localhost:4173/raf2xmp/ /pfad/raws /pfad/vorbild /pfad/arbeit
```

Am 03.11.2026 gab das mit 12 echten RAFs 12 von 12 byteidentische Dateien, lokal aus `site/`, aus dem gebauten Stand und auf der
echten Adresse. Der echte Auswahldialog und die Berechtigungsabfragen lassen sich nicht automatisch testen, das bleibt
Handarbeit (Prüfliste weiter unten).

## Looks neu erzeugen

Die Kennungen der vier Looks für die X100VI liegen gebündelt in `site/js/looks-data.js`. `tools/make_looks.py` erzeugt die Datei
aus den Look-Dateien, die Adobe mit Lightroom installiert, und braucht dafür das Python-Werkzeug:

```bash
python3 tools/make_looks.py --tool /pfad/zu/raf2xmp.py --models X100VI
python3 tools/make_looks.py --tool /pfad/zu/raf2xmp.py --models X100VI --python-json test/data/looks-public.json
```

Die Datei fällt nicht unter die Projektlizenz (siehe `NOTICE.md`). Muss sie einmal weg, genügt eine leere Liste
(`export const LOOKS = [];`): Die Seite läuft dann weiter, die Looks fallen auf das Basisprofil PROVIA zurück.

## Selbst betreiben

Die Seite ist statisch. `python3 tools/build.py --out dist` ergibt `dist/raf2xmp/` (die Seite) und `dist/_headers` (Kopfzeilen im
Format von Cloudflare Pages). Hinter jedem Dateinamen steht eine Versionskennung (`?v=...`), ein Hash über alle Dateien. Sie
verhindert, dass nach einem Update alte und neue Module gemischt aus dem Zwischenspeicher kommen.

`site/index.html` ist die Seite von janbamba.ch: Kopfzeile, Ko-fi-Link, Fußzeile, Favicon sowie die Links auf Impressum und
Datenschutz verweisen auf diese Domain, der Quelltext-Link auf dieses Repository. Wer die Seite selbst betreibt, ersetzt diese Stellen durch die eigenen. Auf anderen
Servern als Cloudflare Pages gehören die Kopfzeilen aus `site/_headers` in deren Konfiguration, allen voran die Content Security
Policy, auf der die Zusagen oben beruhen.

Nach dem ersten Ausrollen prüfen:

1. `curl -I https://<host>/raf2xmp/` zeigt `content-security-policy` und `referrer-policy` und kein `set-cookie`.
2. `curl -s https://<host>/raf2xmp/ | grep -c cdn-cgi` ergibt `0`. Hat der Host etwas dazugemischt (Rocket Loader, Web Analytics,
   Adressverschleierung), bricht die CSP.
3. Im Antwortkopf steht weder `nel` noch `report-to`. Network Error Logging gehört in der Cloudflare-Zone abgeschaltet, nicht im
   Projekt.

In Cloudflare sollten für diesen Pfad ausgeschaltet bleiben: Bot Fight Mode, alles, was `__cf_bm`, `_cfuvid` oder `cf_clearance`
setzt, und die Web Analytics. Rocket Loader wird mit `data-cfasync="false"` am Skript ausgenommen.

### Prüfliste vor dem Ausrollen (von Hand)

Vor jedem größeren Update einmal durchgehen:

* Chrome (macOS und Windows) und Edge: einen Ordner mit etwa 200 RAFs wählen (nicht Downloads, Dokumente oder Schreibtisch selbst),
  beide Abfragen beantworten, schreiben lassen, danach zweiter Lauf (alles übersprungen) und ein Lauf mit „Vorhandene .xmp ersetzen“.
* Ordner auf Kartenleser oder externem Laufwerk, und einer in iCloud Drive oder OneDrive, der nur online liegt.
* Ordner per Ablegen aus Finder oder Explorer in die Fläche ziehen, in Chrome, Firefox und Safari.
* „lieber als ZIP“ in Chrome, danach das ZIP in einen Ordner mit Unterordnern kopieren (am Mac „Zusammenführen“).
* Safari, Firefox, Brave: Ordner wählen oder ablegen, ZIP laden, in den Ordner kopieren, in Lightroom importieren.
* Während des Laufs in einen anderen Tab wechseln und zurückkommen: Der Lauf muss weitergegangen sein.
* VoiceOver (Safari, Chrome) und NVDA: einmal den ganzen Ablauf durchhören. Der Fokus springt auf die Überschrift des Schritts,
  die Meldungen (Fortschritt, Ergebnis) werden angesagt, „abbrechen“ ist erreichbar.
* Entwicklerwerkzeuge: Netzwerk zeigt nur Seite, Stylesheet und Module, der Speicher ist leer, die Konsole hat keine CSP-Meldung.
* Nach dem Ausrollen `curl -I` auf die Seite, ein Modul und einen unbekannten Pfad (soll 404 geben, kein Set-Cookie).

## Grenzen

* Gemessen ist an 132 Kamera-JPGs einer X100VI aus 41 Aufnahmeserien, am dichtesten belegt ist Classic Neg bei DR100. Für andere
  Kameras stimmen Profil und Richtung. Die vier Looks sind nur für die X100VI eingebaut, bei anderen Kameras lernt die Seite
  sie aus XMPs, die Lightroom neben die RAFs gelegt hat, sonst bleibt es beim Basisprofil PROVIA.
* Nicht geprüft: Schwarzweiß-Tonung, andere Bildformate als 3:2, Windows, Look-Blöcke ohne UUID oder RGBTable-Kennung,
  Screenreader (VoiceOver, NVDA), echte Laufwerke mit iCloud oder OneDrive.
* Geprüft mit dem neuen Lightroom und mit Lightroom Classic 15.6 unter macOS.
* Abweichung vom Python-Werkzeug: Bei der Belichtungskorrektur liest die Seite Brüche wie „+1/2“ als 0,5, das Python-Werkzeug
  kommt dort auf 1,0. Das ist gewollt, in `site/js/core.js` (`num`) begründet und in `test/pyref.py` für den Vergleich
  ausgeglichen.
* Kennung in den XMPs: Die Seite schreibt `x:xmptk="raf2xmp"` und erkennt daneben die alte Kennung `fuji2xmp` als eigene. Das
  Python-Werkzeug schreibt seit dem 03.11.2026 dieselbe Kennung und erkennt ebenfalls beide, XMPs der Seite und des Werkzeugs
  gelten also füreinander als eigene.
* Der Leser arbeitet mit Tag-Nummern und eigenen Wertetabellen, nicht mit den Bezeichnungen von ExifTool. Umbenennungen in
  neuen ExifTool-Versionen können ihn deshalb nicht verwirren. Verglichen ist er mit ExifTool 13.55.
* Direktes Schreiben kann von außen gesperrt sein (Richtlinie der Firma, Einstellung der Website, Gast- oder Profilmodus). Dann
  bietet die Seite nach dem Lauf das ZIP an. Wer es von vornherein will, wählt „lieber als ZIP“.
* Nicht automatisch testbar sind der echte Auswahldialog des Browsers, echtes Ablegen von Ordnern und die
  Berechtigungsabfragen. Getestet wird mit Ordnerobjekten aus dem Browserspeicher (OPFS) und einem ersetzten
  `showDirectoryPicker`.

## Mitmachen

* Fehlt für deine Kamera eine Look-Kennung? Dafür gibt es ein Formular unter „Issues“. Hänge keine RAFs, JPGs oder vollständigen
  XMPs an: Eine XMP kann Seriennummer, Ort und Aufnahmezeit enthalten. Kopiere nur den `crs:Look`-Block aus der XMP, die dein
  eigenes Lightroom geschrieben hat.
* Wenn du etwas ändern möchtest, öffne am besten zuerst ein Issue.
* Sicherheitslücken meldest du privat, siehe `SECURITY.md`.
* Bevor etwas in ein öffentliches Repository geht, läuft `sh tools/preflight.sh` im Hauptordner. Es sucht nach Foto- und
  Rohdateien, Metadaten, eingebetteten Bildern, privaten Pfaden und Wörtern, Commit-Adressen, großen Dateien und
  Zugangsdaten. `PREFLIGHT_PRIVATE_WORDS="wort1 wort2"` ergänzt Wörter, die nirgends vorkommen dürfen (Benutzername, Straße), und
  `PREFLIGHT_STRICT=1` macht fehlende Scanner (gitleaks, trufflehog) zum Fehler statt zum Hinweis.

### Regeln für Änderungen

Ohne neue Prüfung (Datenschutz, Recht) kommt nichts davon in die Seite: Upload, Telemetrie oder Fehlerberichte, Teilen-Links,
Service Worker, IndexedDB, CDN, Webschriften, Widgets von Ko-fi oder GitHub, Pages Web Analytics. Das gilt auch für Angaben, die aus
den Dateien abgeleitet sind (Prüfsummen, Zähler, Kamera- oder Objektivnamen), die dürfen den Rechner ebenso wenig verlassen. Der Test
`test/privacy.test.js` fängt das gröbste ab, die Prüfung der Absicht ersetzt er nicht.

Ko-fi bleibt ein freiwilliges Trinkgeld ohne Gegenleistung: keine Bezahlfunktion, kein bevorzugter Support, keine Werbung, keine
gesperrten Updates. Nur so bleibt das Projekt freie Software ohne gewerbliche Tätigkeit (EU-Cyberresilienzgesetz, neues
Produkthaftungsrecht), und der Satz „Spenden sind freiwillig und keine Gegenleistung“ auf der Seite stimmt.

## Hinweise zu Marken

Fujifilm, X100VI und die Namen der Filmsimulationen sind, soweit geschützt, Marken oder Bezeichnungen der FUJIFILM Corporation.
Adobe, Lightroom, Lightroom Classic und XMP sind Marken oder eingetragene Marken von Adobe in den Vereinigten Staaten und/oder
anderen Ländern. Dieses Projekt steht in keiner Verbindung zu den beiden und wird von keinem unterstützt, geprüft oder
empfohlen, die Namen stehen nur da, um zu sagen, womit die Seite arbeitet. raf2xmp ist ein unabhängiges, privates und
kostenloses Hobbyprojekt und wird ohne Gewähr bereitgestellt. Das Projekt hieß bis zum 03.11.2026 `fuji2xmp`.

## Lizenz

MIT, siehe `LICENSE`. Ausgenommen sind `site/js/looks-data.js` und `test/data/looks-public.json` mit den Adobe-nahen Kennungen.
Mehr dazu, die Herkunft der Kennungen und die Hinweise zu ExifTool stehen in `NOTICE.md`.
