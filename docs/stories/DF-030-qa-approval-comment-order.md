# DF-030: QA-Abschlussmarker wird bei absteigend geladenen Kommentaren entwertet

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Paperclip liefert Issue-Kommentare absteigend. Der Worker wertete den aktuellen
QA-Abschlussmarker dadurch zuerst aus und traf danach auf einen aelteren
Rework-Kommentar. Die Reihenfolge wurde als fachlich vorwaerts interpretiert und
der neuere QA-Abschluss faelschlich entwertet.

## Loesung

- Die QA-Verdikthistorie wird bei vorhandenen Zeitstempeln stabil chronologisch
  aufsteigend ausgewertet.
- Bei alten oder schlanken Fixtures ohne Zeitstempel bleibt die uebergebene
  Reihenfolge unveraendert.
- Ein Regressionstest bildet den realen API-Fall ab: neuer QA-Approval wird vor
  einem aelteren Systemkommentar geliefert.

## Validierung

- Routing-, Projektion- und Worker-Slice: 63 Tests in 3 Dateien bestanden.
- Vollstaendige Vitest-Suite: 393 Tests in 23 Dateien bestanden.
- Lokaler ACMA-Rollout: ACMA-3, ACMA-4 und ACMA-5 stehen nach der Hydration in
  `done`.