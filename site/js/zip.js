// Ein ZIP-Archiv ohne Kompression (Methode "stored") im Browser bauen, fuer Browser ohne Schreibzugriff auf Ordner.
// Die XMPs sind nur ein paar KB gross, Kompression braeuchte nur Code. Keine ZIP64-Erweiterung: bis 65535 Dateien, je unter 4 GB.

export const ZIP_MAX_FILES = 60000;

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// DOS-Datum und -Uhrzeit in Ortszeit (ZIP kennt nichts anderes), gerade Sekunden, ab 1980
function dosTime(date) {
  const y = Math.max(1980, date.getFullYear());
  return {
    date: ((y - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
  };
}

// items: [{path, data (Uint8Array oder Text), mtime (Date, optional)}] -> Blob
export function buildZip(items, now = new Date()) {
  if (items.length > ZIP_MAX_FILES) throw new RangeError("zu viele Dateien fuer ein ZIP: " + items.length);
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const it of items) {
    const name = enc.encode(it.path);
    const data = typeof it.data === "string" ? enc.encode(it.data) : it.data;
    const { date, time } = dosTime(it.mtime || now);
    const crc = crc32(data);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true); // noetige Version
    lh.setUint16(6, 0x0800, true); // Namen sind UTF-8
    lh.setUint16(8, 0, true); // stored
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true); // erzeugt mit (DOS, damit Entpacker keine Unix-Rechte erwarten)
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);

    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, items.length, true);
  end.setUint16(10, items.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}
