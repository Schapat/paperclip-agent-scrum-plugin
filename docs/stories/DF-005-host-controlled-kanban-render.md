# DF-005: Hostgeführtes Kanban ohne Drag-and-drop rendern

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-08

## Problem

Projektgebundene Tickets deaktivieren Drag-and-drop bewusst, weil Paperclip die
führende Quelle für Status und Zuweisung ist. `KanbanBoard` entfernte dadurch den
`DragDropProvider`, während `KanbanBoardInner` den Kontext weiterhin zwingend
über `useDragDrop()` las. Die Plugin-Page brach mit `useDragDrop must be used
within a DragDropProvider` ab.

## Akzeptanzkriterien

- Das Kanban rendert mit `enableDragDrop=false` ohne React-Fehler.
- Hostgeführte Tickets bleiben nicht verschiebbar.
- Drag-and-drop bleibt für lokale Tickets unverändert funktional.

## Validierung

- Der zuvor rote lokale Paperclip-Renderfall lädt nach dem Worker-Upgrade ohne
	Fehlergrenze.
- Das Kanban erscheint mit hostgeführten Tickets und deaktiviertem Drag-and-drop.