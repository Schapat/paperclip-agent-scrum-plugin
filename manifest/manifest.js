/**
 * Autonomous Scrum Team Plugin Manifest
 *
 * Dieses Manifest definiert die Plugin-Metadaten, Capabilities und
 * Konfigurationsoptionen für das Paperclip Plugin-System.
 *
 * Das Plugin erstellt ein vollständig autonomes Scrum-Team mit KI-Agents,
 * die Tasks selbstständig bearbeiten, Daily Standups durchführen und
 * Sprint-Zyklen verwalten.
 */

// @ts-check

/**
 * @typedef {Object} PluginManifest
 * @property {string} name - Plugin-Name
 * @property {string} version - Semver-Version
 * @property {string} description - Kurze Plugin-Beschreibung
 * @property {string} author - Plugin-Autor
 * @property {string[]} capabilities - Benötigte Paperclip-Berechtigungen
 * @property {Object} ui - UI-Slot-Registrierungen
 * @property {Object} config - Konfigurierbare Optionen
 * @property {Object} worker - Worker-Konfiguration
 * @property {string[]} requiredSecrets - Benötigte Secrets (optional)
 */

/** @type {PluginManifest} */
const manifest = {
  // ==========================================================================
  // Plugin-Identifikation & Metadaten
  // ==========================================================================

  name: 'Autonomous Scrum Team',
  version: '1.3.0',
  description:
    'Vollständig autonomes Scrum-Team mit KI-Agents. Automatisiert Sprint-Planung, Daily Standups, Task-Bearbeitung und Retrospektiven.',
  author: 'Roblox Fabrik',

  // ==========================================================================
  // Capabilities (Required Permissions)
  // ==========================================================================
  // Jede Capability muss vom Board beim Plugin-Install genehmigt werden.

  capabilities: [
    // Agent-Management
    'agents:create', // Neue Scrum-Team-Agents erstellen (PO, SM, Devs, QA)
    'agents:configure', // Agent-Konfiguration anpassen
    'agents:read', // Agent-Status und -Details lesen

    // Issue-Management
    'issues:read', // Tasks/Stories aus dem Backlog lesen
    'issues:write', // Tasks erstellen, updaten, Status ändern
    'issues:comment', // Kommentare auf Issues posten (Standups, Reviews)

    // Routinen für Scrum-Zeremonien
    'routines:create', // Automatisierte Routinen erstellen
    'routines:configure', // Routine-Schedule anpassen
    'routines:trigger', // Routinen manuell auslösen

    // Projekt-Kontext
    'projects:read', // Projekt-Informationen lesen
  ],

  // ==========================================================================
  // UI Slots (Custom Pages & Widgets)
  // ==========================================================================

  // Alle UI-Slots werden als benannte Exports aus dem Library-Bundle geladen
  // (vite.config.ts baut ./ui/exports.tsx nach dist/ui/index.js).
  ui: {
    entry: './dist/ui/index.js',

    // Custom Pages erscheinen in der Hauptnavigation
    pages: [
      {
        slug: 'kanban',
        title: 'Scrum Board',
        description: 'Live-Kanban-Board mit Sprint-Übersicht und Team-Status',
        export: 'ScrumBoardPage',
        icon: 'layout-kanban', // Lucide Icon Name
      },
    ],

    // Widgets für Dashboard-Integration (optional)
    widgets: [
      {
        slug: 'sprint-progress',
        title: 'Sprint Progress',
        description: 'Burndown-Chart und Sprint-Velocity',
        export: 'SprintProgressWidget',
        size: { minWidth: 300, minHeight: 200 },
      },
      {
        slug: 'team-status',
        title: 'Team Status',
        description: 'Aktueller Status aller Scrum-Team-Members',
        export: 'TeamStatusWidget',
        size: { minWidth: 250, minHeight: 150 },
      },
    ],

    // Weitere Slots aus demselben Bundle
    sidebar: [{ slug: 'scrum-board-link', export: 'ScrumBoardSidebarLink' }],
    settingsPage: { slug: 'scrum-board-settings', export: 'ScrumBoardSettingsPage' },
  },

  // ==========================================================================
  // Plugin-Konfiguration (User-configurable Settings)
  // ==========================================================================
  // Diese Einstellungen werden dem Board/User bei der Plugin-Konfiguration
  // angezeigt und können ohne Code-Änderungen angepasst werden.

  config: {
    // Team-Zusammensetzung
    developerCount: {
      type: 'number',
      label: 'Anzahl Entwickler',
      description: 'Wie viele Developer-Agents sollen erstellt werden?',
      default: 2,
      min: 1,
      max: 5,
      required: true,
    },

    // WIP-Limits (Work in Progress)
    wipLimit: {
      type: 'number',
      label: 'WIP-Limit pro Developer',
      description:
        'Maximale Anzahl gleichzeitiger Tasks pro Developer (Kanban Best Practice)',
      default: 3,
      min: 1,
      max: 10,
      required: true,
    },

    // Sprint-Konfiguration
    sprintDurationDays: {
      type: 'number',
      label: 'Sprint-Dauer (Tage)',
      description: 'Länge eines Sprints in Tagen',
      default: 14,
      min: 7,
      max: 30,
      required: true,
    },

    // ------------------------------------------------------------------------
    // Scrum-Zeremonien
    // ------------------------------------------------------------------------
    // Alle Zeremonien werden durch den Board-Zustand ausgelöst, nicht durch
    // Uhrzeiten: die KI-Agents arbeiten schneller, als ein Zeitplan abbilden
    // könnte. Ein Daily "um 9 Uhr" wäre für sie bedeutungslos. Konfigurierbar
    // ist deshalb nur, ob ein Trigger greift.

    enableAutoPlanning: {
      type: 'boolean',
      label: 'Sprint Planning automatisch',
      description: 'Startet das Planning, sobald TODO leerläuft und sprintreife Tickets bereitliegen',
      default: true,
    },

    enableAutoRefinement: {
      type: 'boolean',
      label: 'Backlog Refinement automatisch',
      description: 'Startet das Refinement, wenn der Vorrat an sprintreifen Tickets zur Neige geht',
      default: true,
    },

    enableAutoImpediments: {
      type: 'boolean',
      label: 'Blocker & Leerlauf automatisch beheben',
      description:
        'Hebt aufgelöste Blockaden auf, eskaliert echte Blocker und belegt freie Entwicklerkapazität',
      default: true,
    },

    enableAutoReview: {
      type: 'boolean',
      label: 'Review & Retrospektive automatisch',
      description:
        'Startet das Sprint Review, sobald alle Sprint-Tickets fertig sind; die Retrospektive folgt',
      default: true,
    },

    // Automatisierung
    autoAssignTasks: {
      type: 'boolean',
      label: 'Auto-Assignment',
      description:
        'Tasks automatisch an verfügbare Agents zuweisen basierend auf Kapazität und Skills',
      default: true,
    },

    autoCreateSubtasks: {
      type: 'boolean',
      label: 'Auto-Subtasks',
      description:
        'Bei großen Stories automatisch Subtasks erstellen lassen',
      default: false,
    },

    // Story Points
    useStoryPoints: {
      type: 'boolean',
      label: 'Story Points verwenden',
      description: 'Fibonacci-basierte Story Point Schätzungen',
      default: true,
    },

    defaultStoryPoints: {
      type: 'select',
      label: 'Default Story Points',
      description: 'Standard Story Points für neue Tasks',
      default: 3,
      options: [1, 2, 3, 5, 8, 13],
      dependsOn: { useStoryPoints: true },
    },
  },

  // ==========================================================================
  // Worker-Konfiguration
  // ==========================================================================

  worker: {
    entry: './worker/index.ts',
    // Events auf die der Worker reagiert
    events: [
      'plugin:install',
      'plugin:uninstall',
      'plugin:configure',
      'issue:created',
      'issue:updated',
      'issue:status_changed',
      'sprint:start',
      'sprint:end',
      'routine:trigger',
    ],
  },

  // ==========================================================================
  // Scrum-Team Agent Templates (für agents:create)
  // ==========================================================================
  // Diese Templates werden bei Plugin-Installation verwendet um das
  // initiale Team zu erstellen.

  agentTemplates: {
    productOwner: {
      name: 'Product Owner',
      role: 'product_owner',
      icon: 'crown',
      title: 'Product Owner',
      capabilities: [
        'Backlog-Priorisierung',
        'Sprint-Planung',
        'Stakeholder-Kommunikation',
        'Acceptance Criteria Definition',
      ],
      instructionsFile: './agents/product-owner.md',
    },

    scrumMaster: {
      name: 'Scrum Master',
      role: 'scrum_master',
      icon: 'shield-check',
      title: 'Scrum Master',
      capabilities: [
        'Sprint-Facilitation',
        'Blocker-Removal',
        'Daily Standup Moderation',
        'Retrospektive-Leitung',
        'Team-Velocity-Tracking',
      ],
      instructionsFile: './agents/scrum-master.md',
    },

    technicalLead: {
      name: 'Technical Lead',
      role: 'technical_lead',
      icon: 'cpu',
      title: 'Technical Lead',
      capabilities: [
        'Architektur-Entscheidungen',
        'Code-Review',
        'Technical Debt Management',
        'Mentoring',
      ],
      instructionsFile: './agents/technical-lead.md',
    },

    developer: {
      name: 'Developer',
      role: 'developer',
      icon: 'code',
      title: 'Developer',
      capabilities: [
        'Feature-Entwicklung',
        'Bug-Fixing',
        'Unit-Tests',
        'Code-Dokumentation',
      ],
      instructionsFile: './agents/developer.md',
      // Wird basierend auf config.developerCount mehrfach instanziiert
      instanceTemplate: true,
    },

    qaEngineer: {
      name: 'QA Engineer',
      role: 'qa',
      icon: 'bug',
      title: 'QA Engineer',
      capabilities: [
        'Test-Plan-Erstellung',
        'Manuelle Tests',
        'Bug-Reporting',
        'Regressions-Tests',
      ],
      instructionsFile: './agents/qa-engineer.md',
    },
  },

  // ==========================================================================
  // Zeremonien und ihre Auslösebedingungen
  // ==========================================================================
  // Bewusst *keine* Zeitpläne: jede Zeremonie hängt an einer Bedingung über
  // dem Board-Zustand (Spec §2, §4). Die Bedingungen sind in
  // worker/triggers/ceremony-triggers.ts implementiert und werden nach jeder
  // Zustandsänderung ausgewertet — flankengesteuert, damit eine anhaltende
  // Bedingung die Zeremonie nicht endlos wiederholt.
  //
  // Die Handler sind als benannte Exports aus ./worker/ceremonies verfügbar.
  // Manuell auslösbar über die Nachricht
  // { type: 'RUN_CEREMONY', payload: { ceremony } }.

  ceremonyHandlerModule: './worker/ceremonies',

  ceremonies: {
    sprintPlanning: {
      name: 'Sprint Planning',
      description: 'Priorisiert das Backlog, prüft Sprintreife und weist Tickets zu',
      ceremony: 'sprint_planning',
      handler: 'runSprintPlanning',
      enabledConfigKey: 'enableAutoPlanning',
      triggers: ['todo-empty'],
      outputs: ['Tickets in den Sprint gezogen', 'Skill-basierte Zuweisung', 'Umsetzung gestartet'],
    },

    backlogRefinement: {
      name: 'Backlog Refinement',
      description: 'Ergänzt Akzeptanzkriterien, Schätzungen und Abhängigkeiten',
      ceremony: 'backlog_refinement',
      handler: 'handleBacklogGrooming',
      enabledConfigKey: 'enableAutoRefinement',
      triggers: ['no-development', 'backlog-low'],
      outputs: [
        'Akzeptanzkriterien und Schätzung angefordert',
        'Große Tickets zur Zerlegung markiert',
        'Neue Backlog-Items beim PO angefordert',
      ],
    },

    // Kein Daily Scrum: Statusberichte sind für Agents wertlos, weil der
    // Board-Zustand für alle jederzeit sichtbar ist. Geblieben ist der einzige
    // Teil mit Wirkung — Blocker auflösen und Leerlauf beheben.
    impedimentResolution: {
      name: 'Impediment Resolution',
      description:
        'Hebt aufgelöste Blockaden auf, eskaliert echte Blocker und belegt freie Kapazität',
      ceremony: 'impediment_resolution',
      handler: 'handleImpediments',
      enabledConfigKey: 'enableAutoImpediments',
      triggers: ['blocked-tasks', 'developer-idle'],
      outputs: ['Ticket entblockt', 'Blocker eskaliert', 'Ticket zugewiesen und gestartet'],
    },

    sprintReview: {
      name: 'Sprint Review',
      description: 'QA präsentiert die Ergebnisse, Product Owner bewertet den Business Value',
      ceremony: 'sprint_review',
      handler: 'handleSprintReview',
      enabledConfigKey: 'enableAutoReview',
      triggers: ['sprint-complete'],
      outputs: ['Velocity festgeschrieben', 'Anschlussarbeiten vorgeschlagen', 'Übernahme entschieden'],
    },

    sprintRetro: {
      name: 'Sprint Retrospektive',
      description: 'Analysiert Bottlenecks aus Durchlaufzeiten und Review-Rückweisungen',
      ceremony: 'sprint_retrospective',
      handler: 'handleSprintRetro',
      enabledConfigKey: 'enableAutoReview',
      triggers: ['review-without-retro'],
      outputs: [
        'Learnings aus erledigten Tickets',
        'Skills angelegt und aktiviert',
        'Neue Stories vorgeschlagen',
      ],
    },
  },

  // ==========================================================================
  // Required Secrets (optional)
  // ==========================================================================
  // Falls das Plugin externe Services benötigt

  requiredSecrets: [
    // Keine externen Secrets für dieses Plugin benötigt
  ],

  // ==========================================================================
  // Kompatibilität
  // ==========================================================================

  compatibility: {
    minPaperclipVersion: '1.0.0',
  },
};

// CommonJS Export für Node.js
module.exports = manifest;
