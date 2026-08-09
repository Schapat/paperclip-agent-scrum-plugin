# DF-012: Ticketdetails zeigen Akzeptanzkriterien doppelt und ohne QA-Verifikation

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Befund

`TES-5` war auf Done, zeigte im Detailpanel jedoch dieselben
Akzeptanzkriterien zweimal und die kanonische Liste als `0/5`: einmal als rohe
`- [ ]`-Markdownliste in der Beschreibung und einmal als projektierte Liste.

## Ursache

- Das Detailpanel gab die vollstaendige Host-Beschreibung unveraendert aus und
  renderte darunter die kanonische Akzeptanzkriterienliste.
- Die QA-Kommentarprojektion erkannte nur Markdown-Checkboxen. Der reale
  QA-Kommentar nutzte nummerierte, fett formatierte Kriterien mit `✅`.

## Loesung

- Das Detailpanel entfernt aus der Beschreibungsanzeige ausschliesslich den
  Abschnitt `Akzeptanzkriterien` beziehungsweise `Acceptance Criteria`; die
  kanonische Liste bleibt die einzige sichtbare Darstellung.
- Die Projektion erkennt zusaetzlich nummerierte QA-Zeilen mit terminalem
  `✅` oder `❌` und gleicht sie wie Checkboxen gegen die Story-Kriterien ab.

## Akzeptanzkriterien

- Im Ticketdetail erscheint jede Akzeptanzbedingung nur einmal.
- Die User Story, der Wert und technische Hinweise bleiben in der Beschreibung
  sichtbar.
- QA-Zeilen im Format `**1. Kriterium** ✅` markieren das passende Kriterium als
  erfuellt.
- Ein Done-Ticket mit einer vollstaendigen QA-Verifikation zeigt den korrekten
  Kriterienfortschritt.

## Validierung

- Ein Regressionstest bildet die reale nummerierte QA-Emoji-Notation nach.
- Ein UI-Helper-Test prueft das Entfernen des redundanten
  Akzeptanzkriterienabschnitts.
- Die komplette Suite besteht mit 21 Testdateien und 353 Tests.
- TypeScript und Produktionsbuild sind erfolgreich.
- Lokale Installation: `schapat.agent-scrum v2.0.10`, Status `ready`.
- Eine Board-Reconciliation bestaetigt `TES-5` auf Done mit 5 von 5
  verifizierten Kriterien. Die geoeffnete Detailansicht zeigt den rohen
  Akzeptanzkriterienabschnitt nicht mehr und markiert alle fuenf kanonischen
  Kriterien als von QA geprueft.