# DF-042: Technical-Lead-Batch-Refinement muss alle Storys in einer Tool-Uebergabe abschliessen

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-10

## Problem

Der Worker nimmt alle unverfeinerten direkten Child-Issues in einen
Carrier-Refinement-Run auf. Der Technical Lead erhielt jedoch nur das
Einzelticket-Tool `submit_refinement`. Fuer einen Batch mit mehreren Stories
musste das Modell daher mehrere unabhaengige Tool-Aufrufe ausfuehren und konnte
nach dem ersten Ticket zurueckkehren.

Bei Lieferabhaengigkeiten erschien der Batch zusaetzlich als ein Carrier plus
"blocked tickets included". Die blockierten Tickets waren zwar im Kommentar
aufgelistet, aber der Ausfuehrungsvertrag erzwingt nicht, dass ihre Story Points
und Akzeptanzkriterien im selben Run eingereicht werden.

## Ziel

Der Technical Lead schliesst einen angeforderten Refinement-Batch mit einem
einzigen strukturierten Tool-Aufruf ab. Dieser enthaelt fuer jede erwartete Story
genau eine Schaetzung und mindestens ein pruefbares Akzeptanzkriterium. Ein
unvollstaendiger Batch wird abgelehnt, bevor irgendein Ticket als fertig gilt.

## Loesung

- Das Manifest und der Worker stellen nun `submit_refinement_batch` bereit.
  Der Technical Lead uebergibt damit die Verfeinerungen aller im aktuellen
  Batch genannten Stories in genau einem Tool-Aufruf.
- Der Worker validiert alle Entries vor dem ersten Schreibvorgang. Fehlende,
  doppelte oder nicht erwartete Issue-IDs werden als unvollstaendiger Batch
  abgelehnt, ohne einen Refinementmarker zu erzeugen.
- Der Einzelticket-Toolpfad `submit_refinement` lehnt ein Ticket aus einem
  aktiven Mehrticket-Batch ab und verweist verbindlich auf
  `submit_refinement_batch`.
- Ein vollstaendiger Batch schreibt fuer jede erwartete Story einen gueltigen
  Refinementmarker, auch fuer Tickets mit Lieferabhaengigkeiten.
- Der Carrier darf waehrend des Host-Runs `in_progress` sein und bleibt damit
  Teil des erwarteten Batch-Sets.
- Die Technical-Lead-Instruktion verwendet den versionierten v4-Block. Der
  Agent muss bei `Vollstaendiger Refinement-Batch` exakt einmal
  `submit_refinement_batch` verwenden und darf nicht nach dem Carrier-Ticket
  zurueckkehren.

## Akzeptanzkriterien

- Das Plugin deklariert und registriert ein `submit_refinement_batch`-Tool fuer
  den Technical Lead.
- Ein Batch-Aufruf mit fehlender, doppelter oder fremder Story-ID wird ohne
  Refinementmarker abgelehnt.
- Ein vollstaendiger Batch schreibt fuer jede erwartete Story genau einen
  gueltigen Refinementmarker.
- Nach dem Batch liegen alle verfeinerten Stories als unzugewiesenes `backlog`
  vor und der menschliche Sprintstart wird freigegeben.
- Die aktuelle Technical-Lead-Instruktion verwendet das Batch-Tool verbindlich,
  auch fuer Tickets mit Lieferabhaengigkeiten.

## Validierung

- Der neue Worker-Regressionstest stellt zwei Batch-Tickets bereit, setzt den
  Carrier auf den realen Host-Status `in_progress` und prueft:
  - Ein unvollstaendiger Batch wird abgewiesen.
  - Ein Einzelticket-Aufruf innerhalb des Batches wird abgewiesen.
  - Ein vollstaendiger Batch schreibt genau einen Refinementmarker pro Ticket.
  - Beide Tickets werden unzugewiesen ins `backlog` zurueckgefuehrt und der
    menschliche Sprintstart wird freigegeben.
- Neue Validierungstests decken leere, doppelte und vollstaendige Batch-Eingaben
  ab; die v3-zu-v4-Instruktionsmigration ist ebenfalls getestet.
- `./node_modules/.bin/vitest run --config ./vitest.config.ts src/__tests__/project-onboarding-worker.test.ts`: 66 Tests erfolgreich.
- `./node_modules/.bin/vitest run --config ./vitest.config.ts`: 458 Tests erfolgreich.
- `./node_modules/.bin/tsc --noEmit` und `node ./esbuild.config.mjs` erfolgreich.
- Lokales Upgrade ueber `POST /api/plugins/schapat.agent-scrum/upgrade` erfolgreich:
  `schapat.agent-scrum v2.1.1`, Status `ready`, `lastError: null`, Reload
  `2026-08-10T18:45:06.622Z`. Das geladene Manifest enthaelt
  `submit_refinement_batch`.
- Nach einem Gaming-Board-Reload enthaelt der gespeicherte Technical-Lead-Bundle
  den v4-Block, `submit_refinement_batch` und die verpflichtende Ablehnung eines
  Einzelticket-Aufrufs innerhalb eines Mehrticket-Batches.