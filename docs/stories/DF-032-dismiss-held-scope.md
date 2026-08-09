# DF-032: Gehaltene Scope-Items ohne Folgeauftrag verwerfen

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Nach Abschluss eines Projektauftrags zeigte das Board fuer ein gehaltenes
Scope-Item nur **Approve as follow-up**. Ein obsoletes Agenten-Issue, etwa zum
Aufloesen eines bereits erledigten Stale-Run-Locks, konnte nicht verworfen werden
und blieb als irrefuehrende Human-Freigabe sichtbar.

## Loesung

- Der Worker bietet die Action `dismissScopeHold`.
- Die Action storniert das gehaltene Host-Issue, schreibt einen nachvollziehbaren
  Human-Dismiss-Kommentar und entfernt nur diesen Hold aus dem Onboarding-State.
- Sie erzeugt keinen Folge-Kickoff, kein Delivery-Ticket und aendert nicht den
  abgeschlossenen Projektauftrag.
- Die Boardkarte zeigt neben der Folgeauftrag-Freigabe nun **Dismiss hold**.

## Akzeptanzkriterien

- Ein gehaltenes Scope-Item kann ohne Folgeauftrag verworfen werden.
- Das Ursprungsissue endet mit `cancelled` und ohne Zuweisung.
- Der Hold verschwindet aus dem Board.
- `rootIssueId` und Status des abgeschlossenen Projekts bleiben unveraendert.

## Validierung

- Neue Worker-Regression deckt die Verwerfung nach Projektabschluss ab.
- Onboarding-Worker-Suite: 47 Tests bestanden.
- Vollstaendige Vitest-Suite: 394 Tests in 23 Dateien bestanden.
- Lokaler ACMA-Rollout: Der sichtbare Hold **Run-Lock auf ACMA-3 aufloesen** ist
  entfernt; das Host-Issue ist `cancelled`, der Board-State hat keine Scope-Holds
  und der Projektauftrag bleibt `completed`.
- Lokaler Plugin-Health-Check: `ready` und `healthy`.