# DF-008: Host-Lifecycle mit Live-Status, QA-Gate und Blocker-Auflösung

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Projektgebundene Paperclip-Issues wurden zwar statusgetreu auf das Scrum Board
projiziert, aber der Host konnte einen Developer-Lauf direkt nach `done`
schließen. Damit blieb die QA-Routinglogik unbeteiligt. Gleichzeitig spiegelte
der Team-Status aktive Host-Issues nicht als laufende Arbeit wider.

Ein blockiertes Ticket darf nur dann nach TODO zurückkehren, wenn jede native
Paperclip-Abhängigkeit abgeschlossen ist. Der reale Fall `TES-7` blieb dagegen
korrekt blockiert, weil `TES-5` noch `in_progress` war.

## Lösung

- Ein direkter Abschluss eines projektgebundenen Child-Issues wird nach
  `in_review` zurückgeführt, QA zugewiesen und QA aufgeweckt.
- Ein QA-Abschluss bleibt nur dauerhaft `done`, wenn QA selbst den Übergang
  auslöst oder zuvor den Marker
  `<!-- agent-scrum:qa-review-approved -->` kommentiert hat.
- Aktive `in_progress`- und `in_review`-Projekt-Issues projizieren ihren
  Assignee als `working`; blockierte Issues als `blocked`.
- Der Blocker-Resolver liest `ctx.issues.relations.get()` und verschiebt ein
  Ticket erst nach TODO, wenn alle `blockedBy`-Issues den Status `done` haben.
- Alle Korrekturen schreiben den Status in Paperclip; das lokale Board bleibt
  ausschließlich eine Projektion.

## Akzeptanzkriterien

- Ein Developer kann ein Projekt-Issue nicht ungeprüft auf `done` belassen.
- QA erhält ein direkt abgeschlossenes Issue als `in_review` und wird geweckt.
- Ein QA-markierter Abschluss bleibt auch nach einer Worker-Hydrierung `done`.
- Laufende Developer- und QA-Arbeit ist im Teamstatus sichtbar.
- Ein Blocker bleibt erhalten, solange mindestens eine Host-Abhängigkeit offen
  ist, und wird nach TODO verschoben, sobald alle abgeschlossen sind.

## Validierung

- Worker-Harness deckt direkte Abschlüsse, QA-Marker, Live-Agentenstatus und
  vollständige Blockerketten ab.
- `pnpm test`: 17 Testdateien, 334 Tests erfolgreich.
- `pnpm typecheck` und `pnpm build`: erfolgreich.
- Lokale Installation: `schapat.agent-scrum v2.0.2`, Status `ready`,
  Health-Check `healthy`.
- Reale TestCompany-Hydrierung:
  - `TES-3`, `TES-4` und `TES-6` wurden von direkten Abschlüssen nach
    `in_review` mit QA-Zuweisung zurückgeführt.
  - `TES-5` bleibt in `in_progress` bei Developer 1.
  - `TES-7` bleibt korrekt blockiert, solange `TES-5` noch läuft.
  - Board und Dashboard zeigen QA sowie Developer 1 als aktiv.

## Abgrenzung

Die Host-404 für `/companies/:companyId/built-in-agents` stammt aus der
Paperclip-Navigation, nicht aus Agent Scrum. Die historische Single-Tenant-
Konfigurationswarnung betrifft eine andere Plugin-Instanz und mehrere Companies.
`multiCompanyConfig: true` wird erst nach einer sicheren, nebenläufigen
Per-Company-Worker-State-Umstellung gesetzt.