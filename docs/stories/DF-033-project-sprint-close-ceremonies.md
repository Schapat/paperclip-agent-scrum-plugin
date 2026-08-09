# DF-033: Projektabschluss laesst Sprint Review und Retrospective aus

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Wenn alle direkten Projekt-Tickets abgeschlossen waren, setzte der Worker den
Projektauftrag auf `completed`, liess den aktiven Sprint aber bestehen. Die
projektgebundene Synchronisation umgeht absichtlich die allgemeine
Ceremony-Trigger-Engine; dadurch fehlten Sprint Review und Retrospective. Der
verbliebene `currentSprint` blockierte anschliessend jeden neuen Projektauftrag.

## Loesung

- Ein vollstaendig geliefertes Projekt schliesst den zugehoerigen aktiven Sprint
  mit den vorhandenen Ceremony-Funktionen ab: zuerst Sprint Review, dann
  Retrospective.
- Der Review wird in `completedSprints` historisiert; nach der Retrospective
  wird `currentSprint` geleert.
- Die Routine heilt auch bereits gespeicherte Alt-Zustaende mit
  `projectOnboarding.status = completed` und noch aktivem Projektsprint beim
  naechsten Board-Read.
- Ceremony-Erkenntnisse bleiben im State sichtbar, erzeugen beim automatischen
  Projektabschluss jedoch keine neue Scope-Arbeit.

## Akzeptanzkriterien

- Nach dem letzten QA-abgenommenen Sprint-Ticket existieren Sprint Review und
  Retrospective im Boardverlauf.
- Der aktive Sprint wird historisiert und `currentSprint` ist `null`.
- Ein bereits abgeschlossener Auftrag mit aktivem Alt-Sprint wird beim
  Board-Read korrigiert.
- Der naechste Projektauftrag wird erst nach diesem Abschluss freigegeben.

## Validierung

- Eine Worker-Regression deckt den gespeicherten Alt-Zustand und die anschliessende
  Featureanfrage ab.
- Vollstaendige Vitest-Suite: 395 Tests in 23 Dateien bestanden.
- Lokaler ACMA-Rollout: Sprint 1 hat Sprint Review und Retrospective, der
  Boardzustand meldet `currentSprint: null` und erlaubt einen neuen Auftrag.