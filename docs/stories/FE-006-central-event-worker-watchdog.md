# FE-006: Zentralen Event-Worker durch einen Scrum-Master-Watchdog absichern

**Klassifizierung:** Feature

**Status:** Erledigt

**Datum:** 2026-08-09

## Ziel

Der Scrum-Prozess soll ereignisgesteuert und kosteneffizient arbeiten. Nur ein
langsamer Scrum-Master-Watchdog darf regelmaessig laufen; Product Owner,
Technical Lead, QA und Developers werden ausschliesslich durch Zuweisungen oder
gezielte Plugin-Ereignisse aktiviert.

## Loesung

- Der bestehende Plugin-Worker bleibt die zentrale, deterministische
  Steuerung fuer Kanban- und Projekt-Ereignisse sowie Zeremonie-Trigger.
- Der Scrum Master behaelt einen 30-Minuten-Heartbeat als Watchdog. Er prueft
  nur bereits freigegebene, liegengebliebene Arbeit, Blocker und WIP-Verstoesse
  und weckt oder eskaliert die zustaendige Rolle.
- Alle anderen Managed Agents erhalten `enabled: false` fuer den Timer, bleiben
  aber mit `wakeOnDemand: true` fuer Zuweisungen und gezielte Worker-Aufrufe
  erreichbar.
- Die Runtime-Migration wird bei jedem Reconcile auf bestehende Agents
  angewendet und erhaelt Modelle, Adapter, Budgets und fremde Runtime-Werte.
- Die verwalteten Agenten-Anweisungen verwenden nun eine vorrangige
  ereignisgesteuerte Aktivierungsregel. Bei bestehenden angepassten Bundles
  wird sie append-only hinzugefuegt und ueberschreibt alte Queue-Scan-Regeln
  ohne Nutzertext zu loeschen.

## Akzeptanzkriterien

- Genau der Scrum Master hat einen aktiven 30-Minuten-Heartbeat.
- Alle uebrigen Rollen sind ohne Timer aktivierbar und erlauben hoechstens einen
  parallelen Lauf.
- Die zentrale Event-Steuerung kann weiterhin jede Rolle gezielt wecken.
- Eine bestehende aktive Fuenf-Minuten-Konfiguration wird beim Reconcile fuer
  Delivery-Rollen deaktiviert.
- Neue und bestehende Instructions behaupten keine rollenweiten Timer-Scans
  mehr.

## Validierung

- Team- und Worker-Reconcile-Tests pruefen Watchdog, On-Demand-Policy und die
  verlustfreie Runtime-Migration.
- Instructions-Tests pruefen die append-only Migration einer alten
  Queue-Scan-Regel auf die vorrangige Ereignisregel.
- TypeScript-Check, Produktionsbuild und die vollstaendige Test-Suite wurden
  erfolgreich ausgefuehrt.
