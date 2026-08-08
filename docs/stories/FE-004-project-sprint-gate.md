# FE-004: Verpflichtendes Sprint Planning für neue Projekt-Onboardings

**Klassifizierung:** Feature

**Status:** Erledigt

**Datum:** 2026-08-09

## Ziel

Neue Projektaufträge sollen standardmäßig nicht in die Lieferung starten, bevor
ein Human nach Technical-Lead-Refinement den ersten Sprint bewusst startet.
Die Einstellung bleibt pro Organisation optional, ist jedoch standardmäßig
aktiviert.

## Lösung

- Neue Projekte erfassen beim Start `requiresSprint` aus der
  Plugin-Einstellung `requireProjectSprint`.
- Nach Backlogfreigabe folgt bei aktivierter Einstellung der Status
  `sprint_planning`, nicht direkt `active`.
- Erst ein verfeinertes und geschätztes Backlog-Ticket entsperrt **Start first
  sprint**.
- Der Sprintstart erzeugt einen lokalen aktiven `ScrumSprint`, startet die
  hostgeführte Planung und ordnet geplante Paperclip-Issues dem Sprint zu.
- Bei deaktivierter Einstellung bleibt der bisherige Direktlieferpfad erhalten.

## Akzeptanzkriterien

- `requireProjectSprint` ist in den Plugin-Settings vorhanden und standardmäßig
  `true`.
- Neue Projektaufträge bleiben nach Backlogfreigabe in `sprint_planning`.
- Ohne verfeinertes Backlog-Ticket kann kein Sprint gestartet werden.
- Der Sprintstart legt einen aktiven Sprint an und plant sprintreife Tickets
  hostseitig nach TODO.
- Ein explizit deaktivierter Toggle erlaubt weiterhin die Direktlieferung.

## Validierung

- Domain-Test deckt Status `sprint_planning`, die aktive Sprint-Factory und die
  zweiwöchige Standardlaufzeit ab.
- Worker-Harness deckt den standardmäßigen Sprint-Gate, den explizit
  deaktivierten Direktlieferpfad, TL-Refinement, den Human-Sprintstart und die
  hostseitige TODO-Planung ab.
- `pnpm test`: 19 Testdateien, 344 Tests erfolgreich.
- `pnpm typecheck` und `pnpm build`: erfolgreich.
- Lokale Installation: `schapat.agent-scrum v2.0.8`, Status `ready`,
  Health-Check `healthy`.
- Bestehende aktive Projekte migrieren mit `requiresSprint: false` und werden
  nicht nachträglich angehalten; neue Aufträge erfassen den standardmäßigen
  Sprint-Gate beim Start.