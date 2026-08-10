# DF-039: Abgebrochene Technical-Lead-Refinements duerfen Tickets nicht in In Progress festhalten

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-10

## Problem

Ein projektgebundenes Refinement wird als Issue-gebundener Technical-Lead-Run
gestartet. Der Worker weist das Ticket dafuer dem Technical Lead als `todo` zu;
der Host setzt es waehrend des Runs auf `in_progress`.

Die bestehende Rueckfuehrung erkannte nur `todo`. Ein gueltiger
Refinementmarker auf einem laufenden Ticket wurde daher zwar ins Board
projiziert, das Ticket blieb aber `in_progress` und dem Technical Lead
zugewiesen.

Zusaetzlich erlaubte die Technical-Lead-Instruktion Ticket-Refinement nur im
`backlog` und verlangte bei einem anderen Status einen Stopp. Sie stand damit im
Widerspruch zum vom Host benoetigten Issue-gebundenen Run und konnte den
Technical Lead nach dem Start zum Abbruch veranlassen.

## Loesung

- Ein gueltig verfeinertes, dem Technical Lead zugewiesenes Projekt-Ticket wird
  nun sowohl aus `todo` als auch aus `in_progress` als unzugewiesenes `backlog`
  zurueckgefuehrt.
- Die Technical-Lead-Instruktion erlaubt bei einer direkten, eigenen
  Projekt-Refinement-Zuweisung die fachliche Bearbeitung in `todo` oder
  `in_progress`, ohne Status oder Zuweisung zu aendern.
- Ein versionierter Instruktionsblock wird auch an vorhandene, angepasste
  Managed-Agent-Bundles genau einmal angehaengt.

## Akzeptanzkriterien

- Ein Refinementmarker auf einem `in_progress`-Ticket des Technical Lead gibt
  das Ticket als unzugewiesenes `backlog` fuer die Planung frei.
- Der Technical Lead kann eine direkte Projekt-Refinement-Zuweisung in `todo`
  oder `in_progress` bearbeiten, ohne selbst Status oder Assignee zu aendern.
- Bereits installierte Technical-Lead-Instruktionen erhalten die Ausnahme
  idempotent.
- Aktive Delivery- und QA-Tickets anderer Rollen werden nicht als Refinement
  zurueckgefuehrt.

## Validierung

- Der neue Worker-Regressionstest reproduziert den Host-Laufstatus
  `in_progress` und prueft die Rueckfuehrung nach gueltigem Refinementmarker.
- Der neue Instruktions-Regressionstest prueft die einmalige Aktualisierung
  eines vorhandenen Technical-Lead-Bundles.
- `./node_modules/.bin/vitest run --config ./vitest.config.ts src/__tests__/project-onboarding-worker.test.ts src/__tests__/agent-instructions.test.ts`: 75 Tests erfolgreich.
- `./node_modules/.bin/tsc --noEmit` erfolgreich.
- `node ./esbuild.config.mjs` erfolgreich.