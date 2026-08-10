# DF-036: Retry-Refinement mit Issue-gebundenem Technical-Lead-Run starten

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Der Board-Button **Retry refinement** startete den Technical Lead ueber
`ctx.agents.invoke(...)`. Dieser API-Pfad kann keinen Paperclip-Issue an den
Agent-Run binden. Der Run erhielt deshalb keine Task ID und der Technical Lead
konnte seinen Refinement-Kommentar nicht auf das Child-Issue schreiben: Die
Cross-Issue-Grenze lehnte den Request ohne gueltigen Run-Kontext ab.

Ein Wechsel auf `ctx.issues.requestWakeup(...)` allein war ebenfalls nicht
ausreichend. Paperclip verlangt fuer einen Issue-Wakeup sowohl einen
zugewiesenen Agenten als auch einen wakeable Status.

## Loesung

- Das Plugin weist jedes unzugewiesene Backlog-Ticket, das ein Refinement
  braucht, dem Technical Lead als `todo` zu.
- Danach startet es einen separaten Issue-Wakeup mit
  `project_refinement` fuer jedes Ticket. Jeder Technical-Lead-Run besitzt
  dadurch genau eine Task ID und kann nur auf seinem eigenen Issue schreiben.
- Ein strukturierter Technical-Lead-Refinementmarker fuehrt das Ticket wieder
  als unzugewiesenes `backlog` zurueck. Im kompakten Projektmodus kann die
  vorhandene Planung es danach direkt einem Developer zuweisen.
- Die Kandidatenauswahl akzeptiert nur unzugewiesene Backlog-Tickets sowie
  bereits beim Technical Lead liegende `todo`-Tickets fuer einen Retry. Aktive
  Delivery-, Review- und Blocker-Arbeit anderer Rollen wird nicht umgehangen.

## Akzeptanzkriterien

- Ein Retry startet einen Issue-gebundenen Wakeup fuer jedes unrefinierte,
  geeignete Projekt-Child-Issue.
- Der Technical Lead erhaelt eine Task ID und kann seinen Refinement-Kommentar
  ohne Cross-Issue-Fehler speichern.
- Gleichzeitige Refinement-Anfragen bleiben auf einen Wakeup pro Ticket
  koalesziert.
- Ein Technical-Lead-Refinementmarker gibt ein Ticket im Sprintmodus wieder als
  unzugewiesenes Backlog an die Sprintplanung zurueck.
- Ein aktives Developer- oder QA-Ticket wird nicht fuer ein fehlendes
  Refinement neu zugewiesen.

## Validierung

- Neue Worker-Regressionstests pruefen Retry, Wakeup-Koaleszierung,
  Rueckfuehrung nach Refinementmarker und den Schutz aktiver Tickets.
- `./node_modules/.bin/vitest run --config ./vitest.config.ts`: 24 Dateien,
  402 Tests erfolgreich.
- `./node_modules/.bin/tsc --noEmit` erfolgreich.
- `node ./esbuild.config.mjs` erfolgreich.