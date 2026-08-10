# DF-038: Run-Timeout darf nicht an den Kiro-Default gebunden sein

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-10

## Problem

Die Team-Definition erstellt neue Managed Agents derzeit mit `kiro_local` und
Claude Opus 4.5. Die Run-Schutzbeschreibung und die Timeout-Migration waren
dadurch ebenfalls Kiro-spezifisch formuliert und umgesetzt. Ein Operator kann
aber Modell oder Adapter eines bestehenden Managed Agents wechseln. Der
Host-Vertrag `adapterConfig.timeoutSec` gilt adapteruebergreifend; ein
Kiro-spezifischer Guard wuerde andere kompatible Managed Agents ungeschuetzt
lassen.

## Akzeptanzkriterien

- Die fachliche Dokumentation nennt den Schutz fuer Managed-Agent-Runs, nicht
  fuer Kiro-Runs.
- Kiro und Claude Opus 4.5 bleiben als aktueller Erstellungsdefault dokumentiert.
- Die bestehende Managed-Agent-Migration setzt `timeoutSec: 600` und
  `graceSec: 15` fuer jeden verwalteten Agenten, ohne Modell, Credentials oder
  sonstige Adapterfelder zu ersetzen.
- Regressionstests decken einen nicht-Kiro-Adapter und die idempotente
  Konfiguration ab.

## Validierung

- Ein `claude_local`-Fixture beweist, dass die bestehende Managed-Agent-
  Migration nicht mehr vom Kiro-Default abhaengt.
- Der Patch enthaelt ausschliesslich `timeoutSec` und `graceSec`; der Host merge
  diese Werte mit Modell, Credentials und sonstiger Adapter-Konfiguration.