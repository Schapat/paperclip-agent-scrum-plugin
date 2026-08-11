# DF-041: Angezeigte Scope-Holds ausserhalb des Projekts muessen freigegeben oder verworfen werden koennen

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-10

## Problem

Der Scope-Guard haelt agent-erstellte Tickets ausserhalb des aktiven
Projektauftrags bewusst als Human-Scope-Hold an. Das Scrum Board zeigt diese
Tickets mit den Aktionen **Approve scope** und **Dismiss hold**.

Die Aktionshandler verlangten danach jedoch, dass das gehaltene Quell-Ticket
bereits dieselbe `projectId` wie der aktive Auftrag besitzt. Projektlose oder
fremdprojektige Holds wurden deshalb sichtbar angeboten, konnten aber weder
freigegeben noch verworfen werden. Die UI zeigte dazu die widerspruechlichen
Fehlertexte "Only tickets from the active Paperclip project can join this project
request." und "Only held tickets from this Paperclip project can be dismissed.".

## Ziel

Ein im aktuellen Company-Kontext registrierter Scope-Hold bleibt ausserhalb des
Liefer-Scope, bis ein Human ihn explizit entscheidet. **Approve scope** erstellt
ein neues Child-Issue im aktiven Projekt und schliesst das Quell-Ticket;
**Dismiss hold** schliesst ausschliesslich das gehaltene Quell-Ticket.

## Loesung

- Die Aktionen vertrauen nun auf die explizite Scope-Hold-Registrierung im
  aktuellen Company-Kontext, statt fälschlich eine identische `projectId` am
  Quell-Ticket zu verlangen.
- **Approve scope** erstellt weiterhin ein neues Child-Issue im aktiven Projekt
  und beendet erst danach das externe oder projektlose Quell-Ticket.
- **Dismiss hold** beendet das registrierte Quell-Ticket unabhängig von dessen
  Projektzuordnung.
- Ist das Quell-Ticket inzwischen nicht mehr vorhanden, liefern beide Aktionen
  die zutreffende Meldung `The held ticket is no longer available.`.

## Akzeptanzkriterien

- Ein projektloses, registriertes Scope-Hold kann vom Human in den aktiven
  Projektauftrag freigegeben werden.
- Die Freigabe erzeugt ein neues Child-Issue des aktiven Kickoffs und beendet
  das Quell-Ticket.
- Ein projektloses, registriertes Scope-Hold kann vom Human verworfen werden.
- Aktionen auf nicht mehr auffindbare Holds liefern einen zutreffenden Fehler,
  statt eine falsche Projektzuordnung zu behaupten.

## Validierung

- Zwei neue Regressionstests reproduzieren die vorherigen UI-Fehler mit einem
  projektlosen Hold: einer fuer **Approve scope**, einer fuer **Dismiss hold**.
- `./node_modules/.bin/vitest run --config ./vitest.config.ts src/__tests__/project-onboarding-worker.test.ts`: 65 Tests erfolgreich.
- `./node_modules/.bin/tsc --noEmit` und `node ./esbuild.config.mjs` erfolgreich.
- Lokales Upgrade ueber `POST /api/plugins/schapat.agent-scrum/upgrade` erfolgreich:
  `schapat.agent-scrum v2.1.1`, Status `ready`, `lastError: null`, Reload
  `2026-08-10T18:27:23.361Z`.