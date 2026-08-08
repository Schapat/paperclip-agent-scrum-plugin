# Architektur-Dokumentation

## Übersicht

Das Autonomous Scrum Team Plugin folgt einer **Event-Driven Architecture** mit klarer Trennung zwischen Worker (Backend) und UI (Frontend).

## Architektur-Diagramm

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Paperclip Host                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  Plugin Loader  │  │  Plugin Storage │  │   Paperclip API     │  │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘  │
└───────────┼─────────────────────┼──────────────────────┼────────────┘
            │                     │                      │
            ▼                     ▼                      ▼
┌───────────────────────────────────────────────────────────────────────┐
│                    Plugin: Autonomous Scrum Team                       │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                        Manifest Layer                             │ │
│  │  • Plugin-Identifikation (Name, Version, Author)                 │ │
│  │  • Capabilities (Berechtigungen)                                 │ │
│  │  • Config Schema (User-konfigurierbare Settings)                 │ │
│  │  • Agent Templates                                               │ │
│  │  • Routine Templates                                             │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─────────────────────────┐    ┌─────────────────────────────────┐  │
│  │      Worker (Backend)    │◄──►│         UI (Frontend)           │  │
│  │                         │    │                                 │  │
│  │  ┌───────────────────┐  │    │  ┌───────────────────────────┐  │  │
│  │  │   State Machine   │  │    │  │     React Components      │  │  │
│  │  │  ┌─────────────┐  │  │    │  │  ┌─────────────────────┐  │  │  │
│  │  │  │   Rules     │  │  │    │  │  │   KanbanBoard       │  │  │  │
│  │  │  └─────────────┘  │  │    │  │  └─────────────────────┘  │  │  │
│  │  │  ┌─────────────┐  │  │    │  │  ┌─────────────────────┐  │  │  │
│  │  │  │ Transitions │  │  │    │  │  │   SprintView        │  │  │  │
│  │  │  └─────────────┘  │  │    │  │  └─────────────────────┘  │  │  │
│  │  │  ┌─────────────┐  │  │    │  │  ┌─────────────────────┐  │  │  │
│  │  │  │  Executor   │  │  │    │  │  │   Settings          │  │  │  │
│  │  │  └─────────────┘  │  │    │  │  └─────────────────────┘  │  │  │
│  │  └───────────────────┘  │    │  └───────────────────────────┘  │  │
│  │                         │    │                                 │  │
│  │  ┌───────────────────┐  │    │  ┌───────────────────────────┐  │  │
│  │  │ Paperclip Client  │  │    │  │     Zustand Store         │  │  │
│  │  └───────────────────┘  │    │  └───────────────────────────┘  │  │
│  │                         │    │                                 │  │
│  │  ┌───────────────────┐  │    │  ┌───────────────────────────┐  │  │
│  │  │     Onboarding    │  │    │  │    Drag & Drop Context    │  │  │
│  │  └───────────────────┘  │    │  └───────────────────────────┘  │  │
│  │                         │    │                                 │  │
│  │  ┌───────────────────┐  │    │                                 │  │
│  │  │   Lifecycle Hooks │  │    │                                 │  │
│  │  └───────────────────┘  │    │                                 │  │
│  └─────────────────────────┘    └─────────────────────────────────┘  │
│              │                                │                        │
│              │          postMessage           │                        │
│              └────────────────────────────────┘                        │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## Schichten-Modell

### 1. Manifest Layer

Die `manifest.js` definiert die Plugin-Metadaten:

```javascript
{
  name: 'Autonomous Scrum Team',
  version: '1.0.0',
  capabilities: ['issues:read', 'issues:write', ...],
  config: { developerCount: {...}, wipLimit: {...} },
  agentTemplates: { productOwner: {...}, scrumMaster: {...} },
  routineTemplates: { dailyStandup: {...}, sprintRetro: {...} }
}
```

### 2. Worker Layer (Backend)

Der Worker ist ein Web Worker, der isoliert vom UI-Thread läuft:

- **State Machine**: Verwaltet Workflow-Logik
- **Paperclip Client**: API-Kommunikation
- **Onboarding**: Initiale Team-Erstellung
- **Lifecycle Hooks**: Plugin-Events (install, configure, etc.)

### 3. UI Layer (Frontend)

React-basierte Single Page Application:

- **Zustand**: State Management Library
- **Components**: Modulare React-Komponenten
- **Drag & Drop**: Kanban-Interaktion

