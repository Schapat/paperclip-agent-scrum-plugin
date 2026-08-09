# FE-009: Kompakten Onboarding-Pfad fuer Kleinimplementierungen anbieten

**Klassifizierung:** Feature

**Status:** Erledigt

**Datum:** 2026-08-09

## Ziel

Kleine, isolierte Implementierungen sollen nicht auf einen separaten
Sprint-Planning-Schritt warten muessen. Die fachlichen und qualitativen
Kontrollen des normalen Projekt-Onboardings bleiben dabei erhalten.

## Loesung

- Das Startformular bietet die explizite, standardmaessig deaktivierte Checkbox
  **Small implementation**.
- Der Worker normalisiert diese Auswahl strikt als Boolean und speichert ihre
  Wirkung im bestehenden `requiresSprint`-Zustand des Projektauftrags.
- Bei aktivierter Auswahl fuehrt die menschliche Backlogfreigabe direkt in die
  Lieferung; ohne Auswahl bleibt das organisationsweite Sprint-Gate unveraendert.
- Technical-Lead-Analyse, Kickoff-Ticketfreigabe, Product-Owner-Discovery,
  Backlogfreigabe, Refinement und QA werden nicht uebersprungen.

## Akzeptanzkriterien

- Die Auswahl fuer Kleinimplementierungen ist beim Start sichtbar und standardmaessig aus.
- Nur ein explizites Boolean-`true` kann den kompakten Pfad aktivieren.
- Bei aktivem organisationsweiten Sprint-Gate erreicht ein kompakter Auftrag
  nach Backlogfreigabe `active`, ohne einen lokalen Sprint anzulegen.
- Ein normaler Auftrag bleibt weiterhin in `sprint_planning`, bis ein Human den
  ersten Sprint startet.

## Validierung

- Ein neuer Worker-Regressionstest prueft den kompakten Auftrag bei weiterhin
  aktivem organisationsweiten Sprint-Gate.
- Fokussierte Onboarding-Tests: 52 Tests in 2 Dateien bestanden.
- Vollstaendige Vitest-Suite: 386 Tests in 23 Dateien bestanden.
- `./node_modules/.bin/tsc --noEmit`, `node ./esbuild.config.mjs` und
  `git diff --check` sind erfolgreich.