# DF-001: Reporting Line zum Company Lead

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-08

## Problem

Rollen der Scrum-Führungsebene wurden mit einer leeren `reportsTo`-Referenz
behandelt. Im Host bedeutet dies jedoch „Top-Level“ und nicht „berichtet an den
Company Lead“. Dadurch erschienen diese Rollen neben statt unter der CEO-Agentin
beziehungsweise dem CEO im Organigramm.

## Lösung

Beim Abgleich ermittelt das Plugin die CEO-Agent-ID der Organisation. Die
Soll-Reporting-Line nutzt diese ID für Rollen ohne teaminternen Vorgesetzten und
wendet sie bei erkannten Abweichungen über die Host-API an.

## Akzeptanzkriterien

- Führungsebenen-Rollen berichten an den Company Lead, sofern einer existiert.
- Ohne Company Lead bleiben diese Rollen auf oberster Ebene.
- Der bestehende Reporting-Line-Abgleich erkennt und korrigiert Abweichungen.
- Die fokussierten Team-Tests bestehen.

## Validierung

`pnpm --dir plugin-scrum-team exec vitest run --config ./vitest.config.ts src/__tests__/team.test.ts`

Ergebnis: 17 Tests bestanden.