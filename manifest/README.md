# Plugin Manifest

Dieses Verzeichnis enthält die Manifest-Definition für das Autonomous Scrum Team Plugin.

## Dateien

- `manifest.js` - Haupt-Manifest mit allen Plugin-Metadaten
- `types.ts` - TypeScript-Definitionen für das Manifest-Schema

## Capabilities (Berechtigungen)

Das Plugin benötigt folgende Paperclip-Berechtigungen:

### Agent Management

| Capability | Beschreibung | Verwendung |
|------------|--------------|------------|
| `agents:create` | Neue Agents erstellen | Scrum-Team erstellen (PO, SM, Devs, QA) |
| `agents:configure` | Agent-Konfiguration ändern | Team-Einstellungen anpassen |
| `agents:read` | Agent-Status lesen | Team-Übersicht im Kanban-Board |

### Issue Management

| Capability | Beschreibung | Verwendung |
|------------|--------------|------------|
| `issues:read` | Issues/Tasks lesen | Backlog und Sprint-Tasks anzeigen |
| `issues:write` | Issues erstellen/ändern | Tasks erstellen, Status ändern |
| `issues:comment` | Kommentare posten | Standup-Reports, Review-Feedback |

### Routines

| Capability | Beschreibung | Verwendung |
|------------|--------------|------------|
| `routines:create` | Routinen erstellen | Daily Standup, Sprint-Zeremonien |
| `routines:configure` | Routinen konfigurieren | Schedule anpassen |
| `routines:trigger` | Routinen auslösen | Manuelle Routine-Trigger |

### Projekt-Kontext

| Capability | Beschreibung | Verwendung |
|------------|--------------|------------|
| `projects:read` | Projekt-Informationen lesen | Projekt-Kontext für Board |

## UI Slots

### Custom Pages

| Slug | Titel | Beschreibung |
|------|-------|--------------|
| `kanban` | Scrum Board | Live-Kanban-Board mit Sprint-Übersicht |

### Widgets

| Slug | Titel | Beschreibung |
|------|-------|--------------|
| `sprint-progress` | Sprint Progress | Burndown-Chart und Velocity |
| `team-status` | Team Status | Agent-Status Übersicht |

## Konfigurationsoptionen

### Team-Größe

```javascript
developerCount: {
  type: 'number',
  default: 2,
  min: 1,
  max: 5
}
```

Anzahl der Developer-Agents im Team.

### WIP-Limits

```javascript
wipLimit: {
  type: 'number',
  default: 3,
  min: 1,
  max: 10
}
```

Maximale gleichzeitige Tasks pro Developer (Kanban Best Practice).

### Sprint-Dauer

```javascript
sprintDurationDays: {
  type: 'number',
  default: 14,
  min: 7,
  max: 30
}
```

### Scrum-Zeremonien

```javascript
enableDailyStandup: { type: 'boolean', default: true }
standupTime: { type: 'string', default: '0 9 * * 1-5' }  // 9:00 Uhr, Mo-Fr
enableRetro: { type: 'boolean', default: true }
```

### Automatisierung

```javascript
autoAssignTasks: { type: 'boolean', default: true }
autoCreateSubtasks: { type: 'boolean', default: false }
```

### Story Points

```javascript
useStoryPoints: { type: 'boolean', default: true }
defaultStoryPoints: { type: 'select', options: [1, 2, 3, 5, 8, 13], default: 3 }
```

## Agent Templates

Bei Plugin-Installation werden folgende Agents erstellt:

| Role | Name | Anzahl |
|------|------|--------|
| Product Owner | Product Owner | 1 |
| Scrum Master | Scrum Master | 1 |
| Technical Lead | Technical Lead | 1 |
| Developer | Developer 1, 2, ... | `config.developerCount` |
| QA Engineer | QA Engineer | 1 |

## Routine Templates

| Routine | Trigger | Beschreibung |
|---------|---------|--------------|
| Daily Standup | Cron (config) | Täglicher Status-Report |
| Sprint Review | sprint:end | Review am Sprint-Ende |
| Sprint Retro | sprint:end | Retrospektive |
| Backlog Grooming | Cron (Mi 14:00) | Wöchentliche Backlog-Pflege |

## Verwendung

Das Manifest wird beim Build-Prozess geladen und validiert:

```bash
pnpm build:manifest
```

Die TypeScript-Types können importiert werden:

```typescript
import type { PluginManifest, ResolvedPluginConfig } from './manifest/types';
```
