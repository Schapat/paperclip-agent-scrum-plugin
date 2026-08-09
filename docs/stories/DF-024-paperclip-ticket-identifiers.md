# DF-024: Paperclip-Ticketkennungen statt UUID-Praefixe im Board anzeigen

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Kanban-Karten und der Ticketdetaildialog zeigten die ersten acht Zeichen der
internen UUID, zum Beispiel `#80e04576`. Paperclip besitzt jedoch die
menschenlesbare Kennung `TES-3`, `ROB-42` oder eine vergleichbare
Company-Kennung.

Bereits gespeicherte Board-Tasks enthielten diese Kennung teilweise nicht mehr,
weil sie aus einem historischen lokalen Projektzustand stammten und nicht durch
den aktuellen Kickoff-Sync erreicht wurden.

## Loesung

- `ScrumTask` speichert die optionale Paperclip-Kennung getrennt von der
  technischen UUID.
- Die Host-Issue-Projektion uebernimmt `identifier` fuer neue und aktualisierte
  Projekt-Tickets sowie fuer das Kickoff-Detailticket.
- Karten und Ticketdetaildialog verwenden dieselbe Anzeigehilfe: Sie bevorzugt
  die Paperclip-Kennung und faellt fuer lokale Tickets ohne Host-Issue auf den
  bisherigen UUID-Praefix zurueck.
- Bei einem Board-Read ergaenzt der Worker fehlende Kennungen fuer bestehende
  Tasks aus den Issues derselben Company und speichert nur bei einer Aenderung.

## Akzeptanzkriterien

- Ein aus Paperclip projiziertes Ticket zeigt im Kanban seine Kennung wie
  `TES-3` statt eines UUID-Praefixes.
- Dieselbe Kennung steht im Ticketdetaildialog.
- Lokale Tickets ohne Paperclip-Issue bleiben mit einem kurzen UUID-Fallback
  lesbar.
- Historische Board-Tasks erhalten die Kennung, ohne Status oder Zuordnung zu
  veraendern.

## Validierung

- Projektionstest fuer neue Host-Tickets, Backfill-Test fuer historische Tasks
  und Anzeigehelfer-Tests bestanden.
- Fokussierte Worker-, Projektion- und UI-Suite: 47 Tests bestanden.
- Vollstaendige Vitest-Suite: 384 Tests in 23 Dateien bestanden.
- `./node_modules/.bin/tsc --noEmit` und der Produktionsbuild bestanden.
- Lokale Plugin-Aktualisierung: `schapat.agent-scrum v2.1.1`, Status `ready`,
  Health `healthy`.
- Browser-Smoketest in TestCompany: Karte und Detaildialog des vorherigen
  UUID-Tickets zeigen beide `TES-3`.