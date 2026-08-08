# DF-004: Analyse-Gate und sichtbarer Kickoff

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-08

## Problem

Der Root-Issue eines Projektauftrags wurde absichtlich nicht als normale
Backlog-Story gespiegelt, war im Board aber auch nicht sichtbar. Gleichzeitig
konnte der Human die PO-Story-Erstellung bereits starten, obwohl die technische
Analyse noch lief.

## Lösung

Das Board zeigt den Root-Issue als angepinnte Kickoff-Karte im Projektbereich.
Der Technical Lead beendet seine Analyse mit einem eindeutigen Marker. Erst wenn
der Worker diesen Kommentar vom Technical Lead erkannt hat, wird die
Story-Erstellung im Board freigegeben.

## Akzeptanzkriterien

- Der Kickoff-Issue ist im Projektbereich des Scrum Boards sichtbar und mit dem
  Paperclip-Issue verlinkt.
- Während `analysis_in_progress` ist Story Discovery sichtbar gesperrt.
- Nur ein Technical-Lead-Kommentar mit dem Abschlussmarker entsperrt die
  Story-Erstellung.
- Der Worker verweigert eine vorzeitige `startBacklogDiscovery`-Action.
- Nach Abschluss erscheint der Status `Technical analysis ready for review` und
  der Story-Discovery-Button wird nutzbar.

## Validierung

- Fokussierte Onboarding- und Worker-Tests: 14 Tests bestanden.
- Die lokale Board-Page zeigt den Kickoff als verlinkte Karte.
- Die vorhandene TestCompany-Onboarding-Instanz bleibt bewusst `active`, weil
  ihre Stories vor Einführung des Analyse-Gates erstellt wurden. Neue Aufträge
  folgen dem gesperrten Analyseablauf.