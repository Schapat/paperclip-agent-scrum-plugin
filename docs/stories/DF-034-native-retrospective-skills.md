# DF-034: Retrospektiv-Skills werden nicht als native Paperclip Skills veroeffentlicht

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Die Sprint-Retrospektive erzeugte lokale `AgentSkill`-Objekte im Company-State
des Plugins. Der Agent Log zeigte deshalb aktivierte Skills an, aber sie
erschienen weder unter den Company Skills noch unter den Skills eines Agents in
Paperclip. Die Anwendung war auf temporaeren Prompt-Kontext bei der naechsten
Agent-Invocation beschraenkt und nicht dauerhaft im nativen Skill-Modell
nachvollziehbar.

## Loesung

- Jeder lokale Retrospektiv-Skill wird als native, plugin-eigene Company Skill
  mit einem stabilen `agent-scrum-learning-{skillId}`-Slug veroeffentlicht.
- Auch inaktive Skills sind dadurch in **Company -> Skills** sichtbar. Nur
  aktive Skills werden automatisch den passenden Scrum-Rollen zugeordnet.
- Der Agent-Sync uebernimmt die vollstaendige vorhandene `desiredSkills`-Liste
  und ergaenzt nur den neuen Skill. Bereits aktivierte fremde Skills bleiben
  erhalten.
- Die einmalig versorgten Agent-IDs werden am lokalen Skill gespeichert. Eine
  manuelle Deaktivierung im nativen **Agent -> Skills**-UI wird deshalb nicht
  bei einem spaeteren Board-Refresh stillschweigend rueckgaengig gemacht.
- Die Synchronisation laeuft direkt nach lokalen, manuellen und
  projektabschlussbedingten Retrospektiven.

## Akzeptanzkriterien

- Ein Retro-Skill erscheint unter den Company Skills mit eindeutiger,
  Plugin-eigener Kennung.
- Ein aktiver Skill wird nur den Agents zugeordnet, deren Rolle in seinem
  Rollenbereich liegt.
- Ein inaktiver Skill wird nicht automatisch einem Agent zugeordnet.
- Bestehende native Agent-Skills werden durch die Zuordnung nicht entfernt.
- Manuelle Aenderungen an einer nativen Skill-Zuordnung bleiben nachfolgenden
  Board-Updates erhalten.

## Validierung

- Worker-Regression prueft die Veroeffentlichung, die Zuordnung beider
  Developer, den Erhalt vorhandener Paperclip-Skills und den persistierten
  Bootstrap-Marker.
- Skill-Sync-Tests pruefen eindeutige ID-basierte Slugs, die Bibliotheks-
  Reconciliation und den vollstaendigen Sollzustand beim Agent-Sync.