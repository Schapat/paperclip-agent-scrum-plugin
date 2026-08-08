# DF-010: Projektboard zeigt Agenten, Akzeptanzkriterien, Zeremonien und Sprintkontext unvollständig

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Das projektgebundene Scrum Board zeigte in Ticketkarten und Details rohe
Agenten-UUIDs. QA-Kommentare mit dokumentierten `[x]`-Akzeptanzkriterien wurden
nicht auf die projizierten Kriterien übertragen; die Karten blieben bei `0/x`.

Für aktive Paperclip-Projekte war kein lokaler Sprint angelegt, weshalb der
Header missverständlich „No active sprint“ zeigte, obwohl Tickets aktiv liefen.
Die hostgeführten Refinement-Events existierten nur als zeremonielle Records und
waren im Projektbereich nicht klar sichtbar. Ein erneut nötiger
Technical-Lead-Refinementauftrag war nach der automatischen Deduplizierung nicht
auslösbar.

## Lösung

- Ticketkarten und Details lösen Assignee-IDs über das Scrum-Team zu Namen und
  Rollen auf.
- Projektionslogik wertet QA-Kommentare mit `[x]`/`[ ]`-Checklisten aus und
  markiert passende Akzeptanzkriterien inklusive Verifikator und Zeitpunkt.
- Der Header nennt aktive hostgeführte Arbeit „Paperclip project delivery“ statt
  einen fehlenden lokalen Sprint zu behaupten.
- Der Projektbereich zeigt den letzten Workflow-Event und erklärt, dass
  automatisches Planning auf ein TL-Refinement mit Schätzung und Kriterien
  wartet.
- Ein separater Retry-Befehl kann den Technical Lead erneut anfordern, ohne
  automatische Events zu wiederholen.

## Akzeptanzkriterien

- Karten und Details zeigen bekannte Agentennamen statt UUIDs.
- QA-Checklisten aktualisieren die passenden sichtbaren ACs.
- Aktive Projektlieferung wird nicht als fehlender Sprint bezeichnet.
- Refinement-Events sind im Projektbereich sichtbar.
- Ein expliziter Retry weckt den Technical Lead erneut, automatische Requests
  bleiben jedoch je Ticket dedupliziert.

## Validierung

- Unit-Tests prüfen Agentenauflösung, QA-Checkbox-Projektion und vollständige
  QA-Checklisten mit verkürzten Überschriften.
- Worker-Harness prüft automatische und explizit wiederholte
  Technical-Lead-Refinementanforderungen.
- `pnpm test`: 19 Testdateien, 342 Tests erfolgreich.
- `pnpm typecheck` und `pnpm build`: erfolgreich.
- Lokale Installation: `schapat.agent-scrum v2.0.6`, Status `ready`,
  Health-Check `healthy`.
- Browser-Smoke-Test für TestCompany:
  - Header zeigt „Paperclip project delivery“ statt „No active sprint“.
  - Karten zeigen „QA Engineer“ und „Developer 1“ statt UUIDs.
  - `TES-3` zeigt `4/4 AC`.
  - Der Projektbereich zeigt den letzten Refinement-Event und den
    Planning-Vorbehalt; „Retry refinement (6)“ hat den Technical Lead für alle
    noch unrefinierten Tickets erneut angefordert.
- Der Paperclip-Live-Run des Technical Leads ist nach dem Retry aktiv und
  liefert fortlaufend Ausgabe; die Eventkette endet damit nicht beim lokalen
  Ceremony-Record.