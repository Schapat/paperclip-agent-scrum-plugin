# DF-043: Partielles Batch-Refinement darf verbleibende Storys nicht blockieren

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-10

## Problem

Ein Technical-Lead-Carrier erhielt bereits einen vollstaendigen
Refinement-Batch. Wenn der Agent dennoch nur das Carrier-Ticket verfeinerte,
kehrte dieses korrekt von `in_progress` nach `backlog` zurueck. Die restlichen
unverfeinerten Tickets blieben jedoch als bereits angefordert gespeichert.

Der automatische Folgeaufruf behandelte diese IDs deshalb bis zum
15-Minuten-Retry als laufenden Auftrag. Das Board zeigte weiter ein laufendes
Technical-Lead-Refinement, obwohl kein weiterer Run gestartet wurde und der
menschliche Sprintstart blockiert blieb.

## Ziel

Ein vollstaendiger `submit_refinement_batch` bleibt ein atomarer einzelner
Carrier-Run. Liefert ein Carrier nur ein partielles Ergebnis, muss der Worker
sofort einen neuen Batch fuer alle noch unverfeinerten Stories anfordern,
statt auf den zeitbasierten Retry zu warten.

## Loesung

- Die Refinement-Reconciliation erkennt, wenn ein zuvor angefordertes Ticket
  erfolgreich verfeinert wurde, aber weitere Batch-Tickets offen bleiben. Sie
  gibt deren Request-Sperre frei, sodass derselbe Event-Durchlauf einen neuen
  gemeinsamen Carrier-Run anfordert.
- Ein erfolgreiches `submit_refinement_batch` synchronisiert jede eingereichte
  Story sofort aus dem Host in den lokalen Board-Zustand und fuehrt einen
  zugewiesenen Carrier unmittelbar nach `backlog` zurueck.
- Eine In-Flight-Sperre verhindert, dass Host-Events zwischen den einzelnen
  Kommentaren eines korrekten Batch-Tools den Restbatch voreilig erneut
  einplanen.

## Akzeptanzkriterien

- Ein partiell verfeinertes Carrier-Ticket kehrt als unzugewiesenes `backlog`
  zurueck.
- Alle noch unverfeinerten Batch-Tickets erhalten ohne 15-Minuten-Wartezeit
  einen neuen gemeinsamen Carrier-Run.
- Der neue Carrier-Brief nennt jede verbliebene Story des Restbatches.
- Ein vollstaendiges `submit_refinement_batch` erzeugt weiterhin genau einen
  Carrier-Wakeup und fuehrt alle verfeinerten Stories ins `backlog` zurueck.

## Validierung

- Der neue Regressionstest mit drei Stories war vor dem Fix rot: Nach dem
  partiell verfeinerten Carrier wurde nur der erste Wakeup beobachtet.
- Nach dem Fix prueft derselbe Test den zweiten Carrier-Wakeup und den
  vollstaendigen Brief fuer die beiden verbleibenden Stories.
- Der bestehende Vollbatch-Test prueft zusaetzlich, dass ein erfolgreicher
  `submit_refinement_batch` bei genau einem Carrier-Wakeup bleibt.
- `./node_modules/.bin/vitest run --config ./vitest.config.ts src/__tests__/project-onboarding-worker.test.ts`: 67 Tests erfolgreich.
- `./node_modules/.bin/vitest run --config ./vitest.config.ts`: 459 Tests erfolgreich.
- `./node_modules/.bin/tsc --noEmit` und `node ./esbuild.config.mjs` erfolgreich.
- Lokales Upgrade ueber `POST /api/plugins/schapat.agent-scrum/upgrade` erfolgreich:
  `schapat.agent-scrum v2.1.1`, Status `ready`, `lastError: null`.
- Nach dem Board-Reload wurde ein Restbatch fuer zwei freie und ein
  lieferblockiertes Ticket angefordert; der Technical Lead nimmt damit nach
  einem zurueckgegebenen Carrier wieder Arbeit auf.