# DF-040: Vollstaendiges Ticket-Batch-Refinement darf nicht nach der ersten Story abbrechen

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-10

## Problem

Nach der Human-Freigabe eines Feature-Backlogs erstellt der Product Owner mehrere
direkte Child-Issues. Der Worker weckt den Technical Lead bisher nur fuer maximal
zwei davon separat, obwohl dessen Runtime nur einen Run gleichzeitig ausfuehrt.
Die uebrigen ungeplanten Stories erhalten keinen zusammenhaengenden Auftrag und
koennen nach dem ersten Refinement ohne Story Points und Akzeptanzkriterien
liegen bleiben. Der menschliche Sprintstart bleibt dadurch blockiert.

## Ziel

Ein Technical-Lead-Refinement verarbeitet den vollstaendigen aktuell offenen
Story-Batch eines freigegebenen Feature-Backlogs. Der Technical Lead hinterlegt
fuer jede Story Story Points und pruefbare Akzeptanzkriterien; danach liegen alle
verfeinerten Tickets unzugewiesen im `backlog` und der Human kann den Sprint
starten.

## Loesung

- Der Worker erzeugt fuer alle offenen Stories eines Backlogs genau einen
  Carrier-Run beim Technical Lead statt maximal zwei separater Weckrufe.
- Das Carrier-Ticket erhaelt einen vollstaendigen Batch-Brief mit Titel und
  exakter `issueId` jeder Story. Der Technical Lead ruft
  `submit_refinement` fuer jedes Batch-Ticket mit Story Points und
  Akzeptanzkriterien auf.
- Abhaengige Stories bleiben ohne unzulaessigen Host-Weckruf Teil desselben
  Batch-Briefs.
- Taucht in einem bereits angeforderten, noch unverfeinerten Batch eine weitere
  Story auf, nimmt der naechste Carrier-Run auch die wartenden Alt-Tickets mit.
  Damit erholt sich ein vor dem Fix gestartetes Feature ohne Warten auf den
  zeitbasierten Retry.
- Die Technical-Lead-Instruktion hat einen v2-Marker. Damit wird die
  Batch-Regel bei bereits bestehenden lokalen Agenten idempotent nachgezogen
  und hat Vorrang vor der frueheren Einzel-Ticket-Regel.
- Vor dem menschlichen Sprintstart bleiben die verfeinerten Tickets im
  `backlog`; mit dem Sprintstart plant der bestehende Workflow sie nach
  `todo`, ohne Delivery vor der Human-Freigabe zu beginnen.

## Akzeptanzkriterien

- Ein Feature mit mindestens drei gleichzeitig offenen Child-Issues erzeugt
  genau einen Technical-Lead-Refinementauftrag statt einer durch die
  Run-Parallelitaet blockierten Einzelwarteschlange.
- Der Auftrag nennt jedes Ticket des Batches und fordert fuer jedes die
  Abgabe ueber `submit_refinement` mit Story Points und mindestens einem
  Akzeptanzkriterium.
- Ein Technical Lead kann in diesem einen Run Refinements fuer jedes genannte
  direkte Child-Issue abgeben.
- Nach gueltigen Refinements liegen alle Batch-Tickets als unzugewiesenes
  `backlog` vor und `canStartProjectSprint` wird wahr.
- Abhaengige Tickets bleiben weiterhin ohne unzulaessigen Host-Weckruf
  refinierbar.

## Validierung

- Der neue Regressionstest mit drei gleichzeitig erzeugten Feature-Stories war
  vor dem Fix rot: Der Worker meldete nur zwei `taskIds`.
- Nach dem Fix prueft derselbe Test einen Batch mit allen drei Tickets, genau
  einen Technical-Lead-Weckruf und den vollstaendigen Carrier-Brief.
- Ein zweiter Regressionstest prueft, dass ein nachtraeglicher Carrier-Run
  bereits wartende Alt-Tickets in den vollstaendigen Batch aufnimmt.
- `./node_modules/.bin/vitest run --config ./vitest.config.ts src/__tests__/project-onboarding-worker.test.ts`: 63 Tests erfolgreich.
- `./node_modules/.bin/vitest run --config ./vitest.config.ts src/__tests__/agent-instructions.test.ts`: 16 Tests erfolgreich.
- `./node_modules/.bin/tsc --noEmit` und `node ./esbuild.config.mjs` erfolgreich.
- Lokales Upgrade ueber `POST /api/plugins/schapat.agent-scrum/upgrade` erfolgreich:
  `schapat.agent-scrum v2.1.1`, Status `ready`, `lastError: null`, Reload
  `2026-08-10T18:11:35.911Z`.