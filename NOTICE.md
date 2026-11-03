# Hinweise zu Lizenz und Herkunft

## Lizenz des Projekts

Der Quelltext von raf2xmp steht unter der MIT-Lizenz (`LICENSE`, Copyright (c) 2026 Jan Bambach). Ausgenommen sind die beiden
Dateien im nächsten Abschnitt.

## Nicht unter der Projektlizenz: Kennungen aus Adobe-Dateien

Diese beiden Dateien fallen nicht unter die MIT-Lizenz des Projekts:

* `site/js/looks-data.js`
* `test/data/looks-public.json`

Beide enthalten nur Namen und technische Kennungen der vier Fujifilm-Looks Classic Neg., Nostalgic Neg., Bleach Bypass und Sepia
der X100VI: Look-Name, UUID, RGBTable-Kennung, Basisprofil und Kamera. Sie sind aus den Look-Dateien (.xmp) abgeleitet, die Adobe
mit Lightroom installiert (unter macOS im Ordner `/Library/Application Support/Adobe/CameraRaw/Settings/Adobe/Profiles/Camera/Fujifilm`).
Quelle und Datum stehen im Kopf von `site/js/looks-data.js`, erzeugt hat die Datei `tools/make_looks.py`. Es sind dieselben
Angaben, die Lightroom selbst in jede XMP schreibt, sobald ein Look auf ein Foto angewendet wird. Tabellendaten, Profile und
Voreinstellungen von Adobe sind nicht enthalten, und das Projekt liefert keine aus.

Die Projektlizenz räumt an diesen Angaben nichts ein. Ob und welche Rechte daran bestehen, richtet sich nach den Bedingungen von
Adobe und nach dem geltenden Recht. Wer die Dateien weiterverwendet, prüft das für sich selbst.

Die Seite braucht `looks-data.js` nicht zum Laufen: Mit einer leeren Liste (`export const LOOKS = [];`) läuft sie weiter, die
vier Looks fallen dann auf das Basisprofil PROVIA zurück. Für andere Kameras lernt die Seite die Kennungen zur Laufzeit aus XMPs,
die Lightroom im gewählten Ordner abgelegt hat, und behält sie nur im Arbeitsspeicher für diesen einen Lauf.

Außerdem verwendet der Kern (`site/js/core.js`) die Profilnamen, die Lightroom in XMPs erwartet, zum Beispiel
`Camera PROVIA/Standard`. Das sind Bezeichnungen, die Lightroom beim Öffnen einer XMP selbst auflöst, keine Profile.

## ExifTool

Die Bezeichnungen in den Lesetabellen von `site/js/reader.js` (Schlüssel wie `FujiFilm:FilmMode` und die Wertetexte, zum
Beispiel „Classic Negative“) stammen aus der öffentlichen Dokumentation von ExifTool (Tag-Namen zu FujiFilm und RAF), ebenso die
Beschreibung des Dateiaufbaus. Außerdem folgt die Schreibweise der Belichtungskorrektur (zum Beispiel „+1/2“ oder „-0.67“) der
Ausgabe von ExifTool, damit der Vergleich in den Tests zeichengleich ausfällt. Die Funktion `printFraction` in derselben Datei
ist eine eigene Umsetzung. Ob ihre Ausgabe der von ExifTool entspricht, prüft `test/reader-synth.test.js`.

ExifTool von Phil Harvey ist freie Software unter denselben Bedingungen wie Perl (Artistic License oder GPL, nach Wahl), siehe
<https://exiftool.org/>. Das Projekt liefert ExifTool nicht mit. In den Tests läuft es, falls es installiert ist, als eigenes
Programm zum Vergleich.

## Weitere Herkunft

* Der Rechenkern `site/js/core.js` ist eine Zeile-für-Zeile-Übertragung des Python-Werkzeugs von Jan Bambach (bisher unter dem
  Namen `fuji2xmp`, gehört nicht zu diesem Repository). Deshalb erkennt die Seite neben ihrer eigenen Kennung `x:xmptk="raf2xmp"`
  auch die alte `fuji2xmp`.
* Das Projekt bindet keine Pakete, Schriftdateien oder Skripte von Dritten ein, weder zur Laufzeit noch in den Tests.
* Die Prüfstücke (`test/synth.js` und `test/fixtures/SYNTH0001.RAF`) sind vollständig erfunden: keine Fotos, keine
  Seriennummern, keine Orte.

## Marken

Fujifilm, X100VI und die Namen der Filmsimulationen sind, soweit geschützt, Marken oder Bezeichnungen der FUJIFILM Corporation.
Adobe, Lightroom, Lightroom Classic und XMP sind Marken oder eingetragene Marken von Adobe in den Vereinigten Staaten und/oder
anderen Ländern. raf2xmp ist ein unabhängiges Projekt, steht in keiner Verbindung zu den beiden und wird von keinem von ihnen
unterstützt, geprüft oder empfohlen. Die Namen stehen nur da, um zu beschreiben, womit das Werkzeug arbeitet.
