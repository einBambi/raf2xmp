#!/usr/bin/env python3
"""Rechnet Kameraangaben mit dem Python-Werkzeug (raf2xmp.py) durch und gibt die XMPs als JSON aus. Vergleichsstelle fuer die Tests.

Stdin:  {"cases": [{"d": {...exiftool-Dict...}, "opts": {"film": null, "neutral": false, ...}}], "db": {...profiles.json-Stil...}}
Stdout: Liste mit {"xmp", "notes", "film", "noLook"} oder {"error"}.

Zwei Abweichungen vom Werkzeug, beide gewollt: find_look ist abgeschaltet (die Seite kennt die Adobe-Dateien des Rechners nicht, nur
die mitgelieferten Kennungen), und num() liest Brueche wie "+1/2" als Bruch (Python liest dort nur die 1, siehe core.js).
Aeltere Staende des Werkzeugs schrieben noch x:xmptk="fuji2xmp", das wird unten angegelichen.
"""

import importlib.util
import json
import re
import sys
import types


def load_tool(path):
    spec = importlib.util.spec_from_file_location("raf2xmp", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def snake(k):
    return re.sub(r"([A-Z])", lambda m: "_" + m.group(1).lower(), k)


def main():
    tool = load_tool(sys.argv[1])
    job = json.load(sys.stdin)
    if "incomplete" in job:  # raf_incomplete fuer eine Liste von Pfaden
        json.dump([tool.raf_incomplete(p) for p in job["incomplete"]], sys.stdout)
        return
    db = job.get("db") or {}

    tool.find_look = lambda name, model: None

    orig_num = tool.num

    def num(v, default=0.0):
        if isinstance(v, str):
            m = re.match(r"\s*([-+]?\d+)/(\d+)", v)
            if m and int(m.group(2)) != 0:
                return int(m.group(1)) / int(m.group(2))
        return orig_num(v, default)

    tool.num = num

    out = []
    for case in job["cases"]:
        opts = types.SimpleNamespace(film=None, neutral=False, no_profile=False, wb="asshot", tone="sliders", no_lens=False,
                                     no_crop=False, no_aspect_crop=False, no_digest=False)
        for k, v in (case.get("opts") or {}).items():
            setattr(opts, snake(k), v)
        notes = []
        try:
            s, seqs, meta = tool.build_settings(case["d"], opts, db, notes)
            xmp = tool.render_xmp(s, seqs, "x.RAF", meta["look"]).replace('x:xmptk="fuji2xmp"', 'x:xmptk="raf2xmp"', 1)
            out.append({"xmp": xmp, "notes": notes, "film": meta["film"], "noLook": meta["no_look"]})
        except Exception as e:  # noqa: BLE001
            out.append({"error": "%s: %s" % (type(e).__name__, e)})
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
