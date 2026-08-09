# DF-019: Kickoff-Analyse im initialen Setup im Kanban entscheiden

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Der Kickoff-Issue einer neuen Projektanfrage war zwar als Detailticket
projiziert, bot im Ticketdialog aber keine explizite Human-Entscheidung fuer
eine abgeschlossene technische Analyse. Der Einstieg in die Story Discovery war
dadurch nur als allgemeine Board-Aktion erkennbar; eine begruendete Rueckgabe an
den Technical Lead fehlte.

## Loesung

- Die sichtbare Kickoff-Karte benennt eine fertige Analyse nun als Entscheidung
  und oeffnet weiterhin den Board-internen Ticketdialog.
- Das Kickoff-Ticket zeigt bei `analysis_ready` die Aktion zum Freigeben der
  technischen Analyse. Sie startet die bestehende Product-Owner-Story-Discovery
  und hinterlegt die Human-Freigabe im Ticket-Workflow.
- Eine Rueckgabe verlangt einen konkreten Aenderungswunsch, schreibt ihn als
  Host-Kommentar und weckt den Technical Lead erneut.
- Ein Revisionsmarker verhindert, dass ein alter Abschlussmarker die neue
  Analyse sofort wieder als fertig markiert. Erst ein neuer Technical-Lead-
  Abschluss entsperrt die Freigabe erneut.

## Akzeptanzkriterien

- Die Kickoff-Analyse ist vom Projektbereich des Kanbanboards aus als Ticket
  oeffenbar.
- Ein Human kann eine fertige technische Analyse im Ticket freigeben und damit
  die Story Discovery starten.
- Ein Human kann mit einem begruendeten Aenderungswunsch die Analyse an den
  Technical Lead zurueckgeben.
- Nach einer Rueckgabe bleibt der Auftrag in `analysis_in_progress`, bis der
  Technical Lead einen neuen Abschlussmarker hinterlegt.

## Validierung

- Fokussierte Kickoff-Projektions-, Freigabe- und Revisions-Regressionstests:
  3 bestanden.
- Vollstaendige Vitest-Suite: 373 Tests in 22 Dateien bestanden.
- `./node_modules/.bin/tsc --noEmit` und `node ./esbuild.config.mjs` sind
  erfolgreich.
- Lokale Plugin-Aktualisierung: `schapat.agent-scrum v2.1.1`, Status `ready`,
  Health `healthy`; die Board-Route der TestCompany rendert nach dem Upgrade.