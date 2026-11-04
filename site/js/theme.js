// Uebernimmt die Wahl des Hell/Dunkel-Schalters von janbamba.ch (nur fuer diese Sitzung, sessionStorage).
// Ohne Wahl oder bei gesperrtem Speicher gilt die Systemeinstellung. Muss synchron im Kopf laufen, sonst blitzt die falsche Farbe auf.
(function () {
  try {
    var t = sessionStorage.getItem('theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* gesperrt, dann gilt das System */ }
})();
