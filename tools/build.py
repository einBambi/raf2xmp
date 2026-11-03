#!/usr/bin/env python3
"""Baut aus site/ ein ausrollbares Verzeichnis: dieselben Dateien, aber mit einer Versionskennung hinter jedem Dateinamen.

Hintergrund: Cloudflare (und der Browser) halten .js und .css gern mehrere Tage vor. Ohne Kennung kaeme nach einem Update ein
Gemisch aus alten und neuen Modulen zusammen. Mit Kennung (?v=...) ist jede Fassung eine eigene Adresse. Die Kennung ist ein
Hash ueber alle Dateien, aendert sich also genau dann, wenn sich etwas aendert.

    python3 tools/build.py --out dist          ergibt dist/raf2xmp/ und dist/_headers
"""

import argparse
import hashlib
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
MARKER = ".gebaut-von-raf2xmp"
PREFIX = "raf2xmp"  # Unterverzeichnis der Seite auf janbamba.ch

# from "./x.js"   import "./x.js"   (andere Importformen gibt es im Code nicht, der Test sichert das ab)
IMPORT = re.compile(r'''((?:\bfrom|\bimport)\s*)(["'])(\.{1,2}/[^"']+?\.js)\2''')
DYNAMIC = re.compile(r"\bimport\s*\(")


def version(files):
    h = hashlib.sha256()
    for rel in sorted(files):
        h.update(rel.encode("utf-8") + b"\0" + (SITE / rel).read_bytes() + b"\0")
    return h.hexdigest()[:10]


def stamp_js(text, v, rel):
    if DYNAMIC.search(text):
        raise SystemExit(f"{rel}: dynamischer Import, den die Kennung nicht erfasst")
    return IMPORT.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={v}{m.group(2)}", text)


def stamp_html(text, v):
    # nur die eigenen Dateien der Seite, keine Links nach draussen
    def one(m):
        url = m.group(2)
        if re.match(r"^(?:[a-z]+:)?//|^/|^#", url) or "?" in url:
            return m.group(0)
        return f"{m.group(1)}{url}?v={v}\""
    return re.sub(r'((?:href|src)=")([^"]+\.(?:css|js))"', one, text)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="Zielverzeichnis, wird neu angelegt")
    args = ap.parse_args()
    out = Path(args.out).resolve()

    if out.exists():
        if not (out / MARKER).exists() and any(out.iterdir()):
            raise SystemExit(f"{out} gehoert nicht zu diesem Werkzeug (Markierung fehlt), wird nicht geleert")
        shutil.rmtree(out)
    target = out / PREFIX
    target.mkdir(parents=True)
    (out / MARKER).write_text("von tools/build.py angelegt, darf geleert werden\n", encoding="utf-8")

    files = [p.relative_to(SITE).as_posix() for p in SITE.rglob("*") if p.is_file() and not p.name.startswith(".")]
    deploy = [f for f in files if f != "_headers"]
    v = version(deploy)

    for rel in deploy:
        src = SITE / rel
        dst = target / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if rel.endswith(".js"):
            dst.write_text(stamp_js(src.read_text(encoding="utf-8"), v, rel), encoding="utf-8")
        elif rel == "index.html":
            dst.write_text(stamp_html(src.read_text(encoding="utf-8"), v), encoding="utf-8")
        else:
            shutil.copyfile(src, dst)

    headers = SITE / "_headers"
    if headers.exists():
        shutil.copyfile(headers, out / "_headers")

    print(f"Version {v}, {len(deploy)} Dateien nach {target}")


if __name__ == "__main__":
    sys.exit(main())
