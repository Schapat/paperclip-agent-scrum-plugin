# DF-011: QA-Rework an Developer uebergeben und erneut durch QA pruefen

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Befund

Bei `TES-6` dokumentierte QA einen fehlenden Dark-Mode-Artefaktbestandteil und
kuendigte anschliessend an, den Fix selbst zu implementieren. Das Ticket blieb
bei QA, obwohl es nach Development zurueckging.

## Ursache

- Die QA-Anweisung verbot Ticketzuweisungen ohne Ausnahme fuer Rework.
- Der Worker schuetze direkte Developer-Abschluesse mit einem QA-Gate, hatte
  jedoch keinen Gegenpfad fuer `in_review -> in_progress` mit QA als Owner.

## Loesung

- Ein projektgebundener Rework-Router erkennt `in_progress`-Tickets, die noch
  QA zugewiesen sind.
- Er waehlt den Developer mit der geringsten aktiven TODO-, Development- und
  Review-Last, weist das Ticket zu, protokolliert die Uebergabe und weckt den
  Developer.
- Die QA-Anweisung verlangt bei Changes Requested einen gemeinsamen Patch aus
  Development-Status und Developer-Zuweisung; QA darf den Fix nicht selbst
  implementieren.
- Ein neuer `## QA Rework Handoff`-Marker aktualisiert auch bereits
  materialisierte QA-Instructions append-only.

## Akzeptanzkriterien

- Ein QA-owned Projekt-Ticket in Development wird einem Developer zugewiesen.
- Die Zuweisung wird als Kommentar dokumentiert und der Developer geweckt.
- Das Ticket bleibt in Development, bis der Developer es wieder nach Review
  uebergibt.
- QA darf den Rework-Fix nicht selbst implementieren oder direkt abschliessen.

## Validierung

- Der Worker-Harness prueft QA-Review, Development-Rueckgabe, Developer-
  Zuweisung und Routing-Kommentar in einem Ablauf.
- Die komplette Suite besteht mit 21 Testdateien und 353 Tests.
- TypeScript und Produktionsbuild sind erfolgreich.
- Lokale Installation: `schapat.agent-scrum v2.0.10`, Status `ready`.
- Der bestehende QA-Agent besitzt nach der Reconciliation den Marker
  `## QA Rework Handoff` sowie die ausdrueckliche Regel, den Fix nicht selbst
  zu implementieren.