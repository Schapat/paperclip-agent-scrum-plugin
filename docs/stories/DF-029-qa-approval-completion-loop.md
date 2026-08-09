# DF-029: QA-Abschlussmarker beendet Projekt-Tickets trotz Kriterienwortlautabweichung nicht

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Ein QA-Agent hatte ein Projekt-Ticket mit einem finalen
`qa-review-approved`-Marker akzeptiert und auf `done` gesetzt. Die Formulierung
seiner Checkliste wich jedoch von den beim Technical Refinement gespeicherten
Akzeptanzkriterien ab. Die Kriterienprojektion erkannte deshalb nur einen Teil
der Eintraege als abgehakt.

Der Worker behandelte die dadurch unvollstaendige Projektion als wichtiger als
den finalen QA-Abschluss und schob das Ticket wieder nach `in_review`. Nach einer
weiteren QA-Runde konnte der Ablauf erneut in Development und Review zurueckfallen.

## Loesung

- Ein finaler, vom zugewiesenen QA-Agenten geschriebener
  `qa-review-approved`-Marker verifiziert nun alle verfeinerten
  Akzeptanzkriterien im Board.
- Das Ticket bleibt nach einem solchen QA-Abschluss in `done`, auch wenn die
  QA-Checkliste inhaltlich gleichwertig, aber anders formuliert ist.
- Eine spaetere `QA rework routed`-Rueckgabe entwertet den vorherigen
  QA-Abschluss; erst ein neuer QA-Marker darf das Ticket danach wieder abschliessen.
- Ohne finalen QA-Marker bleibt die vorhandene Einzelkriterien-Sperre unveraendert.
- Der Worker heilt bereits betroffene Tickets sowohl ueber den Eventpfad als auch
  bei einer vollstaendigen Board-Hydration aus `in_review` oder `in_progress` nach
  `done`, wenn der aktuelle QA-Abschluss, die Kriterien und Commit-Evidenz vorliegen.

## Akzeptanzkriterien

- Ein final QA-abgenommenes Projekt-Ticket bleibt in `done`, wenn ein
  Commitnachweis vorliegt.
- Das Board zeigt alle verfeinerten Akzeptanzkriterien als durch QA verifiziert.
- Unvollstaendige Checklisten ohne finalen QA-Marker halten ein Ticket weiterhin
  in Review.
- Ein Rework nach QA-Abschluss erzwingt einen neuen QA-Abschluss.

## Validierung

- Ein neuer Worker-Regressionstest deckt den realen Fall einer finalen
  QA-Abnahme mit abweichender Checklistenformulierung ab.
- Die Routing-Regression prueft, dass ein spaeteres QA-Rework einen alten
  Abschlussmarker entwertet.
- Die Hydrations- und Development-Recovery-Regressionen decken beide historischen
  Restzustaende ab.
- Vollstaendige Vitest-Suite: 392 Tests in 23 Dateien bestanden.
- `./node_modules/.bin/tsc --noEmit`, `node ./esbuild.config.mjs` und
  `git diff --check` sind erfolgreich.
- Lokaler Rollout: ACMA-4 wurde aus dem festgefahrenen QA-Review mit 6/6
  verifizierten Kriterien nach `done` ueberfuehrt.
- ACMA-5 ist nicht mehr im Review-Loop, sondern korrekt durch ACMA-3 blockiert.
  ACMA-3 benoetigt weiterhin eine strukturierte Developer-Commit-Evidenz; dieser
  getrennte Qualitaetsgate wurde bewusst nicht umgangen.