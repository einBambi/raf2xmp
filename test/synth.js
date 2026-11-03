// Baut kleine, vollstaendig erfundene Fujifilm-RAFs fuer die Tests: eine graue 8x8-Vorschau, die Exif-Angaben, die
// Herstellernotiz, das RAF-Verzeichnis und das Fuji-IFD. Keine echten Aufnahmen, keine Seriennummern, keine Orte.
// So ein RAF ist rund 2 KB gross und liest sich mit ExifTool und mit dem Reader der Seite genauso wie ein echtes.

// Der Rest einer winzigen grauen JPEG-Datei ohne den Anfang SOI (JFIF, Tabellen, ein Block, EOI)
const JPEG_TAIL = Uint8Array.from(Buffer.from(
  "/+AAEEpGSUYAAQEAAAEAAQAA/9sAQwAQCwwODAoQDg0OEhEQExgoGhgWFhgxIyUdKDozPTw5Mzg3QEhcTkBEV0U3OFBtUVdfYmdoZz5NcXlwZHhcZWdj/8AACwgACAAIAQERAP/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAgBAQAAPwAr/9k=",
  "base64"));

export const T = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, SBYTE: 6, UNDEF: 7, SSHORT: 8, SLONG: 9, SRATIONAL: 10, IFD: 13 };
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 13: 4 };

// Werte eines Eintrags als Bytes: ASCII als Text, UNDEF als Bytefeld, sonst als Zahlenliste (Bruch: Zaehler, Nenner, Zaehler, ...)
function pack(type, values, le) {
  if (type === T.ASCII) return Uint8Array.from([...Buffer.from(String(values), "utf8"), 0]);
  if (type === T.UNDEF && values instanceof Uint8Array) return values;
  const list = Array.isArray(values) ? values : [values];
  const out = new Uint8Array(list.length * (type === T.RATIONAL || type === T.SRATIONAL ? 4 : SIZE[type]));
  const dv = new DataView(out.buffer);
  const unit = type === T.RATIONAL || type === T.SRATIONAL ? 4 : SIZE[type];
  list.forEach((v, i) => {
    const o = i * unit;
    switch (type) {
      case T.BYTE: case T.UNDEF: dv.setUint8(o, v); break;
      case T.SBYTE: dv.setInt8(o, v); break;
      case T.SHORT: dv.setUint16(o, v, le); break;
      case T.SSHORT: dv.setInt16(o, v, le); break;
      case T.LONG: case T.IFD: case T.RATIONAL: dv.setUint32(o, v, le); break;
      case T.SLONG: case T.SRATIONAL: dv.setInt32(o, v, le); break;
      default: throw new Error("Typ " + type);
    }
  });
  return out;
}

const countOf = (type, bytes) => (type === T.RATIONAL || type === T.SRATIONAL ? bytes.length / 8 : bytes.length / SIZE[type]);

// Ein IFD: Zaehler, Eintraege, Folge-IFD 0. Werte ueber 4 Bytes landen ueber alloc(bytes) im Datenbereich (alloc gibt den Offset zurueck).
function ifdBytes(entries, le, alloc) {
  const out = new Uint8Array(2 + 12 * entries.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, entries.length, le);
  entries.forEach(([tag, type, values], i) => {
    const p = 2 + 12 * i;
    const bytes = pack(type, values, le);
    dv.setUint16(p, tag, le);
    dv.setUint16(p + 2, type, le);
    dv.setUint32(p + 4, countOf(type, bytes), le);
    if (bytes.length <= 4) out.set(bytes, p + 8);
    else dv.setUint32(p + 8, alloc(bytes), le);
  });
  return out;
}

class Area {
  constructor(base) { this.base = base; this.parts = []; this.len = 0; }
  alloc(bytes) {
    const off = this.base + this.len;
    this.parts.push(bytes);
    this.len += bytes.length;
    if (this.len % 2) { this.parts.push(new Uint8Array(1)); this.len += 1; }
    return off;
  }
}

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// Eine TIFF-Struktur aus IFD0 (und optional einem zweiten IFD, auf das IFD0 mit linkTag zeigt)
function tiff(le, ifd0Entries, linkTag, ifd1Entries) {
  const n0 = ifd0Entries.length + (ifd1Entries ? 1 : 0);
  const size0 = 2 + 12 * n0 + 4;
  const size1 = ifd1Entries ? 2 + 12 * ifd1Entries.length + 4 : 0;
  const area = new Area(8 + size0 + size1);
  const e0 = ifd1Entries ? [...ifd0Entries, [linkTag, T.LONG, 8 + size0]] : ifd0Entries;
  e0.sort((a, b) => a[0] - b[0]);
  const head = Uint8Array.from(le ? [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0] : [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8]);
  const parts = [head, ifdBytes(e0, le, (b) => area.alloc(b))];
  if (ifd1Entries) parts.push(ifdBytes([...ifd1Entries].sort((a, b) => a[0] - b[0]), le, (b) => area.alloc(b)));
  return concat([...parts, ...area.parts]);
}

