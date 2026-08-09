# FE-005: Managed Agents mit aktivem Heartbeat und rollenbezogener Kanban-Queue

**Klassifizierung:** Feature

**Status:** Erledigt

**Datum:** 2026-08-09

## Ziel

Die sechs vom Plugin verwalteten Scrum-Agents sollen regelmaessig aktiv werden
und ihre rollenbezogene Kanban-Queue pruefen. Ein leerer eigener Arbeitskorb
darf nicht verhindern, dass etwa QA ein unzugewiesenes Review oder ein
Developer ein sprintzugeordnetes TODO uebernimmt.

## Loesung

- Jeder Managed Agent erhaelt eine aktive Heartbeat-Konfiguration mit
  `intervalSec: 300`, `wakeOnDemand: true`, `maxConcurrentRuns: 1` und
  `skipTimerWhenNoActionableWork: false`.
- Die letzte Einstellung ist absichtlich deaktiviert, damit der Timer auch
  ohne bereits zugewiesenes Ticket startet und die Agenten die offene Queue
  untersuchen koennen.
- Developers pruefen TODO und Development, QA prueft Review; Product Owner,
  Technical Lead und Scrum Master pruefen ihre jeweiligen Produkt-,
  Refinement-, Blocker- und WIP-Queues.
- Ein Agent setzt fremde oder menschliche Zuweisungen niemals ueberschreibend
  um. Er uebernimmt hoechstens ein passendes unzugewiesenes Ticket und
  dokumentiert die Uebernahme als Kommentar.
- Beim Reconcile werden bestehende Agents ohne Managed-Reset aktualisiert:
  Unabhaengige Runtime-Werte, Adapter, Modelle, Budgets und vorhandene
  individuelle Instructions bleiben erhalten.
- Fehlt eine materialisierte `AGENTS.md`, wird sie aus dem Plugin erstellt.
  Bestehende angepasste Instructions erhalten den Queue-Abschnitt einmalig
  append-only.

## Akzeptanzkriterien

- Neue Managed Agents erhalten beim Anlegen einen aktiven 300-Sekunden-
  Heartbeat.
- Bestehende Managed Agents erhalten beim naechsten Reconcile dieselbe
  Heartbeat-Policy ohne Verlust fremder Runtime-Werte.
- Ein Agent ohne eigenes Ticket kann seine rollenbezogene offene Queue sehen.
- Es gibt pro Agent hoechstens einen parallelen Heartbeat-Lauf.
- Kein Heartbeat ueberschreibt eine vorhandene Human- oder Agent-Zuweisung.
- Die Queue-Regeln sind sowohl fuer neue als auch bereits vorhandene Managed
  Agents im wirksamen Instructions-Bundle vorhanden.

## Validierung

- Team-Test deckt die 300-Sekunden-Policy und die verlustfreie Runtime-Merge-
  Funktion ab.
- Instructions-Test deckt die Materialisierung und den einmaligen append-only
  Upgrade bestehender Anweisungen ab.
- Worker-Harness deckt die deklarierte Runtime-Konfiguration bei der
  Team-Reconciliation ab.
- Vollstaendige Suite: 20 Testdateien, 349 Tests erfolgreich.
- `pnpm typecheck` und `pnpm build` sind erfolgreich.
- Lokale Installation: `schapat.agent-scrum v2.0.9`, Status `ready`.
- Eine Board-Datenanfrage im Kontext der TestCompany hat den Live-Upgrade
  ausgefuehrt. Alle sechs bestehenden Agents besitzen danach `enabled: true`,
  `intervalSec: 300`, `wakeOnDemand: true`, `maxConcurrentRuns: 1` und
  `skipTimerWhenNoActionableWork: false`.
- Die materialisierte `AGENTS.md` aller sechs Agents enthaelt den Abschnitt
  `## Heartbeat Queue Scan`.