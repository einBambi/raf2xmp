#!/usr/bin/env python3
"""Kleiner Entwicklungsserver: liefert site/ unter /raf2xmp/ aus (so liegt es spaeter auf janbamba.ch) und setzt dieselben
Kopfzeilen wie Cloudflare Pages aus site/_headers, damit die Seite hier schon unter der echten Content-Security-Policy laeuft."""

import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site")
ROOT = os.path.normpath(ROOT)
PORT = int(os.environ.get("PORT", "4173"))
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml"}


def rules():
    """_headers im Cloudflare-Format: Pfadmuster, darunter eingerueckte "Name: Wert"-Zeilen."""
    out = []
    cur = None
    with open(os.path.join(ROOT, "_headers"), encoding="utf-8") as fh:
        for line in fh.read().split("\n"):
            if not line.strip():
                continue
            if not line[0].isspace():
                cur = (line.strip(), [])
                out.append(cur)
            elif cur:
                k, _, v = line.strip().partition(": ")
                cur[1].append((k, v))
    return out


def matches(pattern, url):
    return url.startswith(pattern[:-1]) if pattern.endswith("*") else url == pattern


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        url = self.path.split("?", 1)[0]
        if url == "/":
            self.send_response(302)
            self.send_header("Location", "/raf2xmp/")
            self.end_headers()
            return
        rel = url[len("/raf2xmp/"):] if url.startswith("/raf2xmp/") else None
        if rel is None:
            self.send_error(404, "nicht gefunden")  # /favicon.png gibt es nur auf der echten Seite
            return
        if rel == "" or rel.endswith("/"):
            rel += "index.html"
        path = os.path.normpath(os.path.join(ROOT, rel))
        if not path.startswith(ROOT) or not os.path.isfile(path):
            self.send_error(404, "nicht gefunden")
            return
        with open(path, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(os.path.splitext(path)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for pattern, headers in rules():
            if matches(pattern, url):
                for k, v in headers:
                    self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    print("http://localhost:%d/raf2xmp/" % PORT, flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
