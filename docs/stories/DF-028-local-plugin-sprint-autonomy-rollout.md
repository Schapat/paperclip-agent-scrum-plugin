# DF-028: Lokale Plugin-Instanz aktualisiert Sprintautonomie nicht

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Der Git-Stand enthielt bereits die Regel **Approved Sprint Autonomy**, die
lokale Paperclip-Instanz lief jedoch noch mit dem zuvor geladenen Plugin-Bundle.
Developer 1 konnte deshalb auf `ACMA-3` trotz aktivem, menschlich gestartetem
Sprint eine neue `request_confirmation` fuer ein QA-Rework erzeugen.

## Ursache

Ein Git-Push aktualisiert die lokal installierte Plugin-Instanz nicht. Die
append-only Regeln fuer vorhandene Managed Agents werden erst nach
`plugin upgrade` und einer Company-Invocation vom Worker in die bestehenden
`AGENTS.md`-Bundles geschrieben.

## Loesung

- Das lokale Plugin `schapat.agent-scrum` wurde aktualisiert.
- Eine `board`-Invocation fuer die richtige ACMA-Company reconciliert alle
  Managed Agents; Developer 1 enthaelt nun die Sprintautonomie-Regel und das
  explizite Verbot weiterer Paperclip-Confirmations im aktiven Sprint.
- Die schon bestehende Rework-Confirmation auf `ACMA-3` wurde nicht genehmigt,
  sondern mit dem Grund des bereits freigegebenen Sprint-Scopes zurueckgezogen.
- Das Ticket bleibt bei QA im normalen `in_review`-Pfad; ein aktiver QA-Run und
  QA-Wakeups setzen die Pruefung fort.
- Das README beschreibt jetzt den notwendigen lokalen Upgrade- und
  Reconciliation-Schritt nach einer Veroeffentlichung.

## Akzeptanzkriterien

- Direkte Tickets des aktiven ACMA-Sprints erhalten keine neue Human
  Confirmation durch Developer 1.
- Die fehlerhafte, offene Rework-Confirmation ist `cancelled` mit Outcome
  `withdrawn`, nicht `accepted`.
- ACMA-3 bleibt in QA-Review und wird ohne neuen Human-Gate weiterbearbeitet.
- Der lokale Betriebsablauf nach Git-Push ist im README dokumentiert.

## Validierung

- ACMA-Boarddaten bestaetigen `projectOnboarding.status: active` und den
  aktiven Sprint mit `ACMA-3` als Sprint-Ticket.
- Das live gespeicherte `AGENTS.md` von Developer 1 enthaelt
  `Approved Sprint Autonomy` und `Keine Paperclip-Confirmation`.
- Die Pending-Interaction
  `e5df8e2b-68fa-4138-929c-5d764264cf3c` ist `cancelled` mit Outcome
  `withdrawn`.
- `ACMA-3` steht in `in_review`, ist QA zugewiesen und hat einen aktiven
  QA-Review-Run sowie QA-Wakeups.