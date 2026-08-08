# FE-003: Geblockte Tickets als Abschnitt in der Backlog-Spalte

**Klassifizierung:** Feature

**Status:** Erledigt

**Datum:** 2026-08-09

## Ziel

Geblockte Tickets sollen im Scrum Board sichtbar sein, ohne eine sechste
Workflow-Spalte zu erzeugen. Sie teilen sich deshalb die Backlog-Spalte mit
normalen Backlog-Tickets, bleiben aber durch einen roten Abschnitt
„Blockiert“ und eine Anzahl eindeutig erkennbar.

## Akzeptanzkriterien

- Ein Ticket mit Status `blocked` erscheint in der Backlog-Spalte.
- Backlog- und Blocker-Tickets bleiben fachlich getrennt; ihr Status wird nicht
  verändert.
- Aktive, Review- und Done-Tickets erscheinen nicht im gemeinsamen Abschnitt.
- Die Blockerübersicht erscheint nur, wenn mindestens ein Ticket blockiert ist.
- Bestehende Detailansicht und Drag-and-drop-Interaktionen bleiben verfügbar.

## Validierung

- Unit-Test für die Gruppierung: Backlog, Blocker und aktive Tickets bleiben
  fachlich getrennt.
- `pnpm typecheck`: erfolgreich.
- Lokale Installation: `schapat.agent-scrum v2.0.4`, Status `ready`,
  Health-Check `healthy`.
- Browser-Smoke-Test mit TestCompany: Die Backlog-Spalte zeigt
  „Blockiert 1“ und `TES-7`; der kanonische Hoststatus bleibt `blocked`.