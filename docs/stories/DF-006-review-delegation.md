# DF-006: Review-Delegation für Projekt-Issues

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Projektgebundene Tickets werden als Paperclip-Issues geführt. Erreicht ein
Developer den Status `in_review`, existiert im Plugin bislang keine gezielte
Review-Zuweisung. Dadurch kann Paperclip den Reviewpfad als Human Review
behandeln, obwohl technische Akzeptanzkriterien durch QA geprüft werden sollen.

## Lösung

- QA ist der Standard-Reviewer jedes technischen `in_review`-Tickets.
- Ein Developer kann eine Produktentscheidung über den Marker
  `<!-- agent-scrum:po-decision-required -->` im Review-Kommentar verlangen.
- Dann delegiert das Plugin den Review an den Product Owner.
- Der PO beendet die Entscheidung mit
  `<!-- agent-scrum:po-decision-resolved -->`; danach routet das Plugin an QA.

## Akzeptanzkriterien

- Ein technisches `in_review`-Ticket wird QA zugewiesen und QA wird aufgeweckt.
- Ein Ticket mit offenem PO-Entscheidungsmarker wird dem PO zugewiesen.
- Nach dem PO-Abschlussmarker wird das Ticket wieder QA zugewiesen.
- Bereits korrekt zugewiesene Reviews werden nicht erneut aufgeweckt.
- Der bestehende Host-Status `in_progress` beim tatsächlichen Developer-Run
  bleibt unverändert.

## Validierung

- Review-Routing-Regeln sind im Worker-Harness für QA, offene
  Produktentscheidungen und die Rückgabe an QA abgedeckt.
- `pnpm test`: 17 Testdateien, 330 Tests erfolgreich.
- `pnpm typecheck` und `pnpm build`: erfolgreich.
- Lokale Installation: `schapat.agent-scrum v2.0.1`, Status `ready`,
  Health-Check `healthy`.