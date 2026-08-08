# DF-007: Host-Projektion für Ticketdetails und Fortschritt

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Projektgebundene Paperclip-Issues werden im Scrum Board nur mit Titel, Text,
Status und Zuweisung materialisiert. Host-Kommentare werden nicht übertragen;
deshalb bleiben die Kommentar- und Entscheidungsansicht leer. Paperclip speichert
Story Points und Refinement-Felder nicht nativ am Issue, und die bisherigen
Technical-Lead-Kommentare liefern keine maschinenlesbare Schätzung. Dadurch
bleiben lokale Punkte und Dashboard-Fortschritt bei null.

## Lösung

- Host-Kommentare werden in die Ticketdetails projiziert.
- Der Technical Lead veröffentlicht Refinementdaten über einen versionierten
  `agent-scrum:refinement:v1`-Marker im Issue-Kommentar.
- Nur ein Marker des aufgelösten Technical Leads mit Story Points und mindestens
  einem Akzeptanzkriterium macht ein Ticket sprintreif.
- Strukturierte Agentenentscheidungen verwenden einen
  `agent-scrum:decision:v1`-Marker.
- Die Projektion leitet Story Points, Akzeptanzkriterien, technische Hinweise,
  Kommentare und Entscheidungen aus dem Host ab.
- Das Dashboard verwendet für projektgebundene Arbeit Punktfortschritt, sofern
  alle Tickets geschätzt sind; vorher den sichtbaren Taskfortschritt.
- Nach der Human-Freigabe wird fehlendes Refinement einmalig beim Technical Lead
  angefordert. Ein danach sprintreifes Backlog-Issue wird als echte
  Paperclip-Transition nach TODO verschoben, einem freien Developer zugewiesen
  und aufgeweckt.

## Akzeptanzkriterien

- Host-Kommentare erscheinen im Kommentar-Tab des Scrum Boards.
- Strukturierte Entscheidungen erscheinen im Entscheidungs-Tab.
- Ein gültiger Technical-Lead-Refinementmarker setzt Story Points und macht ein
  Ticket refined.
- Ein Refinementmarker eines anderen Agents oder ohne Akzeptanzkriterium macht
  ein Ticket nicht sprintreif.
- Das Projekt-Dashboard zeigt Fortschritt auch ohne aktiven lokalen Sprint.
- Teilweise geschätzte Backlogs zeigen keinen irreführenden Punktfortschritt.
- Neue Host-Kommentare aktualisieren die Projektion ohne Worker-Neustart.
- Nach der Backlog-Freigabe wird ein fehlendes Refinement genau einmal beim
  Technical Lead angefordert.
- Ein sprintreifes Projekt-Issue wird im Paperclip-Host nach TODO geplant und
  einem Developer zugewiesen.

## Validierung

- `pnpm test`: 17 Testdateien, 334 Tests erfolgreich.
- `pnpm typecheck` und `pnpm build`: erfolgreich.
- Lokale Installation: `schapat.agent-scrum v2.0.2`, Status `ready`,
  Health-Check `healthy`.
- Browser-Smoke-Test: Der Kommentar-Tab zeigt echte Paperclip-Kommentare,
  der Entscheidungs-Tab zeigt Host-Statuswechsel, und das Dashboard zeigt für
  „Webseite Wiebusch“ `3 / 5 tasks complete (60%)` sowie `0/5 tasks refined`.