# FE-007: Human Approvals und Ticket-Ereignisse im Scrum Board

**Klassifizierung:** Feature

**Status:** Erledigt

**Datum:** 2026-08-09

## Ziel

Plugin-Nutzer sollen Freigaben und den zugehoerigen Workflow vollstaendig im
Scrum Board bearbeiten. Ein Wechsel in die Paperclip-Issue-Ansicht ist weder
fuer die Kickoff-Analyse noch fuer eine Produktentscheidung erforderlich.

## Umsetzung

- Ticketdetails enthalten einen `Workflow`-Tab. Er fuehrt Host-Kommentare,
  Statuswechsel und gespeicherte Entscheidungen chronologisch zusammen.
- Ein Ticket mit offenem Produktentscheidungsmarker zeigt direkt in der
  Uebersicht eine Human-Approval-Aktion. Die Aktion schreibt den bestehenden
  Resolution-Marker und routet das Ticket wieder an QA.
- Scope-Holds werden im Projektbereich mit dem betroffenen Ticket und einer
  direkten Freigabe dargestellt.
- Paperclip erlaubt kein nachtraegliches Umhaengen eines Issue-Parents. Eine
  Scope-Freigabe erzeugt deshalb ein neues, direktes Child-Issue des Kickoffs,
  protokolliert die Freigabe an altem und neuem Ticket und entfernt den Hold.
- Ein abgeschlossener Projektauftrag bleibt terminal: Scope-Freigaben sind im
  Worker abgewiesen und im Board sichtbar deaktiviert.
- Der Kickoff-Issue wird als lesbares Detailticket in die Board-Daten
  projiziert. Die Kickoff-Karte oeffnet nun denselben Board-Dialog statt auf
  Paperclip zu verlinken.
- Der vorhandene Agent Log bleibt die globale, teamweite Ereignisansicht; der
  neue Workflow-Tab liefert den vollstaendigen Ticket-Kontext.

## Akzeptanzkriterien

- Eine offene Produktentscheidung kann aus dem zugehoerigen Ticketdetail im
  Scrum Board freigegeben werden und geht anschliessend an QA zurueck.
- Ein aktiver Scope-Hold kann aus dem Board freigegeben werden. Das daraus
  entstehende Projektticket ist im Backlog sichtbar und enthaelt einen
  Freigabe-Eintrag im Workflow.
- Ein abgeschlossener Projektauftrag kann durch Scope-Freigaben nicht erneut
  Delivery-Arbeit erzeugen.
- Kickoff-Analyse und ihre Kommentare sind im Board-Detaildialog lesbar.
- Kommentare, Statuswechsel und Entscheidungen erscheinen gemeinsam im
  Ticket-Workflow.

## Validierung

- Onboarding-Worker-Suite: 29 Tests bestanden, einschliesslich direkter
  Produktentscheidung, Scope-Freigabe, terminalem Projektabschluss und
  Kickoff-Projektion.
- `./node_modules/.bin/tsc --noEmit` und `node ./esbuild.config.mjs` sind
  erfolgreich.
- Die lokale Plugin-Instanz wurde ueber `plugin upgrade` aktualisiert.
- Browser-Smoketest: Kickoff oeffnet Board-intern, der Workflow-Tab ist
  auswaehlbar und zeigt die zusammengefuehrte Timeline; historische Scope-Holds
  eines abgeschlossenen Auftrags sind deaktiviert.