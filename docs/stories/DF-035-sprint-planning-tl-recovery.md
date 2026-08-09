# DF-035: Falsch blockierte, bereite Projekt-Tickets an freie Developer zurueckgeben

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

`ACMA-9` war als direktes Child-Issue des Kickoffs fachlich und technisch
bereit, wurde aber vor dem menschlichen Sprintstart dem Technical Lead als
`in_progress` zugewiesen. Nach einem verlorenen Technical-Lead-Prozess setzte
Paperclip das Ticket auf `blocked`.

Die Developer blieben dabei korrekt idle: Das Projekt stand noch in
`sprint_planning`, in dem die explizite menschliche Sprintfreigabe die
Implementierung sperrt. Der Fehler war, dass die bestehende Worker-Planung nur
bereite `backlog`-Tickets auswählt und der Blocker-Resolver Tickets ohne native
`blockedBy`-Relation bewusst überspringt. Das falsch blockierte Ticket konnte
somit weder den Sprintstart entsperren noch später einem Developer zugewiesen
werden.

## Loesung

- Der Worker erkennt im `sprint_planning` ein direktes Projekt-Ticket, das
  ohne native Blocker beim Technical Lead blockiert ist.
- Die Recovery greift nur bei vollständig verfeinerten, geschätzten Tickets mit
  Akzeptanzkriterien.
- Das Ticket wird nach `backlog` zurückgeführt, der falsche Assignee entfernt
  und die Recovery im Ticket kommentiert.
- Die Regel läuft sowohl bei eingehenden Host-Events als auch bei der
  Board-Hydration nach einem Worker-Neustart.
- Der menschliche Sprintstart bleibt unverändert erforderlich; erst danach
  weist die vorhandene Planung einem freien Developer das Ticket zu.

## Akzeptanzkriterien

- Ein ready Ticket im `sprint_planning`, das beim Technical Lead ohne native
  Blocker blockiert ist, kehrt unassigned ins Backlog zurück.
- Die Recovery startet keine Development-Arbeit und umgeht keine menschliche
  Sprintfreigabe.
- Nach **Start first sprint** plant die bestehende Automation das Ticket auf
  `todo` und weist einen freien Developer zu.
- Ein Ticket mit echter `blockedBy`-Relation bleibt weiterhin blockiert.

## Validierung

- Neuer Worker-Regressionstest deckt Recovery, Sprintfreigabe und automatische
  Developer-Zuweisung ab.
- Vollstaendige Vitest-Suite: 24 Dateien, 401 Tests erfolgreich.
- `./node_modules/.bin/tsc --noEmit`, `node ./esbuild.config.mjs` und
  Editor-Diagnosen erfolgreich.
- Lokale Plugin-Instanz aktualisiert: Status `ready`, `lastError: null`.
- Live: `ACMA-9` wurde von `blocked` beim Technical Lead nach `backlog` ohne
  Assignee zurückgeführt; der Recovery-Kommentar ist vorhanden und das Board
  zeigt **Start first sprint**.