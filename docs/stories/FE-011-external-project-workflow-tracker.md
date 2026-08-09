# FE-011: Externen Projektworkflow und Freigaben oberhalb des Scrum Boards anzeigen

**Klassifizierung:** Feature

**Status:** Erledigt

**Datum:** 2026-08-09

## Ziel

Das Scrum Board soll den gerade ausserhalb des Kanban laufenden
Projektworkflow eindeutig sichtbar machen. Ein Human muss ohne Suche erkennen,
ob der Technical Lead analysiert oder verfeinert, der Product Owner Stories
schreibt oder eine eigene Freigabe ansteht. Der passende Paperclip-Kickoff soll
direkt erreichbar sein.

## Loesung

- Ein testbarer Workflow-Mapper leitet aus dem Onboarding-Status und dem
  Refinement-Fortschritt eine aktuelle externe Aktivitaet ab.
- Der Projektkopf zeigt diese Aktivitaet oberhalb des Kanban mit Rolle,
  Beschreibung, naechstem Schritt und sichtbarem Human-Approval-Hinweis.
- Der Board-Dialog bleibt fuer Entscheidungen erreichbar; zusaetzlich fuehrt
  ein nativer Direktlink zum aktuellen Paperclip-Kickoff-Ticket.
- Der bisherige Zeremonienhinweis heisst nun eindeutig **Latest board event**,
  damit er nicht mit dem aktuellen externen Workflow verwechselt wird.
- Auch ohne laufenden Projektauftrag wird der Leerzustand explizit angezeigt.

## Akzeptanzkriterien

- Bei `analysis_in_progress` zeigt das Board die Technical-Lead-Analyse als
  externe Aktivitaet an.
- Bei `analysis_ready` ist die menschliche Analysefreigabe hervorgehoben und
  direkt erreichbar.
- Bei `backlog_in_progress` zeigt das Board die Product-Owner-Story-Erstellung
  an.
- Bei `sprint_planning` unterscheidet die Anzeige zwischen noch offenem
  Technical-Lead-Refinement und einer menschlichen Sprintfreigabe.
- Der Tracker enthaelt fuer einen Kickoff einen Link zur nativen
  Paperclip-Issue-Route und bleibt auf mobilen Breiten ohne horizontalen
  Ueberlauf nutzbar.

## Validierung

- Neuer fokussierter Vitest: 4 Tests fuer Technical-Lead-Analyse, Human
  Approval, Product-Owner-Backlog und Technical-Lead-Refinement erfolgreich.
- `./node_modules/.bin/tsc --noEmit` erfolgreich.
- `node ./esbuild.config.mjs` erfolgreich.
- Live-Validierung auf `/ACMA/scrum-board`: Der Tracker zeigte den laufenden
  Technical-Lead-Refinement-Schritt mit sechs offenen Stories und verlinkte
  korrekt auf `/ACMA/issues/ACMA-8`.
- Mobile-Pruefung bei 390 px: kein horizontaler Ueberlauf; Board-Dialog und
  Direktlink blieben erreichbar.