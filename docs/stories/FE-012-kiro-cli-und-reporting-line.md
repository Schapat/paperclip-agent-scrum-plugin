# FE-012: Kiro CLI und Reporting-Line fuer neue Scrum-Agenten

**Klassifizierung:** Feature

**Status:** Erledigt

**Datum:** 2026-08-10

## Ziel

Neue Organisationen sollen beim Aktivieren des Scrum-Plugins alle sechs
Managed Agents mit Kiro CLI und Claude Opus 4.5 erhalten. Die Reporting-Line
soll die fachlichen Entscheidungsrechte sichtbar machen, ohne Product Owner
oder Scrum Master kuenstlich zu Vorgesetzten zu machen.

## Entscheidung

Die Zielstruktur bleibt:

```text
Company Lead (CEO, optional)
  Product Owner
  Scrum Master
  Technical Lead
    Developer 1
    Developer 2
  QA Engineer
```

Product Owner, Scrum Master, Technical Lead und QA Engineer berichten direkt
an den optionalen Company Lead. Nur die Developers berichten an den Technical
Lead. Das trennt Produktpriorisierung, Prozessverantwortung, technische
Fuehrung und unabhaengige QA-Entscheidungen.

Ein separater Chief of Staff ist fuer den Scrum-Plugin-Workflow nicht
erforderlich. Er kann als hostseitiger Company Lead fuer mehrere Teams oder
uebergreifende Unternehmenssteuerung bestehen bleiben, wird vom Plugin aber
nicht erzeugt oder als zusaetzliche Delivery-Stufe verwendet.

## Umsetzung

- Jede Teamrolle deklariert den externen Adapter `kiro_local` und
  `adapterConfig.model: "claude-opus-4.5"`.
- Das Manifest reicht beide Werte bei der Managed-Agent-Erstellung an
  Paperclip durch.
- Die rollenbezogenen Instruktions-Upgrades schreiben die Reporting-Line
  append-only in vorhandene, angepasste AGENTS.md-Bundles.
- Bei Reconciliation bereits vorhandener Agents bleiben vorhandene Adapter-
  und Modellentscheidungen unveraendert; die Kiro-Vorgabe ist bewusst ein
  Initialisierungsdefault.

## Verifikation

- Die lokale Adapter-Registry meldet `kiro_local` als geladenen externen
  Adapter (`paperclip-kiro-adapter` 0.1.7).
- Die Adapterquelle akzeptiert den Modellwert `claude-opus-4.5` im Feld
  `adapterConfig.model`.
- Fokussierte Teamtests: 20 Tests erfolgreich.
- Fokussierte Instruktions-Upgrade-Tests: 7 Tests erfolgreich.
- TypeScript-Check: erfolgreich.