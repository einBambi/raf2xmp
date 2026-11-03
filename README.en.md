# raf2xmp

Deutsch: [README.md](README.md)

Reads the recipes from Fujifilm RAFs (film simulation, color, highlights and shadows, grain and so on) and writes sidecars (.xmp)
for Adobe Lightroom next to them, so that a RAF there comes close to the camera's JPEG. An approximation, not an exact copy.

Everything runs in the browser. There is no server, no upload and no account. The page runs at
<https://www.janbamba.ch/raf2xmp/>.

The page is plain JavaScript without a framework and without third-party packages. The command-line counterpart is a Python tool
(previously named `fuji2xmp`, it is not part of this repository), whose calculation core the page reproduces line by line. One
deliberate deviation is listed under "Limits".

This file is a translation of [README.md](README.md). The page itself, `NOTICE.md` and `SECURITY.md` are in German. If the two
READMEs ever differ, the German one is the one that is kept up to date.

## Guarantees and how they are checked

| Guarantee | What backs it up |
| --- | --- |
| The photos never leave the computer, the page connects to nothing | Content Security Policy with `connect-src 'none'` and `default-src 'none'` (`site/_headers`); the test `test/privacy.test.js` scans the source for `fetch`, `XMLHttpRequest`, `sendBeacon`, WebSocket, Worker and outbound addresses |
| Nothing is stored in the browser | the same test looks for `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, the Cache API and service workers; the picker dialog is given no `id`, folders are not remembered |
| No third parties | no fonts, scripts or images from elsewhere; the test checks the page for foreign addresses (only the Ko-fi link is allowed) |
| The XMPs contain only the recipe | the file consists of `crs:` settings, no location, no serial number, no shooting data |
| Existing files are not overwritten | the default is to skip. Before every write the page looks into the folder once more (`DirectSink.probe`, `put(..., { mustBeNew })`), so even an .xmp that Lightroom creates only during the run is never replaced without a backup. When replacing, a foreign .xmp is first saved as `.xmp.bak` (`.xmp.bak2` and so on if that name is taken), one of its own is replaced without a backup. Names count as equal the way they do on a Mac: regardless of case and in both Unicode spellings |

Whoever runs the page has to adjust the privacy policy and the page texts as soon as one of these guarantees changes.

## Layout

```
site/
  index.html, style.css      one page, no framework, no font files, light and dark follow the system
  _headers                   headers for Cloudflare Pages (CSP, Referrer-Policy, nosniff, ...)
  js/
    reader.js                reads only a few kilobytes of a RAF: header, Exif in the preview image, maker note, directory
    core.js                  calculation core, taken over line by line from the Python tool
    pyfmt.js                 Python rounding and formatting (round half even, %.Nf, signed zero)
    looks.js, looks-data.js  identifiers of the Looks (Classic Neg, Nostalgic Neg, Bleach Bypass, Sepia) and learning from foreign XMPs
    session.js               one run: walk the folder, read, calculate, store, result list
    io.js                    reading and writing folders (File System Access API, folder picker, drop) and the sinks
    zip.js                   uncompressed ZIP for browsers that cannot write into folders
    app.js                   user interface
tools/
  serve.py                   development server with the same headers as later
  build.py                   builds a deployable directory with a version id behind every file name
  make_looks.py              generates js/looks-data.js
  make_fixtures.py           builds a tiny invented RAF test file
  preflight.sh               check before every push to a public repository (see "Contributing")
  e2e-chrome.mjs             end-to-end run in real Chrome (headless) with real RAFs
test/                        tests (Node, `node --test`), comparisons with the Python tool and with ExifTool
  fixtures/SYNTH0001.RAF     invented test file (no shot, no serial number, no place)
  data/looks-public.json     Look identifiers in the Python tool's format (Adobe-derived, see NOTICE.md)
