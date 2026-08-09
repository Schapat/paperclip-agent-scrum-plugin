# DF-021: Done-Tickets nur mit vollstaendig verifizierten Akzeptanzkriterien zulassen

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Fehlerbild

Ein projektgebundenes Ticket konnte auf `done` stehen, obwohl die Kanban-Karte
offene Akzeptanzkriterien zeigte, zum Beispiel `1/4 AC`. Der sichtbare
Widerspruch entstand, obwohl das Ticket bereits durch QA bearbeitet worden war.

## Ursache

Der Completion-Gate pruefte den GitHub-Commit-Nachweis und den
`qa-review-approved`-Marker. Die aus QA-Kommentaren projektierte Liste der
Akzeptanzkriterien wurde jedoch nicht als Voraussetzung fuer `done` ausgewertet.
Der Board zeigte daher korrekt offene Kriterien, waehrend der Host-Status
gleichzeitig `done` blieb.

## Loesung

- Der Completion-Gate bildet Commit-Nachweise und Akzeptanzkriterien aus
  derselben kanonischen Kommentarprojektion.
- Gibt es Akzeptanzkriterien und mindestens eines ist nicht als erfuellt
  verifiziert, setzt der Worker das Ticket auf `in_review`, weist es QA zu,
  hinterlegt einen nachvollziehbaren Kommentar und weckt QA erneut auf.
- Tickets ohne Akzeptanzkriterien behalten das bisherige Abschlussverhalten.
- Die QA-Anweisung verlangt fuer jedes Kriterium eine eigene Markdown-Checkbox
  mit dem Kriteriumstext, bevor der Freigabemarker und `done` gesetzt werden.
- Die bestehende Board-Reconciliation prueft auch bereits gespeicherte
  Done-Tickets beim naechsten Laden des Boards und korrigiert sie nach Review.

## Akzeptanzkriterien

- Ein Ticket mit Akzeptanzkriterien bleibt nur dann auf `done`, wenn QA jedes
  Kriterium als erfuellt dokumentiert hat.
- Ein QA-Freigabemarker allein reicht bei offenen Kriterien nicht aus.
- Ein bereits vorhandenes, inkonsistentes Done-Ticket wird beim naechsten
  Laden des Boards nach `in_review` zurueckgefuehrt.
- Tickets ohne Akzeptanzkriterien bleiben mit einem gueltigen QA-Abschluss
  kompatibel.

## Validierung

- Regressionstest fuer einen QA-markierten Abschluss mit einer unvollstaendigen
  Kriterienliste: Ticket wird nach `in_review` zurueckgegeben.
- Regressionstest fuer denselben Altfall nach Worker-Neustart und erstem
  Board-Laden: Ticket und Board zeigen `in_review`.
- Fokussierte Tests: 42 Tests in zwei Testdateien erfolgreich.
- Gesamtsuite: 22 Testdateien und 376 Tests erfolgreich.
- `tsc --noEmit` und der Produktionsbuild sind erfolgreich.