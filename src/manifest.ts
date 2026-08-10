/**
 * Plugin manifest (Paperclip plugin API v1).
 *
 * The six Scrum agents are declared as *managed agents*: Paperclip creates and
 * owns them, and reconciles them against this declaration. That replaces the
 * hand-rolled onboarding this plugin used to ship — the host is better at
 * agent lifecycle than we are.
 *
 * Ceremonies are deliberately **not** declared as scheduled jobs. They are
 * triggered by board state (see `src/core/triggers/`), because AI agents work
 * faster than any cron expression could express.
 */

import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

import { MANAGED_AGENT_INSTRUCTIONS } from "./agent-instructions";
import { TEAM } from "./team";

const PLUGIN_ID = "schapat.agent-scrum";
const PLUGIN_VERSION = "2.1.1";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Agent Scrum",
  description:
    "An autonomous Scrum team: state-driven ceremonies, a live Kanban board, and agents that learn from finished work.",
  author: "Schapat",
  categories: ["automation"],

  capabilities: [
    // The board reads and moves issues, and records agent conversation as comments.
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.read",
    "issue.comments.create",
    "issue.relations.read",
    "issue.relations.write",
    // Der Kickoff-Teilbaum ist genau der Liefer-Scope. Ihn in einem Aufruf zu
    // lesen ersetzt ein projektweites Listing samt anschliessendem Filtern.
    "issue.subtree.read",
    // Ein stehendes Ticket ist von einem laufenden nur unterscheidbar, wenn der
    // Host nach Runs, Freigaben und Budget-Sperren gefragt werden kann. Aus
    // Events allein laesst sich das nicht rekonstruieren: was waehrend eines
    // Worker-Neustarts passiert, hoert niemand.
    "issues.orchestration.read",
    // Assignment and the retrospective's skill delivery need agent access.
    "agents.read",
    "agents.invoke",
    "agents.managed",
    // Learned skills become real company skills the host reconciles.
    "skills.managed",
    "projects.read",
    "project.workspaces.read",
    "companies.read",
    "issues.wakeup",
    // Board state (tickets, learnings, ceremony log) lives in plugin state.
    "plugin.state.read",
    "plugin.state.write",
    // The reconcile tick — see the `jobs` declaration for why it exists and
    // what it deliberately does not do.
    "jobs.schedule",
    // Structured verdicts instead of hand-typed HTML markers — see `tools`.
    "agent.tools.register",
    // Ceremonies are triggered by board events, not by a schedule.
    //
    // This also carries the stall detection: `agent.run.failed`,
    // `approval.created`, and `budget.incident.opened` tell the board why a
    // ticket stopped moving. Only the *subscription* is capability-gated —
    // the plugin reads no approval or cost record, so it asks for no
    // additional read permission.
    "events.subscribe",
    // Setting the reporting line goes through the host's REST API: the plugin
    // API has no way to give a managed agent a superior. Optional — without
    // credentials the plugin only reports the drift.
    "http.outbound",
    "ui.page.register",
    "ui.sidebar.register",
    "ui.dashboardWidget.register",
  ],

  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },

  // ---------------------------------------------------------------------------
  // Agent tools
  // ---------------------------------------------------------------------------

  // Der Ablauf haengt daran, dass ein Modell HTML-Marker mit gueltigem JSON von
  // Hand tippt; ein fehlendes Anfuehrungszeichen liess ein Ticket dauerhaft
  // ungeplant liegen. Diese Tools sind schemavalidiert — eine falsche Eingabe
  // wird abgelehnt, bevor sie das Board erreicht. Das *Speicherformat* bleibt
  // der Marker, damit bestehende Tickets und die Projektion unveraendert gelten.
  tools: [
    {
      name: "submit_refinement",
      displayName: "Submit ticket refinement",
      description:
        "Record the estimate, acceptance criteria, technical notes, risks, and labels for a project ticket. Use this instead of writing the refinement marker by hand. Only the Technical Lead may call it.",
      parametersSchema: {
        type: "object",
        required: ["issueId", "storyPoints", "acceptanceCriteria"],
        properties: {
          issueId: { type: "string", description: "UUID of the ticket being refined." },
          storyPoints: {
            type: "number",
            minimum: 1,
            maximum: 100,
            description: "Whole-number effort estimate.",
          },
          acceptanceCriteria: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
            description: "Verifiable criteria QA will check one by one.",
          },
          technicalNotes: { type: "string", description: "Implementation guidance for the developer." },
          labels: {
            type: "array",
            items: { type: "string" },
            description:
              "Technical domains of this ticket. Sprint planning picks the matching developer from these.",
          },
          risks: {
            type: "array",
            items: {
              type: "object",
              required: ["description"],
              properties: {
                description: { type: "string" },
                severity: { type: "string", enum: ["low", "medium", "high"] },
                mitigation: { type: "string" },
              },
            },
          },
        },
      },
    },
    {
      name: "submit_qa_verdict",
      displayName: "Submit QA verdict",
      description:
        "Record the QA result for a ticket in review: every acceptance criterion with its outcome, plus approval or a change request. Only the QA Engineer may call it. An approval with an unmet criterion is rejected.",
      parametersSchema: {
        type: "object",
        required: ["issueId", "approved", "criteria"],
        properties: {
          issueId: { type: "string", description: "UUID of the reviewed ticket." },
          approved: { type: "boolean", description: "True only when every criterion is met." },
          criteria: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["text", "met"],
              properties: {
                text: { type: "string", description: "The acceptance criterion, as refined." },
                met: { type: "boolean" },
              },
            },
          },
          notes: { type: "string", description: "What failed and what the developer should fix." },
        },
      },
    },
    {
      name: "record_commit",
      displayName: "Record delivery commit",
      description:
        "Record the pushed commit that delivers a ticket. Required before QA can complete a GitHub-backed ticket. Only a Developer may call it.",
      parametersSchema: {
        type: "object",
        required: ["issueId", "sha", "url", "message"],
        properties: {
          issueId: { type: "string", description: "UUID of the delivered ticket." },
          sha: { type: "string", description: "Full commit SHA already pushed to the feature branch." },
          url: { type: "string", description: "https://github.com/<owner>/<repo>/commit/<sha>" },
          message: { type: "string", description: "Commit message." },
        },
      },
    },
  ],

  // ---------------------------------------------------------------------------
  // Reconcile tick
  // ---------------------------------------------------------------------------

  // Dies ist *kein* Zeremonien-Scheduler — die Trennung aus dem Kopf dieser
  // Datei gilt weiter. Der Tick startet nichts, er stellt nur fest, was steht:
  // ein Agent-Run, der waehrend eines Worker-Neustarts gescheitert ist, erzeugt
  // kein Event mehr, das jemand hoeren koennte. Ohne ihn faellt ein solcher
  // Stillstand erst auf, wenn ein Mensch das Board oeffnet.
  jobs: [
    {
      jobKey: "reconcile-stalled-work",
      displayName: "Detect stalled delivery",
      description:
        "Reads the host's orchestration view and reports tickets whose agent run failed, whose approval is pending, or which a budget incident stopped.",
      schedule: "*/10 * * * *",
    },
  ],

  // ---------------------------------------------------------------------------
  // Managed agents — the Scrum team
  // ---------------------------------------------------------------------------

  // Derived from the single team definition in `src/team.ts`, so the manifest
  // and the worker's hierarchy check can never drift apart.
  //
  // Note the schema has no `reportsTo`: managed agents are always created
  // without a superior. The intended reporting line lives in `team.ts` and in
  // each agent's instructions; see "Agent hierarchy" in the README.
  agents: TEAM.map((member) => ({
    agentKey: member.agentKey,
    displayName: member.displayName,
    role: member.role,
    title: member.title,
    icon: member.icon,
    capabilities: member.capabilities,
    adapterType: member.adapterType,
    adapterConfig: member.adapterConfig,
    runtimeConfig: member.runtimeConfig,
    status: "idle",
    instructions: {
      entryFile: "AGENTS.md",
      content: MANAGED_AGENT_INSTRUCTIONS[member.agentKey],
      assetPath: `agents/${member.agentKey}`,
    },
  })),

  // ---------------------------------------------------------------------------
  // Operator configuration
  // ---------------------------------------------------------------------------

  instanceConfigSchema: {
    type: "object",
    properties: {
      // The plugin creates six agents in the company. That is a visible,
      // budget-relevant change, so it never happens implicitly: an
      // organisation opts in here, and nothing is created until it does.
      enableTeam: {
        type: "boolean",
        default: false,
        title: "Activate the Scrum team for this organisation",
        description:
          "Creates and maintains the six Scrum agents (Product Owner, Scrum Master, Technical Lead, two Developers, QA). Leave off to install the plugin without adding agents.",
      },
      // Optional: lets the plugin set the reporting line itself. The plugin
      // API cannot give a managed agent a superior, so this goes through the
      // host's REST API. Leave empty and the plugin only reports the drift.
      apiBaseUrl: {
        type: "string",
        default: "http://127.0.0.1:3100",
        title: "Paperclip API base URL",
        description:
          "Used to maintain reporting lines, heartbeat configuration, and managed instructions for existing Scrum agents.",
      },
      apiToken: {
        type: "string",
        default: "",
        format: "password",
        title: "API token for managed agent maintenance",
        description:
          "A token with agent configuration permission on protected instances. Local trusted instances may leave this empty.",
      },
      githubToken: {
        type: "string",
        default: "",
        format: "password",
        title: "GitHub token for private commit details",
        description:
          "Optional token for private GitHub repositories. Used only to load file-level changes for a recorded ticket commit.",
      },
      enableAutoPlanning: {
        type: "boolean",
        default: true,
        title: "Automatic sprint planning",
        description: "Start planning when TODO runs empty and refined tickets are waiting.",
      },
      requireProjectSprint: {
        type: "boolean",
        default: true,
        title: "Require sprint planning before project delivery",
        description:
          "New project requests stay in sprint planning until a human starts the first sprint after Technical Lead refinement. Disable only to allow immediate project delivery after backlog approval.",
      },
      enableAutoRefinement: {
        type: "boolean",
        default: true,
        title: "Automatic backlog refinement",
        description: "Start refinement when the supply of sprint-ready tickets runs low.",
      },
      enableAutoImpediments: {
        type: "boolean",
        default: true,
        title: "Automatic impediment resolution",
        description: "Clear resolved blockers, escalate real ones, and fill idle capacity.",
      },
      enableAutoReview: {
        type: "boolean",
        default: true,
        title: "Automatic review and retrospective",
        description:
          "Run the sprint review once every sprint ticket is done; the retrospective follows.",
      },
      developerCount: {
        type: "number",
        default: 2,
        minimum: 1,
        maximum: 5,
        title: "Number of developers",
      },
      wipLimitDevelopment: {
        type: "number",
        default: 4,
        minimum: 1,
        maximum: 50,
        title: "WIP limit for Development",
      },
      wipLimitReview: {
        type: "number",
        default: 3,
        minimum: 1,
        maximum: 50,
        title: "WIP limit for Review",
      },
    },
  },

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  ui: {
    slots: [
      {
        type: "sidebar",
        id: "scrum-board-sidebar",
        displayName: "Scrum Board",
        exportName: "ScrumBoardSidebarLink",
      },
      {
        type: "page",
        id: "scrum-board",
        displayName: "Scrum Board",
        exportName: "ScrumBoardPage",
        routePath: "scrum-board",
      },
      {
        type: "dashboardWidget",
        id: "sprint-progress",
        displayName: "Sprint Progress",
        exportName: "SprintProgressWidget",
      },
      {
        type: "dashboardWidget",
        id: "team-status",
        displayName: "Team Status",
        exportName: "TeamStatusWidget",
      },
    ],
  },
};

export default manifest;
