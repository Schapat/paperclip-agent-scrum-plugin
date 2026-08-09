# FE-010: Naechstes Feature nach Sprintabschluss im Board planen

**Klassifizierung:** Feature

**Status:** Erledigt

**Datum:** 2026-08-09

## Ziel

Nach einem abgeschlossenen Feature soll ein Human im Scrum Board eine weitere
Anforderung, etwa einen de/EN-Uebersetzungstoggle, planen koennen. Der neue
Featureauftrag darf den abgeschlossenen Darkmode-Scope nicht wieder oeffnen.

## Loesung

- Die Abschlussansicht benennt den naechsten Einstieg als **Plan next feature**.
- Beim Oeffnen des Formulars wird das zuletzt verwendete Paperclip-Projekt
  vorgewaehlt.
- Das Formular benoetigt einen Feature-Brief und optionale Constraints. Es
  startet einen neuen Technical-Lead-Analyseauftrag, gefolgt von Product-Owner-
  Backlog, Human-Freigabe, Refinement und einem neuen Sprint.
- Der bestehende Developer-Vertrag erstellt fuer das neue Feature den gemeinsamen
  `feature/{feature-id}-{short-description}`-Branch. Einzelne Tickets erzeugen
  weiterhin keinen eigenen Pull Request.

## Akzeptanzkriterien

- Nach Sprint Review und Retrospective ist **Plan next feature** im Board
  verfuegbar.
- Das Featureformular nutzt das bisherige Projekt als Vorauswahl.
- Ein Brief wie `Add a de/EN translation toggle.` erzeugt einen neuen
  Analyseauftrag mit neuer Kickoff-ID.
- Der vorige abgeschlossene Projektauftrag bleibt unveraendert.

## Validierung

- Die Worker-Regression startet nach dem Sprintabschluss erfolgreich einen
  neuen Featureauftrag mit `Add a de/EN translation toggle.`.
- Vollstaendige Vitest-Suite: 395 Tests in 23 Dateien bestanden.
- `./node_modules/.bin/tsc --noEmit`, `node ./esbuild.config.mjs` und
  `git diff --check` sind erfolgreich.