## Kommunikation

### Worker ↔ UI

```typescript
// UI sendet Aktion
postMessage({ type: 'CREATE_TASK', payload: { title, description } });

// Worker empfängt und verarbeitet
self.onmessage = (event) => {
  const { type, payload } = event.data;
  switch (type) {
    case 'CREATE_TASK':
      const task = createTask(payload);
      postMessage({ type: 'TASK_CREATED', payload: { task } });
      break;
  }
};
```

### Worker ↔ Paperclip API

```typescript
// Über Paperclip Client
const client = new PaperclipClient(env);

// Issue erstellen
const task = await client.createIssue({
  title: 'Login Feature',
  description: 'Implementiere Login...',
  status: 'todo',
  assigneeAgentId: developerId
});
```

## State Machine

Die State Machine ist das Herzstück der Workflow-Logik:

```
┌────────────────────────────────────────────────────────────┐
│                    State Machine                           │
│                                                            │
│  ┌──────────────┐                                         │
│  │    Rules     │ ── evaluiert Zustand ──┐                │
│  │   Engine     │                        │                │
│  └──────────────┘                        ▼                │
│                                    ┌───────────┐          │
│  ┌──────────────┐                  │  Actions  │          │
│  │ Transitions  │ ── validiert ──► │  Queue    │          │
│  │  Validator   │                  └─────┬─────┘          │
│  └──────────────┘                        │                │
│                                          ▼                │
│                                    ┌───────────┐          │
│                                    │  Action   │          │
│                                    │  Executor │          │
│                                    └───────────┘          │
│                                          │                │
│                                          ▼                │
│                                    ┌───────────┐          │
│                                    │  State    │          │
│                                    │  Update   │          │
│                                    └───────────┘          │
└────────────────────────────────────────────────────────────┘
```

### Rules Engine

Regeln werden kontinuierlich evaluiert:

```typescript
const rules: Rule[] = [
  {
    id: 'RULE_NO_DEVELOPMENT',
    priority: 'critical',
    condition: (state) => state.tasks.filter(t => t.column === 'in_progress').length === 0,
    action: { type: 'notify_developers' }
  }
];
```

### Transition Validator

Jede Status-Änderung wird validiert:

```typescript
const ALLOWED_TRANSITIONS: StatusTransition[] = [
  { from: 'backlog', to: 'todo', requiresReason: false },
  { from: 'todo', to: 'in_progress', requiresReason: false },
  { from: 'in_progress', to: 'in_review', requiresReason: false },
  { from: 'in_review', to: 'done', requiresReason: false },
  { from: 'in_review', to: 'in_progress', requiresReason: true }
];
```

## Datenfluss

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│   User   │───►│    UI    │───►│  Worker  │───►│ Paperclip│
│  Action  │    │ (React)  │    │ (State)  │    │   API    │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │               │               │
                     │               │               │
                     ▼               ▼               ▼
              ┌──────────┐    ┌──────────┐    ┌──────────┐
              │  Local   │    │ In-Memory│    │  Remote  │
              │ Storage  │    │  State   │    │ Storage  │
              └──────────┘    └──────────┘    └──────────┘
```

1. **User Action**: Drag & Drop, Button-Click
2. **UI**: Dispatcht Message an Worker
3. **Worker**: Validiert, aktualisiert State, sendet an API
4. **Paperclip API**: Persistiert in Remote Storage
5. **Worker**: Sendet State Update an UI
6. **UI**: Re-rendert Komponenten

## Persistenz-Strategie

| Daten | Storage | Sync |
|-------|---------|------|
| Settings | localStorage | Sofort |
| Tasks | Paperclip Issues | Sofort |
| Sprints | Paperclip Projects | Sofort |
| Metriken | Worker Memory | Sprint-Ende |
| Changelog | Worker Memory | Bei Änderung |

## Sicherheit

- **Capabilities**: Explizite Berechtigungen im Manifest
- **Isolation**: Worker läuft in separatem Thread
- **Validation**: Alle Eingaben werden serverseitig validiert
- **Auth**: Paperclip API Token-basiert

## Performance

- **Bundle Sizes**:
  - Worker: 93.1kb (gzip: ~30kb)
  - UI: 436kb (gzip: ~120kb)
  
- **Optimierungen**:
  - Lazy Loading für Widgets
  - Debounced State Updates
  - Memoization in React Components
