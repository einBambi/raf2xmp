#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Builds a tiny synthetic Fujifilm RAF container for parser tests (proof of concept).

No photo, no serial number, no GPS, no real time stamp. Standard library only, deterministic output.

Layout (RAF header fields big endian, embedded Exif and maker note little endian):
  0x00  "FUJIFILMCCD-RAW "  (16)     0x10  "0201" (4)     0x14  camera id (8, ASCII)
  0x1C  camera name (32, NUL padded)                      0x3C  directory version (4, ASCII)
  0x40  unknown (20)
  0x54  JPEG offset, JPEG length           (u32 each)
  0x5C  meta container offset, length      (u32 each)
  0x64  CFA offset, CFA length             (u32 each)
  0x94  start of the embedded JPEG (as in real X100VI files), then the meta container, then the CFA stub
Maker note: "FUJIFILM" + u32 LE offset of the IFD (12) + IFD; out-of-line values are addressed relative to the
start of the maker note (not to the TIFF header and not to the file).
"""
import argparse
import struct

BYTE, ASCII, SHORT, LONG, RATIONAL, SBYTE, UNDEF, SSHORT, SLONG, SRATIONAL = 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
UNIT = {BYTE: 1, ASCII: 1, SHORT: 2, LONG: 4, RATIONAL: 8, SBYTE: 1, UNDEF: 1, SSHORT: 2, SLONG: 4, SRATIONAL: 8}


def be16(v): return struct.pack(">H", v)
def be32(v): return struct.pack(">I", v)
def le16(v): return struct.pack("<H", v)
def le32(v): return struct.pack("<I", v)


def pack_vals(typ, vals):
    if typ in (ASCII, UNDEF, BYTE, SBYTE):
        return vals if isinstance(vals, bytes) else bytes(vals)
    fmt = {SHORT: "<H", LONG: "<I", SSHORT: "<h", SLONG: "<i"}
    if typ in fmt:
        return b"".join(struct.pack(fmt[typ], v) for v in vals)
    ff = "<II" if typ == RATIONAL else "<ii"
    return b"".join(struct.pack(ff, n, d) for n, d in vals)


def ifd(entries, ifd_pos):
    """Little endian IFD placed at ifd_pos. Out-of-line data follows the IFD directly; offsets are counted
    from the same origin as ifd_pos. entries: (tag, type, values)."""
    entries = sorted(entries, key=lambda e: e[0])
    area = ifd_pos + 2 + 12 * len(entries) + 4
    body, data = b"", b""
    for tag, typ, vals in entries:
        raw = pack_vals(typ, vals)
        cnt = len(raw) // UNIT[typ]
        if len(raw) <= 4:
            val = raw.ljust(4, b"\0")
        else:
            if len(data) % 2:
                data += b"\0"
            val = le32(area + len(data))
            data += raw
        body += le16(tag) + le16(typ) + le32(cnt) + val
    return le16(len(entries)) + body + le32(0) + data


def maker_note():
    ent = [
        (0x0000, UNDEF, b"0130"),                 # Version
        (0x1000, ASCII, b"NORMAL\0"),             # Quality (7 bytes, so stored out of line)
        (0x1001, SHORT, [3]),                     # Sharpness
        (0x1002, SHORT, [0]),                     # WhiteBalance
        (0x1003, SHORT, [0]),                     # Saturation
        (0x100F, SLONG, [2]),                     # Clarity
        (0x1040, SLONG, [-10]),                   # ShadowTone
        (0x1041, SLONG, [20]),                    # HighlightTone
        (0x1047, SLONG, [0x40]),                  # GrainEffectRoughness
        (0x1048, SLONG, [0x40]),                  # ColorChromeEffect
        (0x104C, SLONG, [0x20]),                  # GrainEffectSize
        (0x104E, SLONG, [0x40]),                  # ColorChromeFXBlue
        (0x1400, SHORT, [0x100]),                 # DynamicRange
        (0x1401, SHORT, [0x800]),                 # FilmMode
        (0x1402, SHORT, [0x0]),                   # DynamicRangeSetting
        (0x1403, SHORT, [100]),                   # DevelopmentDynamicRange
    ]
    return b"FUJIFILM" + le32(12) + ifd(ent, 12)


def exif_tiff(mn):
    """TIFF structure of the Exif segment, little endian, IFD0 -> ExifIFD -> MakerNote."""
    ifd0_pos = 8
    ifd0 = [
        (0x010F, ASCII, b"FUJIFILM\0"),
        (0x0110, ASCII, b"X100VI\0"),
        (0x0112, SHORT, [1]),
        (0x8769, LONG, [0]),                      # patched below
    ]
    exif_pos = ifd0_pos + len(ifd(ifd0, ifd0_pos))
    exif_pos += exif_pos % 2
    ifd0 = [e if e[0] != 0x8769 else (0x8769, LONG, [exif_pos]) for e in ifd0]
    ifd0_b = ifd(ifd0, ifd0_pos)
    pad = b"\0" * (exif_pos - ifd0_pos - len(ifd0_b))
    exif_ent = [
        (0x8827, SHORT, [200]),                   # ISO
        (0x9000, UNDEF, b"0232"),                 # ExifVersion
        (0x9003, ASCII, b"2000:01:01 00:00:00\0"),  # DateTimeOriginal, fixed dummy value
        (0x9204, SRATIONAL, [(0, 10)]),           # ExposureCompensation
        (0x927C, UNDEF, mn),                      # MakerNote
        (0xA002, LONG, [8]),                      # ExifImageWidth
        (0xA003, LONG, [8]),                      # ExifImageHeight
    ]
    return b"II*\0" + le32(ifd0_pos) + ifd0_b + pad + ifd(exif_ent, exif_pos)


def gray_jpeg(app1):
    """8x8 flat mid-grey baseline JPEG with one-symbol Huffman tables; app1 = b'Exif\\0\\0' + TIFF."""
    seg = lambda marker, payload: marker + be16(len(payload) + 2) + payload
    out = b"\xff\xd8"
    out += seg(b"\xff\xe1", app1)
    out += seg(b"\xff\xdb", b"\x00" + bytes([1]) * 64)
    out += seg(b"\xff\xc0", b"\x08" + be16(8) + be16(8) + b"\x01" + b"\x01\x11\x00")
    out += seg(b"\xff\xc4", b"\x00" + bytes([1] + [0] * 15) + b"\x00")   # DC table 0: one code, symbol 0
    out += seg(b"\xff\xc4", b"\x10" + bytes([1] + [0] * 15) + b"\x00")   # AC table 0: one code, symbol 0 (EOB)
    out += seg(b"\xff\xda", b"\x01" + b"\x01\x00" + b"\x00\x3f\x00")
    out += b"\x3f"                                                       # bits 0 (DC category 0), 0 (EOB), then 1-padding
    return out + b"\xff\xd9"


def meta_container():
    """RAF directory: u32 BE entry count, then entries of u16 tag, u16 length, data (all big endian)."""
    def ent(tag, data):
        return be16(tag) + be16(len(data)) + data
    items = [
        ent(0x0100, be16(5200) + be16(7800)),      # RawImageFullSize, stored (height, width)
        ent(0x0110, be16(16) + be16(24)),          # RawImageCropTopLeft, stored (top, left)
        ent(0x0111, be16(5152) + be16(7728)),      # RawImageCroppedSize, stored (height, width)
        ent(0x0115, be16(3) + be16(2)),            # RawImageAspectRatio
        ent(0x0117, be32(1)),                      # RawZoomActive
        ent(0x0118, be16(1000) + be16(1500)),      # RawZoomTopLeft, stored (top, left)
        ent(0x0119, be16(3000) + be16(4500)),      # RawZoomSize, stored (height, width)
        ent(0x0121, be16(5152) + be16(7728)),      # RawImageSize, stored (height, width)
    ]
    return be32(len(items)) + b"".join(items)


def build():
    jpeg = gray_jpeg(b"Exif\0\0" + exif_tiff(maker_note()))
    hdr_len = 0x94
    meta = meta_container()
    meta_off = (hdr_len + len(jpeg) + 15) // 16 * 16
    cfa = b"II*\0" + le32(8) + le16(0) + le32(0) + b"\0" * 16          # empty TIFF as stand-in for the raw section
    cfa_off = (meta_off + len(meta) + 15) // 16 * 16
    h = bytearray(hdr_len)
    h[0:16] = b"FUJIFILMCCD-RAW "
    h[16:20] = b"0201"
    h[20:28] = b"SYNTHFIX"
    h[28:60] = b"X100VI".ljust(32, b"\0")
    h[60:64] = b"0100"
    h[84:108] = b"".join(be32(v) for v in (hdr_len, len(jpeg), meta_off, len(meta), cfa_off, len(cfa)))
    blob = bytes(h) + jpeg
    blob += b"\0" * (meta_off - len(blob)) + meta
    blob += b"\0" * (cfa_off - len(blob)) + cfa
    return blob


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    a = ap.parse_args()
    data = build()
    with open(a.out, "wb") as fh:
        fh.write(data)
    print("%s: %d bytes" % (a.out, len(data)))
