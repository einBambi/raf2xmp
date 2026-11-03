# Sicherheit

raf2xmp läuft komplett im Browser und liest nur Dateien, die du selbst auswählst. Fehler kann es trotzdem geben. Besonders
wichtig wären zum Beispiel:

* Die Seite verbindet sich doch irgendwohin oder speichert etwas im Browser (die Zusagen stehen im README).
* Eine präparierte RAF, XMP oder ein besonderer Dateiname bringt die Seite dazu, Skripte auszuführen oder außerhalb des gewählten
  Ordners zu schreiben.
* Eine vorhandene .xmp wird ersetzt, ohne dass vorher eine Sicherung angelegt wurde.
* Ein erzeugtes ZIP landet beim Entpacken an einem falschen Ort.

## So meldest du etwas

Bitte melde Sicherheitslücken nicht als öffentliches Issue. Nutze auf GitHub den Reiter „Security“ und dort „Report a
vulnerability“, das ist eine private Meldung. Ist sie dir nicht zugänglich, eröffne ein Issue ohne Einzelheiten und bitte darin
um einen privaten Weg.

Hänge bitte keine eigenen Fotos oder vollständigen XMPs an, darin können Seriennummern, Orte und Aufnahmezeiten stehen. Eine winzige
erfundene Datei, die das Problem zeigt, reicht völlig (`tools/make_fixtures.py` baut so eine).

## Wer das pflegt

Das Projekt ist ein privates Hobbyprojekt, es gibt keine feste Antwortzeit. Gepflegt wird der jeweils aktuelle Stand auf `main`
und die Seite unter <https://www.janbamba.ch/raf2xmp/>.
