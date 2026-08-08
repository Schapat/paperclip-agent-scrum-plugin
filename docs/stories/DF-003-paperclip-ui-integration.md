# DF-003: Paperclip-konforme Scrum-Board-Integration

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-08

## Problem

Das Scrum Board verwendet globale CSS-Selektoren und einen globalen Reset. Als
eingebettete Paperclip-Page überschreiben diese Regeln Host-Layout und
Komponentenklassen, wodurch das Board als unstrukturierter Text erscheint.
Zusätzlich fehlt ein registrierter Sidebar-Eintrag für die Board-Route.

## Akzeptanzkriterien

- Board-CSS wirkt ausschließlich innerhalb des Agent-Scrum-Roots.
- Das Board übernimmt Paperclips helle, zurückhaltende Einbettung und zerstört
  keine Host-Layout-Regeln.
- Die linke Paperclip-Navigation enthält einen Eintrag für das Scrum Board.
- Der Eintrag navigiert zur organisationsbezogenen Route `scrum-board`.
- Build, Typecheck und die lokale eingebettete Board-Seite sind geprüft.

## Validierung

- `pnpm test`: 313 Tests bestanden.
- `pnpm typecheck`: bestanden.
- `pnpm clean && pnpm build`: bestanden; das UI liegt als JavaScript-Bundle mit
  eingebettetem Stylesheet vor.
- Lokale Paperclip-Page: Desktop- und Mobile-Screenshot geprüft.
- Der Sidebar-Link `Scrum Board` ist unter Work sichtbar und verweist auf die
  organisationsbezogene Route.