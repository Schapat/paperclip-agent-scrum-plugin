# DF-031: System-Rework entwertet finalen QA-Abschluss ohne QA-Ablehnung

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Ein automatisch geschriebener `QA rework routed`-Kommentar wurde wie ein echtes
QA-Ablehnungsverdikt behandelt. Das konnte einen finalen QA-Approvalmarker
entwerten, obwohl danach kein QA-Agent neue Findings oder einen
`Changes Requested`-Kommentar hinterlegt hatte.

## Loesung

- Nur ein spaeterer, vom QA-Agenten geschriebener `Changes Requested`-Kommentar
  oder der explizite Rejection-Marker entwertet einen bestehenden QA-Abschluss.
- Systemkommentare dokumentieren Routing, haben aber keine fachliche
  Verdict-Wirkung.
- Eine neue Worker-Regression prueft die reale Folge aus finalem QA-Approval und
  nachfolgendem System-Rework-Kommentar.

## Validierung

- Routing-Regression deckt System-Rework, QA-Ablehnung und erneute QA-Freigabe ab.
- Worker-Regression deckt die Wiederherstellung eines historisch nach Development
  zurueckgefallenen Tickets ab.
- Vollstaendige Vitest-Suite: 393 Tests in 23 Dateien bestanden.
- Lokaler ACMA-Rollout: Die Pending-Confirmation von ACMA-3 ist mit
  `issue_closed` abgelaufen; es war keine neue Human-Freigabe erforderlich.