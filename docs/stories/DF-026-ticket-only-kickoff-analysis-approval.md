# DF-026: Kickoff-Analyse ausschliesslich im Ticket freigeben

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Nach Abschluss der Technical-Lead-Analyse bot neben dem Kickoff-Ticket auch der
Projektbereich des Boards eine allgemeine Schaltflaeche zur Freigabe an. Damit
liess sich die Product-Owner-Story-Discovery starten, ohne die Analyse im
Ticketdialog bewusst gelesen und entschieden zu haben. Zwei sichtbare Wege fuer
dieselbe Human-Entscheidung machten den Ablauf fehleranfaellig und verwirrend.

## Loesung

- Die Projektuebersicht zeigt bei `analysis_ready` nur noch den klaren Hinweis
  und den Einstieg in das Kickoff-Ticket.
- Die allgemeine Board-Aktion zum Starten der Story Discovery wurde aus dem
  Projektbereich entfernt.
- Ausschliesslich der Kickoff-Ticketdialog behaelt die vorhandenen Aktionen zum
  Freigeben der Analyse oder zum begruendeten Zurueckgeben an den Technical Lead.

## Akzeptanzkriterien

- Im Zustand `analysis_ready` existiert im Projektbereich keine zweite
  Freigabeschaltflaeche.
- Das Kickoff-Ticket bleibt aus der Projektuebersicht erreichbar und erklaert
  den erforderlichen naechsten Schritt.
- Erst die explizite Entscheidung im Ticket kann die Product-Owner-Story
  Discovery ausloesen.
- Die vorhandene Aenderungsanforderung an den Technical Lead bleibt erhalten.

## Validierung

- Die Quellpruefung findet `Approve technical analysis` nur noch im
  Ticketdetaildialog.
- Fokussierte Onboarding-Tests: 52 Tests in 2 Dateien bestanden.
- Vollstaendige Vitest-Suite: 386 Tests in 23 Dateien bestanden.
- `./node_modules/.bin/tsc --noEmit`, `node ./esbuild.config.mjs` und
  `git diff --check` sind erfolgreich.
- Ein Live-Smoketest war nicht moeglich, weil der lokale Paperclip-Host unter
  `127.0.0.1:3100` nicht erreichbar war.