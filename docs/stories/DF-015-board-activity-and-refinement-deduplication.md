# DF-015: Sichtbare Analyseaktivitaet und entdupliziertes Technical-Lead-Refinement

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Das Scrum Board zeigte waehrend einer technischen Analyse nur den Text
`Technical analysis in progress`. Ein sichtbarer Laufzeitindikator fehlte.

In der TestCompany erzeugte der Technical Lead ausserdem technische
Refinement-Kommentare mehrfach. Das erweckte den Eindruck, dass derselbe Auftrag
erneut bearbeitet wird.

## Ursache

- Die Status-Komponente hatte fuer `analysis_in_progress` keine visuelle
  Aktivitaetsdarstellung.
- Die lokal installierte Plugin-Version enthielt noch die alte
  300-Sekunden-Heartbeat-Policy und den frueheren `Heartbeat Queue Scan` fuer
  alle Managed Agents. Dadurch konnte der Technical Lead den weiterhin offenen
  Kickoff bei einem spaeteren Timer-Lauf erneut bearbeiten.
- Im Worker wurde eine Refinement-Anfrage erst nach `await ctx.agents.invoke()`
  als angefordert gespeichert. Zwei ueberlappende Requests konnten deshalb
  denselben Technical Lead gleichzeitig wecken.

## Loesung

- Der Board-Status rendert bei `analysis_in_progress` einen CSS-Spinner neben
  dem bestehenden Text. Bei reduzierter Bewegung bleibt der Indikator sichtbar,
  rotiert aber nicht.
- `requestProjectRefinement()` teilt parallelen Aufrufern nun ein gemeinsames
  In-Flight-Promise. Nur der erste Aufruf invokes den Technical Lead; weitere
  Aufrufer erhalten dasselbe Ergebnis.
- Der lokale Agent-Scrum-Bundle wurde gebaut und ueber `plugin upgrade`
  aktualisiert. Eine neue Board-Anfrage reconciliert die bestehenden Managed
  Agents auf die on-demand-Policy: Der Technical Lead hat keinen Timer mehr,
  bleibt aber ueber `wakeOnDemand` gezielt verfuegbar. Die append-only
  Event-Routing-Anweisung hat Vorrang vor dem historischen Queue-Abschnitt.

## Akzeptanzkriterien

- Bei laufender technischer Analyse ist neben dem Status ein sichtbarer
  Aktivitaetsindikator vorhanden.
- Bei `prefers-reduced-motion` bleibt der Indikator ohne Rotation sichtbar.
- Zwei gleichzeitig eintreffende Refinement-Requests fuer dieselben
  Projekt-Tickets rufen den Technical Lead genau einmal auf.
- Der Technical Lead der TestCompany laeuft nicht mehr ueber einen
  zeitgesteuerten Heartbeat und kann weiterhin gezielt geweckt werden.

## Validierung

- Der neue Worker-Regressionstest reproduziert den vorherigen doppelten Invoke
  und besteht nach dem In-Flight-Lock.
- `./node_modules/.bin/tsc --noEmit` ist erfolgreich.
- `node ./esbuild.config.mjs` ist erfolgreich und enthaelt den Spinner im
  UI-Bundle.
- Der lokale `plugin upgrade` ist erfolgreich; die Live-Agenten-API bestaetigt
  fuer den Technical Lead `heartbeat.enabled: false`,
  `wakeOnDemand: true` und `intervalSec: 1800`.