// Herstellernotiz (immer little endian, Offsets vom Anfang der Notiz)
function makerNote(entries) {
  const size = 12 + 2 + 12 * entries.length + 4;
  const area = new Area(size);
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  const ifd = ifdBytes(sorted, true, (b) => area.alloc(b));
  const head = Uint8Array.from([...Buffer.from("FUJIFILM"), 12, 0, 0, 0]);
  return concat([head, ifd, ...area.parts]);
}

const be16 = (v) => [(v >> 8) & 255, v & 255];
const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

// Das RAF-Verzeichnis: Anzahl, dann je Eintrag Kennung, Laenge, Bytes (alles big endian)
function rafDirectory(entries) {
  return Uint8Array.from([...be32(entries.length), ...entries.flatMap(([tag, bytes]) => [...be16(tag), ...be16(bytes.length), ...bytes])]);
}

export const pair16 = (a, b) => [...be16(a), ...be16(b)]; // zwei 16-Bit-Zahlen (im RAF-Verzeichnis steht die Hoehe zuerst)
export const u32 = be32;

// Typische Angaben einer X100VI im Farbmodus (Werte frei erfunden, aber im Bereich echter Aufnahmen)
export function defaults() {
  return {
    make: "FUJIFILM", model: "X100VI", orientation: 1, iso: 200, expComp: [-33, 100], exifW: 4416, exifH: 2944,
    maker: [
      [0x1001, T.SHORT, 0x82], [0x1002, T.SHORT, 0xff0], [0x1003, T.SHORT, 0xe0], [0x1005, T.SHORT, 6500],
      [0x100a, T.SLONG, [-1200, 800]], [0x100b, T.SHORT, 0x100], [0x100e, T.SHORT, 0x2e0], [0x100f, T.SLONG, -3000],
      [0x1040, T.SLONG, 16], [0x1041, T.SLONG, 32], [0x1047, T.SLONG, 32], [0x1048, T.SLONG, 32], [0x104c, T.SHORT, 32],
      [0x104e, T.SLONG, 32], [0x1401, T.SHORT, 0x800], [0x1403, T.SHORT, 100],
    ],
    rafDir: [
      [0x100, pair16(5196, 7872)], [0x110, pair16(21, 12)], [0x111, pair16(5152, 7728)], [0x115, pair16(2, 3)], [0x117, u32(0)],
      [0x118, pair16(0, 0)], [0x119, pair16(0, 0)],
    ],
    vignetting: true,
    rawBytes: 64,
  };
}

// spec: wie defaults(). Fehlende Felder fehlen auch im RAF (undefined/null entfernt sie).
export function buildRaf(spec) {
  const s = spec;
  const ifd0 = [];
  if (s.make != null) ifd0.push([0x010f, T.ASCII, s.make]);
  if (s.model != null) ifd0.push([0x0110, T.ASCII, s.model]);
  if (s.orientation != null) ifd0.push([0x0112, T.SHORT, s.orientation]);
  const exif = [];
  if (s.iso != null) exif.push([0x8827, T.SHORT, s.iso]);
  if (s.expComp != null) exif.push([0x9204, T.SRATIONAL, s.expComp]);
  if (s.exifW != null) exif.push([0xa002, T.LONG, s.exifW]);
  if (s.exifH != null) exif.push([0xa003, T.LONG, s.exifH]);
  if (s.maker != null) exif.push([0x927c, T.UNDEF, makerNote(s.maker)]);
  const exifTiff = tiff(true, ifd0, 0x8769, exif);
  const app1Len = 2 + 6 + exifTiff.length;
  const jpeg = s.noJpeg ? new Uint8Array(0) : concat([Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, ...be16(app1Len), 0x45, 0x78, 0x69, 0x66, 0, 0]), exifTiff, JPEG_TAIL]);

  const dir = rafDirectory(s.rafDir || []);
  const sub = [[0xf001, T.LONG, 7872], [0xf002, T.LONG, 5196], [0xf003, T.LONG, 14]];
  if (s.vignetting) sub.push([0xf010, T.SRATIONAL, [515, 1, 3, 10, 5, 10, 6, 10]]);
  const subArea = new Area(0x1a + 2 + 12 * sub.length + 4);
  const subIfd = ifdBytes(sub, true, (b) => subArea.alloc(b));
  const cfaHead = concat([Uint8Array.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]), ifdBytes([[0xf000, T.IFD, 0x1a]], true, () => 0), subIfd, ...subArea.parts]);
  const cfa = concat([cfaHead, new Uint8Array(s.rawBytes ?? 64)]);

  const header = new Uint8Array(0x94);
  header.set(Buffer.from("FUJIFILMCCD-RAW 0201FF392501"), 0);
  header.set(Buffer.from(s.headerModel ?? s.model ?? "X100VI"), 0x1c);
  header.set(Buffer.from("0131"), 0x3c);
  const jOff = 0x94;
  const dOff = jOff + jpeg.length;
  const cOff = dOff + dir.length;
  const put = (o, v) => header.set(be32(v), o);
  if (!s.noJpeg) { put(0x54, jOff); put(0x58, jpeg.length); }
  put(0x5c, dOff); put(0x60, dir.length);
  put(0x64, cOff); put(0x68, cfa.length);
  return concat([header, jpeg, dir, cfa]);
}
