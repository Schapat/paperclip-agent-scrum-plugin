# DF-009: Erfolgreiches QA-Review darf nicht nach Development zurückfallen

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Ein erfolgreiches QA-Review von `TES-3` wechselte nach `done` wieder zu
`in_review` und anschließend zu `in_progress`. Der Verlauf zeigte eine Schleife
aus `Development → Done → Review → Development`.

Der QA-Agent war korrekt als Assignee des Review-Issues eingetragen. Das
Paperclip-Event lieferte jedoch keinen `actorId`. Das QA-Gate deutete den
fehlenden Actor fälschlich als Developer-Abschluss und eröffnete den Review
erneut.

## Lösung

- Das QA-Gate akzeptiert eine `done`-Transition als legitim, wenn entweder
  QA der Event-Actor ist, QA weiterhin Assignee ist oder ein QA-Approvalmarker
  im Kommentarverlauf vorliegt.
- Direkte Developer-Abschlüsse bleiben weiterhin geschützt und werden zu QA
  nach `in_review` zurückgeführt.
- Der QA-Approvalmarker
  `<!-- agent-scrum:qa-review-approved -->` bleibt für auditierbare Abschlüsse
  in den QA-Instruktionen dokumentiert.
- Die Refinement-Recovery umfasst jetzt auch bereits laufende, blockierte,
  reviewte oder abgeschlossene, aber unrefinierte Projekt-Issues. Automatische
  Anforderungen bleiben pro Ticket dedupliziert.

## Akzeptanzkriterien

- Ein QA-owned `done` ohne Event-Actor bleibt `done`.
- Ein Developer-Abschluss ohne QA-Zuweisung wird weiter nach `in_review`
  zurückgeführt.
- Zwei aufeinanderfolgende Board-Hydrierungen lassen einen gültigen QA-Abschluss
  unverändert.
- Unrefinierte bereits aktive Projekt-Issues erreichen den Technical Lead.

## Validierung

- Worker-Harness deckt QA-owned Done ohne Actor, direkten Developer-Abschluss,
  QA-Approvalmarker und Refinement-Recovery ab.
- `pnpm test`: 17 Testdateien, 336 Tests erfolgreich.
- `pnpm typecheck` und `pnpm build`: erfolgreich.
- Lokale Installation: `schapat.agent-scrum v2.0.3`, Status `ready`,
  Health-Check `healthy`.
- Reale TestCompany-Recovery: `TES-3` wurde auf `done` wiederhergestellt und
  blieb über zwei unabhängige Board-Hydrierungen sowohl im Host als auch im
  Scrum Board auf `done`.