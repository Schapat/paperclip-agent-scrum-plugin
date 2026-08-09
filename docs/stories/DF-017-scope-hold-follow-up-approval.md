# DF-017: Scope-Holds abgeschlossener Auftraege als Folgeauftrag freigeben

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Ein abgeschlossener Projektauftrag zeigte weiterhin Scope-Holds mit dem Hinweis
auf eine Human Approval. Der zugehoerige Button war jedoch deaktiviert, weil der
Worker keine neue Delivery-Arbeit mehr an einem terminalen Projekt erlaubte.
Damit war die angezeigte Freigabe im Scrum Board nicht ausfuehrbar.

## Ursache

Die Sperre in `approveScopeHold` schuetzt korrekt davor, einen abgeschlossenen
Auftrag stillschweigend wieder zu oeffnen. Es fehlte aber ein expliziter
Board-Flow, der die Human-Freigabe als neuen Folgeauftrag interpretiert.

## Loesung

- `startScopeHoldFollowUp` legt aus einem ausgewaehlten Hold einen neuen,
  projektgebundenen Kickoff und ein direktes Backlog-Child an.
- Der alte Hold wird auditierbar als `cancelled` abgeschlossen; alte und neue
  Issues erhalten nachvollziehbare Freigabe-Kommentare.
- Der neue Kickoff startet wieder mit der Technical-Lead-Analyse und wird
  gezielt aufgeweckt.
- Nicht ausgewaehlte Holds bleiben im neuen Onboarding erhalten. Sie werden
  erst nach Technical Analysis und Backlog Discovery erneut freigebbar.
- Der Board-Button eines abgeschlossenen Auftrags lautet nun `Approve as
  follow-up` und ist aktiv. Er erklaert sichtbar, dass keine alte Lieferung
  geoeffnet wird.

## Akzeptanzkriterien

- Ein Hold eines abgeschlossenen Auftrags kann direkt im Scrum Board als
  Folgeauftrag freigegeben werden.
- Die Freigabe erzeugt keinen neuen Delivery-Schritt im alten Auftrag, sondern
  startet einen neuen Kickoff mit Technical Analysis.
- Das neue Backlog-Ticket und der alte Hold enthalten Audit-Kommentare.
- Weitere Holds verschwinden nicht und bleiben bis zum passenden Analyse-Gate
  sichtbar.

## Validierung

- Der fokussierte Worker-Test deckt Kickoff, Folge-Child, Wakeup,
  State-Uebergang und die Erhaltung weiterer Holds ab.
- `./node_modules/.bin/tsc --noEmit` und `node ./esbuild.config.mjs` sind
  erfolgreich.
- Die lokale Plugin-Instanz wurde per `plugin upgrade` aktualisiert.
- Browser-Smoketest bestaetigt 15 aktive `Approve as follow-up`-Buttons und
  den erklaerenden Board-Alert; kein echter Folgeauftrag wurde im Test gestartet.