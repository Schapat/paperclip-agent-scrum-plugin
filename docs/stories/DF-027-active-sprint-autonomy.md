# DF-027: Aktive Sprints ohne nachtraegliche Human-Approvals ausfuehren

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Nach der Freigabe von Analyse, Backlog, Refinement und Sprint konnten direkte
Sprint-Tickets erneut eine hostseitige `request_confirmation` oder eine offene
Produktentscheidung anfordern. Der Agentenlauf wartete dann auf eine weitere
Human-Entscheidung, obwohl der Scope bereits vor dem Sprintstart freigegeben
worden war.

## Loesung

- Bei einem direkten Child-Issue eines tatsaechlich aktiven Projektsprints
  behandelt der Worker einen offenen Produktentscheidungsmarker als durch die
  Sprintfreigabe gedeckt, schreibt einen Aufloesungsmarker und routet den Review
  direkt an QA.
- Alle Managed-Agent-Instruktionen erhalten idempotent die Regel
  **Approved Sprint Autonomy**. Sie verbietet Paperclip-Confirmations und neue
  Human-Approvals fuer Implementierung, Tests, QA und Entscheidungen innerhalb
  der akzeptierten Ticketkriterien eines aktiven Sprints.
- Neue Anforderungen ausserhalb des Ticket- oder Sprint-Scopes bleiben durch
  den bestehenden Scope-Guard gesperrt und werden nicht stillschweigend geliefert.

## Akzeptanzkriterien

- Ein offener Produktentscheidungsmarker auf einem aktiven Sprint-Ticket
  blockiert die Lieferung nicht und wird an QA uebergeben.
- Der Host-Issue erhaelt einen `po-decision-resolved`-Marker als nachvollziehbare
  Aufloesung der durch den Sprint freigegebenen Entscheidung.
- Bestehende Agenten-Instruktionen werden ohne Ueberschreiben lokaler
  Anpassungen um die Sprintautonomie erweitert.
- Vor dem Sprintstart und ausserhalb des freigegebenen Scopes bleiben die
  bestehenden Human-Gates erhalten.

## Validierung

- Neuer Worker-Regressionstest deckt den vollstaendigen Weg von Sprintstart bis
  zur QA-Route einer nachtraeglichen Produktentscheidung ab.
- Neuer Instruktions-Regressionstest deckt die idempotente Regel gegen
  Paperclip-Confirmations ab.
- Vollstaendige Vitest-Suite: 388 Tests in 23 Dateien bestanden.
- `./node_modules/.bin/tsc --noEmit`, `node ./esbuild.config.mjs` und
  `git diff --check` sind erfolgreich.
- Die lokale Paperclip-API war beim Upgrade nicht erreichbar. Bereits gespeicherte
  Host-Confirmations koennen vom Plugin nicht ohne einer echten Human-Identitaet
  beantwortet oder geloescht werden; nach dem naechsten Reconcile verhindert die
  neue Agentenregel weitere Anfragen fuer aktiven Sprint-Scope.