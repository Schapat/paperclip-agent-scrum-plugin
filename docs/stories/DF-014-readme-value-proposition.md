# DF-014: README macht Plugin-Nutzen und Bedienoberflaechen nicht frueh genug sichtbar

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Befund

Die README beschreibt Installation, Ablauf, Architektur und Grenzen umfassend.
Der konkrete Nutzen des Plugins und die sichtbaren Bedienoberflaechen sind
jedoch ueber mehrere spaetere Kapitel verteilt. Lesende muessen deshalb erst
den technischen Ablauf nachvollziehen, um zu erkennen, welche Probleme das
Plugin loest und welche Funktionen sie im Paperclip-Host vorfinden.

## Ursache

Die Einleitung erklaert das ereignisgesteuerte Scrum-Modell, fasst aber
Projektaufnahme, hostgefuehrte Lieferung, QA-Gate, Scope Guard, Transparenz und
Lernschleife nicht als fruehe, nutzerorientierte Leistungsuebersicht zusammen.

## Loesung

Eine kompakte, quellengestuetzte Nutzenuebersicht wird direkt nach der
Einleitung ergaenzt. Sie verknuepft jede Leistung mit ihrem konkreten
Operator-Nutzen und verweist fuer Installation und Ablauf auf die bestehenden
Detailkapitel.

## Akzeptanzkriterien

- Die README benennt frueh die wesentlichen Leistungen und ihren praktischen
  Nutzen: kontrollierte Projektlieferung, ereignisgesteuerter Flow,
  Qualitaets- und Scope-Gates, Transparenz, Lernschleife und
  organisationsbezogene Aktivierung.
- Jede Behauptung ist durch Manifest, Worker oder UI gedeckt und widerspricht
  keiner bekannten Einschraenkung.
- Bestehende Detaildokumentation wird nicht dupliziert oder inhaltlich
  abgeschwaecht.
- Die Dokumentationsaenderung ist im Backlog nachvollziehbar und wird vor dem
  Push gegen Test-, Typ- und Build-Checks validiert.

## Validierung

- Quellabgleich: Manifest, Worker und UI decken die sechs Managed Roles,
  organisationsbezogene Aktivierung, hostgefuehrte Projektlieferung,
  QA-Rework-Schleife, Scope Guard, manuelle Zeremonien, Agent Log und beide
  Dashboard-Widgets.
- Browser-Abgleich auf dem lokalen Scrum Board: Projektabschluss, Scope-Hold,
  Kanban mit Akzeptanzkriterien, Zeremonie-Leiste und Agent Log sind sichtbar.
- Lokaler Vitest-Runner: 21 Testdateien und 358 Tests erfolgreich.
- TypeScript-Pruefung und Produktionsbuild erfolgreich.