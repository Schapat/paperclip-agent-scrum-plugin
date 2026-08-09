# DF-023: Lokale und Legacy-Done-Tickets ohne vollstaendig verifizierte Akzeptanzkriterien erneut zur QA geben

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Fehlerbild

Nach dem Update von DF-021 zeigte das Live-Board weiterhin lokale beziehungsweise
Legacy-Karten in der Spalte Done mit offenen Kriterien, beispielsweise `0/6 AC`,
`3/5 AC` oder `0/7 AC`. Diese Karten waren nicht direkte Child-Issues des aktiven
Projekt-Kickoffs und durchliefen deshalb nicht den Host-Completion-Gate.

## Ursache

Der lokale QA-Review prueft Akzeptanzkriterien beim regulaeren Review korrekt.
Persistierte Board-Zustaende wurden beim Laden jedoch nur normalisiert und nicht
gegen die Done-Regel abgeglichen. Das betraf sowohl offene Kriterien als auch
unverfeinerte Tickets ohne kanonisch gespeicherte Kriterien. Ausserdem konnte die
generische lokale Lifecycle-API einen manuellen `in_review`-nach-`done`-Uebergang
ohne erneute Kriterienpruefung ausfuehren.

## Loesung

- Nach der Team-Reconciliation prueft der Worker lokale Done-Karten mit
  Akzeptanzkriterien erneut.
- Fehlen Kriterien oder hat mindestens ein Kriterium den Status offen, wird die
  Karte nach `in_review` zurueckgesetzt, QA zugewiesen, der Abschlusszeitpunkt
  geloescht und ein nachvollziehbarer Kommentar sowie eine Review-Entscheidung
  erfasst.
- Direkte Projekt-Child-Issues bleiben von dieser lokalen Reconciliation
  ausgenommen; sie werden durch den Host-Completion-Gate aus DF-021 gesteuert.
- Der lokale Lifecycle blockiert neue `in_review`-nach-`done`-Uebergaenge,
  solange vorhandene Kriterien offen sind.
- Vollstaendig gruen verifizierte lokale Done-Karten bleiben unveraendert.

## Akzeptanzkriterien

- Eine persistierte lokale Done-Karte mit offenen oder fehlenden Kriterien
  erscheint nach dem ersten Board-Laden wieder in Review und ist QA zugewiesen.
- Der Ticketverlauf dokumentiert die Rueckgabe wegen fehlender
  Kriterienverifikation.
- Ein manueller lokaler Done-Uebergang mit offenen oder fehlenden Kriterien wird
  abgelehnt.
- Vollstaendig gruen verifizierte lokale Done-Karten bleiben unveraendert.

## Validierung

- Worker-Regressionstest fuer eine persistierte lokale Done-Karte mit `1/2`
  erfuellten Kriterien erfolgreich.
- Worker-Regressionstests fuer eine persistierte lokale Done-Karte ohne
  Kriterien sowie fuer eine vollstaendig verifizierte Done-Karte erfolgreich.
- Lifecycle-Regressionstest blockiert `Review -> Done` bei einem offenen
  oder fehlenden Kriterium erfolgreich.
- Die fokussierten Regressionstests bestehen.
- Gesamtsuite: 23 Testdateien und 384 Tests erfolgreich; `tsc --noEmit` und
  der Produktionsbuild sind erfolgreich.
- Lokale Plugin-Aktualisierung und Health-Check erfolgreich (`ready`). Die
  zuvor in Done sichtbare Karte `#396e0617` erscheint nach dem Board-Reload in
  Review; die Spalten zeigen danach 2 Done- und 5 Review-Karten.