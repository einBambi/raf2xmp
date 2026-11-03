#!/usr/bin/env python3
"""Baut site/js/looks-data.js aus den Look-Dateien, die Adobe mit Lightroom/Camera Raw installiert.

Aus jeder Datei (PresetType="Look") werden nur Namen und Kennungen gelesen: Look-Name, UUID, RGBTable-Kennung, Basisprofil,
Kamera. Keine Tabellendaten, keine Profile, keine Voreinstellungen. Es ist dieselbe Handvoll Kennungen, die Lightroom in jede
XMP schreibt, sobald der Look auf ein Foto angewendet wurde.

    python3 tools/make_looks.py --models X100VI
    python3 tools/make_looks.py --models X100VI --python-json test/data/looks-public.json   # dieselben Daten fuer den Python-Vergleich
"""

import argparse
import datetime
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DEFAULT_ADOBE = "/Library/Application Support/Adobe/CameraRaw/Settings/Adobe/Profiles/Camera/Fujifilm"


def load_tool(path):
    spec = importlib.util.spec_from_file_location("fuji2xmp", str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--adobe", default=DEFAULT_ADOBE, help="Ordner Camera/Fujifilm der Adobe-Installation")
    ap.add_argument("--tool", default=str(ROOT.parent / "fuji2xmp" / "fuji2xmp.py"), help="Pfad zu fuji2xmp.py (fuer parse_look_preset)")
    ap.add_argument("--models", default="X100VI", help="Kameras, kommagetrennt (Schreibweise egal), oder 'alle'")
    ap.add_argument("--out", default=str(ROOT / "site" / "js" / "looks-data.js"))
    ap.add_argument("--python-json", help="zusaetzlich eine profiles.json im Stil des Python-Werkzeugs schreiben (nur fuer Tests)")
    opts = ap.parse_args()

    tool = load_tool(opts.tool)
    want = None if opts.models.lower() == "alle" else {tool.norm_model(m) for m in opts.models.split(",") if m.strip()}
    found = {}
    for f in sorted(Path(opts.adobe).rglob("*.xmp")):
        p = tool.parse_look_preset(f)
        if not p or p["name"] not in tool.LOOK_NAMES:
            continue
        if want is not None and tool.norm_model(p["model"]) not in want:
            continue
        found[(p["model"], p["name"])] = p
    if not found:
        sys.exit("keine passenden Look-Dateien unter %s" % opts.adobe)

    order = {n: i for i, n in enumerate(sorted(tool.LOOK_NAMES))}
    rows = sorted(found.values(), key=lambda p: (tool.norm_model(p["model"]), p["model"], order[p["name"]]))
    lines = [
        "// Erzeugt von tools/make_looks.py, nicht von Hand aendern.",
        "// Nur Namen und Kennungen der vier Fuji-Looks je Kamera, wie sie Lightroom in jede XMP schreibt. Keine Tabellen, keine Profildaten.",
        "// Quelle: die Look-Dateien (.xmp), die Adobe mit Lightroom installiert, gelesen aus",
        "// %s am %s." % (opts.adobe, datetime.date.today().isoformat()),
        "// Das sind Adobe-nahe Angaben und gehoeren nicht zur Projektlizenz. Bleibt die Liste leer, laeuft die Seite weiter, die Looks fallen",
        "// dann auf das Basisprofil PROVIA zurueck, ausser die Kennungen werden aus XMPs im Ordner gelernt.",
        "export const LOOKS = [",
    ]
    for p in rows:
        lines.append("  " + json.dumps({k: p[k] for k in ("model", "name", "uuid", "table", "profile", "group", "gray", "amount", "mono", "outref")},
                                         ensure_ascii=False) + ",")
    lines.append("];")
    Path(opts.out).write_text("\n".join(lines) + "\n", "utf-8")
    print("%d Looks fuer %d Kameras nach %s" % (len(rows), len({p["model"] for p in rows}), opts.out))

    if opts.python_json:
        db = {}
        for p in rows:
            look = tool.render_look(dict(p, version=tool.LOOK_VERSION[0], process=tool.LOOK_VERSION[1]))
            db[p["name"]] = {"profile": p["profile"], "grayscale": p["gray"] == "True", "model": p["model"], "look": look}
        Path(opts.python_json).parent.mkdir(parents=True, exist_ok=True)
        Path(opts.python_json).write_text(json.dumps(db, indent=1, ensure_ascii=False) + "\n", "utf-8")
        print("Python-Fassung (je Name nur eine Kamera) nach %s" % opts.python_json)


if __name__ == "__main__":
    main()