.github/ISSUE_TEMPLATE/      form for missing Look identifiers
```

Chrome, Edge and some other Chromium browsers can write directly into the folder. In Safari and Firefox the page reads the folder
through the picker or by drop and hands over the XMPs as a ZIP.

## Development

You need Node 22 or newer and Python 3 (standard library only), plus `unzip`. ExifTool is optional. There is nothing to install,
`package.json` has no dependencies.

```bash
python3 tools/serve.py          # http://localhost:4173/raf2xmp/ (port via the environment variable PORT)
npm test                        # all tests
python3 tools/build.py --out dist
```

## Tests

`npm test` runs all tests with Node's test runner. Tests that need more than Node and Python skip themselves:

* If **ExifTool** is installed, the tests compare the reader with ExifTool, on invented RAFs and on the included test file.
* If `F2X_TOOL` points to the **Python tool** (`fuji2xmp.py`), they also compare the calculation core with Python character by
  character, including on random inputs. Without it, `test/helpers.js` looks under `../fuji2xmp/fuji2xmp.py`.

More environment variables, all optional:

| Variable | Effect |
| --- | --- |
| `F2X_CORPUS_JSON` | ExifTool data of a real collection (`exiftool -j -G1`), compares the calculation core with Python |
| `F2X_RAF_DIRS` | folders with real RAFs, separated by `:`, compares the reader with ExifTool |
| `F2X_PYTHON` | Python program for the tests (default `python3`) |
| `F2X_TMP` | folder for temporary files of the tests |
| `F2X_FUZZ_N`, `F2X_FUZZ_SEED` | number of random cases (default 3000) and start value of the random series |

The two that use real files are meant for people who want to check their own collection. Private files never belong in the
repository. All other tests need no photos: they build tiny invented RAFs (`test/synth.js`, `tools/make_fixtures.py`) and compare
them with ExifTool.

### End to end in real Chrome

`tools/e2e-chrome.mjs` starts Chrome headless with a throwaway profile and plays through three paths: folder picker, drop and
direct writing (with a folder from browser storage instead of the real picker dialog). Then it compares the XMPs with those of the
Python tool. You need Chrome on macOS, Node 22 or newer, `unzip` and complete, real RAFs (truncated ones are rejected by the page
and by the tool). The page produces no Adobe digests, so the reference is made with `--no-digest`:

```bash
python3 /path/to/fuji2xmp.py --no-digest --out /path/to/reference /path/to/raws
python3 tools/serve.py &
node tools/e2e-chrome.mjs http://localhost:4173/raf2xmp/ /path/to/raws /path/to/reference /path/to/work
```

On 3 November 2026 this gave 12 of 12 byte-identical files with 12 real RAFs, locally from `site/`, from the built version and on
the live address. The real picker dialog and the permission prompts cannot be tested automatically, that stays manual work
(checklist further down).

## Regenerating the Looks

The identifiers of the four Looks for the X100VI are bundled in `site/js/looks-data.js`. `tools/make_looks.py` generates the file
from the Look files that Adobe installs with Lightroom, and needs the Python tool for that:

```bash
python3 tools/make_looks.py --tool /path/to/fuji2xmp.py --models X100VI
python3 tools/make_looks.py --tool /path/to/fuji2xmp.py --models X100VI --python-json test/data/looks-public.json
```

The file is not covered by the project license (see `NOTICE.md`). If it ever has to go, an empty list
(`export const LOOKS = [];`) is enough: the page keeps working, the Looks fall back to the base profile PROVIA.

## Running it yourself

The page is static. `python3 tools/build.py --out dist` produces `dist/raf2xmp/` (the page) and `dist/_headers` (headers in the
format of Cloudflare Pages). Behind every file name there is a version id (`?v=...`), a hash over all files. It prevents old and
new modules from coming out of the cache mixed after an update.

`site/index.html` is the page of janbamba.ch: header, Ko-fi link, footer, favicon and the links to the imprint and the privacy
policy point to that domain. Whoever runs the page themselves replaces those places with their own. On servers other than
Cloudflare Pages, the headers from `site/_headers` belong into their configuration, above all the Content Security Policy on which
the guarantees above rest.

After the first rollout, check:

1. `curl -I https://<host>/raf2xmp/` shows `content-security-policy` and `referrer-policy` and no `set-cookie`.
2. `curl -s https://<host>/raf2xmp/ | grep -c cdn-cgi` gives `0`. If the host has mixed something in (Rocket Loader, Web
   Analytics, address obfuscation), the CSP breaks.
3. The response header contains neither `nel` nor `report-to`. Network Error Logging has to be switched off in the Cloudflare
   zone, not in the project.

In Cloudflare, these should stay switched off for this path: Bot Fight Mode, everything that sets `__cf_bm`, `_cfuvid` or
`cf_clearance`, and Web Analytics. Rocket Loader is excluded with `data-cfasync="false"` on the script.

### Checklist before a rollout (by hand)

Go through this once before every larger update. The labels in quotes are the German button texts of the page:

* Chrome (macOS and Windows) and Edge: choose a folder with about 200 RAFs (not Downloads, Documents or the desktop itself),
  answer both prompts, let it write, then a second run (everything skipped) and a run with "Vorhandene .xmp ersetzen" (replace
  existing .xmp).
* A folder on a card reader or an external drive, and one in iCloud Drive or OneDrive that exists only online.
* Drop a folder from Finder or Explorer onto the drop area, in Chrome, Firefox and Safari.
* "lieber als ZIP" (rather as ZIP) in Chrome, then copy the ZIP into a folder with subfolders (on the Mac choose "Merge").
* Safari, Firefox, Brave: choose or drop a folder, download the ZIP, copy it into the folder, import into Lightroom.
* Switch to another tab during a run and come back: the run must have carried on.
* VoiceOver (Safari, Chrome) and NVDA: listen through the whole flow once. Focus jumps to the heading of the step, the messages
  (progress, result) are announced, "abbrechen" (cancel) is reachable.
