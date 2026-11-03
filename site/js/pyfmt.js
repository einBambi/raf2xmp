// Kleine Helfer, die sich so verhalten wie die Python-Vorlage, damit beide Fassungen
// Zeichen fuer Zeichen dieselbe XMP schreiben. JavaScript rundet und formatiert an ein paar Stellen anders als Python.

// Python round(): genau halbe Werte gehen zur geraden Zahl (Math.round rundet 6.5 auf 7, Python auf 6).
export function pyRound(x) {
  if (!Number.isFinite(x)) throw new RangeError("round() von " + x);
  const f = Math.floor(x);
  const d = x - f; // exakt, solange |x| unter 2^52 liegt, darueber ist x schon ganzzahlig
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

// Python "%.Nf": exakt auf dem Wert der Gleitkommazahl gerundet, halbe Werte zur geraden Stelle (toFixed rundet sie auf).
export function pyFixed(x, n) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x < 0 ? "-inf" : "inf";
  const neg = x < 0 || Object.is(x, -0);
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  let top = mant * 10n ** BigInt(n);
  let den = 1n;
  if (e >= 0) top <<= BigInt(e);
  else den <<= BigInt(-e);
  let q = top / den;
  const twice = (top % den) * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  let s = q.toString();
  if (n > 0) {
    s = s.padStart(n + 1, "0");
    s = s.slice(0, -n) + "." + s.slice(-n);
  }
  return (neg ? "-" : "") + s;
}

// Python "%+g" (sechs gueltige Stellen), nur fuer die Hinweise gebraucht
export function pyPlusG(x) {
  if (x === 0) return Object.is(x, -0) ? "-0" : "+0";
  let s = Number(x.toPrecision(6)).toString();
  if (/e/.test(s)) s = x.toPrecision(6);
  return (x > 0 ? "+" : "") + s;
}

// xml.sax.saxutils.quoteattr: Anfuehrungszeichen waehlen und Steuerzeichen als Zeichenverweise schreiben
export function quoteattr(data) {
  let s = String(data).replace(/&/g, "&amp;").replace(/>/g, "&gt;").replace(/</g, "&lt;");
  s = s.replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;");
  if (s.includes('"')) {
    if (s.includes("'")) return '"' + s.replace(/"/g, "&quot;") + '"';
    return "'" + s + "'";
  }
  return '"' + s + '"';
}

// Python math.radians/degrees rechnen mit einer vorab gebildeten Konstante, nicht mit x * 180 / pi
export const radians = (x) => x * (Math.PI / 180);
export const degrees = (x) => x * (180 / Math.PI);

// Python int() auf eine Gleitkommazahl: zur Null hin abschneiden, als Text ohne "-0"
export const istr = (x) => String(Math.trunc(x) + 0);
