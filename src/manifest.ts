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

const PLUGIN_ID = "schapat.agent-scrum";
const PLUGIN_VERSION = "2.0.0";

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
    // Assignment and the retrospective's skill delivery need agent access.
    "agents.read",
    "agents.managed",
    // Learned skills become real company skills the host reconciles.
    "skills.managed",
    "projects.read",
    "companies.read",
    // Board state (tickets, learnings, ceremony log) lives in plugin state.
    "plugin.state.read",
    "plugin.state.write",
    // Ceremonies are triggered by board events, not by a schedule.
    "events.subscribe",
    "ui.page.register",
    "ui.dashboardWidget.register",
  ],

  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },

  // ---------------------------------------------------------------------------
  // Managed agents — the Scrum team
  // ---------------------------------------------------------------------------

  agents: [
    {
      agentKey: "product-owner",
      displayName: "Product Owner",
      role: "product_owner",
      title: "Product Owner",
      icon: "clipboard-list",
      capabilities:
        "Product vision, backlog management, user story creation, prioritisation, business value assessment, ticket assignment",
      instructions: { entryFile: "AGENTS.md", assetPath: "agents/product-owner" },
    },
    {
      agentKey: "scrum-master",
      displayName: "Scrum Master",
      role: "scrum_master",
      title: "Scrum Master",
      icon: "users",
      capabilities:
        "Scrum facilitation, impediment removal, flow optimisation, retrospectives, process improvement",
      instructions: { entryFile: "AGENTS.md", assetPath: "agents/scrum-master" },
    },
    {
      agentKey: "technical-lead",
      displayName: "Technical Lead",
      role: "technical_lead",
      title: "Technical Lead",
      icon: "code",
      capabilities:
        "Software architecture, ticket refinement, story point estimation, subtask creation, implementation strategy",
      instructions: { entryFile: "AGENTS.md", assetPath: "agents/technical-lead" },
    },
    {
      agentKey: "developer-1",
      displayName: "Developer 1",
      role: "developer",
      title: "Developer",
      icon: "terminal",
      capabilities: "Feature development, bug fixing, unit tests, documentation, git",
      instructions: { entryFile: "AGENTS.md", assetPath: "agents/developer-1" },
    },
    {
      agentKey: "developer-2",
      displayName: "Developer 2",
      role: "developer",
      title: "Developer",
      icon: "terminal",
      capabilities: "Feature development, bug fixing, unit tests, documentation, git",
      instructions: { entryFile: "AGENTS.md", assetPath: "agents/developer-2" },
    },
    {
      agentKey: "qa-engineer",
      displayName: "QA Engineer",
      role: "qa_engineer",
      title: "QA Engineer",
      icon: "bug",
      capabilities:
        "Quality assurance, acceptance criteria verification, test execution, code review, regression testing",
      instructions: { entryFile: "AGENTS.md", assetPath: "agents/qa-engineer" },
    },
  ],

  // ---------------------------------------------------------------------------
  // Operator configuration
  // ---------------------------------------------------------------------------

  instanceConfigSchema: {
    type: "object",
    properties: {
      enableAutoPlanning: {
        type: "boolean",
        default: true,
        title: "Automatic sprint planning",
        description: "Start planning when TODO runs empty and refined tickets are waiting.",
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