* Developer tools: the network panel shows only the page, the stylesheet and the modules, storage is empty, the console has no CSP
  message.
* After the rollout, `curl -I` on the page, on a module and on an unknown path (should give 404, no Set-Cookie).

## Limits

* Measured against 132 in-camera JPEGs from an X100VI, from 41 shooting series; Classic Neg at DR100 is covered most densely. For
  other cameras, profile and direction are right. The four Looks are built in for the X100VI only. For other cameras the page
  learns them from XMPs that Lightroom has put next to the RAFs, otherwise it stays with the base profile PROVIA.
* Not checked: black-and-white toning, aspect ratios other than 3:2, Windows, Look blocks without UUID or RGBTable identifier,
  screen readers (VoiceOver, NVDA), real drives with iCloud or OneDrive.
* Checked with the new Lightroom and with Lightroom Classic 15.6 on macOS.
* Difference from the Python tool: for exposure compensation the page reads fractions such as "+1/2" as 0.5, the Python tool
  arrives at 1.0 there. This is intended, explained in `site/js/core.js` (`num`) and compensated in `test/pyref.py` for the
  comparison.
* Marker in the XMPs: the page writes `x:xmptk="raf2xmp"` and also recognizes the old marker `fuji2xmp` as its own. So far the
  Python tool knows only the old one, so an XMP from the page counts as foreign there and is backed up before it is replaced.
* The reader works with tag numbers and its own value tables, not with ExifTool's names. Renames in new ExifTool versions
  therefore cannot confuse it. It has been compared with ExifTool 13.55.
* Direct writing can be blocked from outside (company policy, a site setting, guest or profile mode). Then the page offers the ZIP
  after the run. Whoever wants the ZIP from the start chooses "lieber als ZIP".
* Not testable automatically are the real picker dialog of the browser, real dropping of folders and the permission prompts.
  Testing uses folder objects from browser storage (OPFS) and a replaced `showDirectoryPicker`.

## Contributing

* Is a Look identifier missing for your camera? There is a form under "Issues" (in English). Do not attach RAFs, JPEGs or complete
  XMPs: an XMP can contain a serial number, a place and the shooting time. Copy only the `crs:Look` block from the XMP that your own
  Lightroom wrote.
* If you want to change something, it is best to open an issue first.
* Report security problems privately: use "Report a vulnerability" in the Security tab of this repository (details in
  `SECURITY.md`, German).
* Before anything goes into a public repository, run `sh tools/preflight.sh` in the main folder. It looks for photo and raw files,
  metadata, embedded images, private paths and words, commit addresses, large files and credentials.
  `PREFLIGHT_PRIVATE_WORDS="word1 word2"` adds words that must appear nowhere (user name, street), and `PREFLIGHT_STRICT=1` turns
  missing scanners (gitleaks, trufflehog) into an error instead of a note.

### Rules for changes

None of the following goes into the page without a new review (privacy, law): upload, telemetry or error reports, share links,
service workers, IndexedDB, CDN, web fonts, widgets from Ko-fi or GitHub, Pages Web Analytics. The same goes for values derived
from the files (checksums, counters, camera or lens names): they must not leave the computer either. The test
`test/privacy.test.js` catches the crudest cases, it does not replace checking the intent.

Ko-fi stays a voluntary tip with nothing in return: no payment feature, no preferred support, no advertising, no locked updates.
Only that way does the project remain free software without commercial activity (EU Cyber Resilience Act, new product liability
law), and the sentence "voluntary, without consideration" on the page stays true.

## Trademarks

Fujifilm, X100VI and the names of the film simulations are, where protected, trademarks or designations of FUJIFILM Corporation.
Adobe, Lightroom, Lightroom Classic and XMP are trademarks or registered trademarks of Adobe in the United States and/or other
countries. This project is not affiliated with either company and is not supported, checked or endorsed by either; the names are
there only to say what the page works with. raf2xmp is an independent, private and free hobby project and is provided without
warranty. Until 3 November 2026 the project was called `fuji2xmp`.

## License

MIT, see `LICENSE`. Not covered are `site/js/looks-data.js` and `test/data/looks-public.json`: they hold Adobe-derived
identifiers (name, UUID and RGBTable ID of four Fujifilm Looks, taken from the Look files that Adobe installs with Lightroom), and
the page also works without them. ExifTool is not bundled. The tests run it as a separate program if it is installed, and the
names in the reader's tables follow ExifTool's public documentation. More on this, the origin of the identifiers and the notes on
ExifTool are in `NOTICE.md` (German).
