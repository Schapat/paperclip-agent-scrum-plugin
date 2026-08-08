# FE-001: Projektauftrag und Team-Start

**Klassifizierung:** Feature

**Status:** Erledigt

**Datum:** 2026-08-08

## Ziel

Ein Human kann ein bestehendes Paperclip-Projekt auswählen, einen konkreten
Auftrag eingeben und damit die Agentenarbeit kontrolliert starten. Das Team
analysiert zuerst die vorhandene Codebasis, leitet danach Stories ab und darf
erst nach einer expliziten Backlog-Freigabe automatisch liefern.

## Beispiel

Projekt: BMW Website

Auftrag: Einen responsiven, barrierefreien Image Slider mit dem bestehenden
Design System entwickeln, ohne eine unnötige neue Abhängigkeit einzuführen.

## Akzeptanzkriterien

- Der User kann ein vorhandenes Paperclip-Projekt und einen Arbeitsauftrag
  auswählen beziehungsweise eingeben.
- Das Plugin erzeugt einen projektgebundenen Root-Issue und beauftragt den
  Technical Lead mit der Analyse der Codebasis.
- Der Technical Lead erhält den Auftrag inklusive Projektkontext und dokumentiert
  Architektur, vorhandene Patterns, Tests und Risiken im Issue.
- Nach einer Human-Freigabe kann der Product Owner daraus Story-Vorschläge
  erstellen.
- Nach der Backlog-Freigabe wird der Product Owner über den Root-Issue erneut
  aufgeweckt und steuert die Child-Issues im Paperclip-Workflow.
- Der Ablauf und sein Status sind im Scrum Board sichtbar.

## Umsetzungsplan

1. **Domänenzustand und Trigger-Sperre**
   - Einen persistierten `ProjectOnboarding`-Zustand mit Projekt, Root-Issue,
     Auftrag und Fortschritt einführen.
   - Bestehende automatische Refinement-Trigger sperren, bis das Backlog vom
     Human freigegeben ist.
   - Migration und reine Unit-Tests für Status, Eingabe und Prompt bauen.

2. **Projektgebundener Startauftrag**
   - Vorhandene Paperclip-Projekte über `ctx.projects` anbieten.
   - Bei Start einen Root-Issue mit `projectId` und dem Auftrag erstellen.
   - Den Technical Lead als Issue-Assignee aufwecken, damit der Host den
     zugehörigen Projekt-Workspace bereitstellen kann.

3. **Geführte Übergaben**
   - Nach sichtbarer Technical-Lead-Analyse den PO auf demselben Root-Issue
     aufwecken.
   - Den PO anweisen, Stories als Child-Issues mit geerbtem Workspace zu
     erstellen.
   - Nach Human-Freigabe den PO erneut aufwecken, damit er die Child-Issues im
     Paperclip-Workflow zuweist und voranbringt.

4. **Board-Startpunkt**
   - Einen kompakten Projektauftrag-Dialog auf der Scrum-Board-Seite anzeigen.
   - Status, Projektname und die drei Human-Aktionen darstellen: Analyse
     starten, Story-Erstellung starten, Backlog freigeben.

5. **Host-Issues als Board-Quelle**
   - Erzeugte PO-Child-Issues in die lokale Kanban-Darstellung spiegeln.
   - Paperclip als führende Quelle für Status, Zuweisung und Review behandeln.
   - Den bisherigen lokalen `ScrumTask`-Pfad für projektgebundene Tickets nicht
     mehr parallel mutieren.

## Fortschritt

- Erledigt: Persistierter Onboarding-Status mit abwärtsvertraglicher Migration.
- Erledigt: Sperre für automatisches und manuelles Planning/Refinement bis zur
  Backlog-Freigabe.
- Erledigt: Projektprüfung, Root-Issue, Technical-Lead-Wakeup und geführte
  Übergabe an den Product Owner.
- Erledigt: Board-Startpunkt mit den Human-Aktionen Analyse starten,
  Story-Erstellung starten und Backlog freigeben.
- Erledigt: PO-Child-Issues werden idempotent per Host-Event in das Kanban
  gespiegelt, beim Worker-Neustart rehydriert und bei Stornierung oder
  Umhängung entfernt.
- Erledigt: Projektgebundene Tickets sind im Board bewusst read-only; die
  Backlog-Freigabe wird auf dem Root-Issue protokolliert und weckt den PO für
  den Host-Workflow erneut auf.

## Ausblick

`FE-002` erweitert die lokalen Ceremonies später zu Write-through-Adaptern für
Paperclip-Issues. Bis dahin ist die klare Zuständigkeit absichtlich: Paperclip
steuert Status, Zuweisung und Review; das Scrum Board spiegelt diesen Zustand.

## Validierung

- `pnpm test`: 312 Tests bestanden.
- `pnpm typecheck`: bestanden.
- `pnpm build`: bestanden.

## Abgrenzung

Der erste Slice unterstützt einen aktiven Projektauftrag je Organisation. Eine
vollständige Mehrprojektansicht und die automatische Erkennung fertiger
Agentenanalysen folgen nach der validierten Startstrecke.