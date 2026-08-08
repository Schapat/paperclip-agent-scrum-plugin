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

import { TEAM } from "./team";

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
    // Setting the reporting line goes through the host's REST API: the plugin
    // API has no way to give a managed agent a superior. Optional — without
    // credentials the plugin only reports the drift.
    "http.outbound",
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
    instructions: { entryFile: "AGENTS.md", assetPath: `agents/${member.agentKey}` },
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
          "Used only to set the agent reporting line, which the plugin API cannot do. Leave the token empty to skip this.",
      },
      apiToken: {
        type: "string",
        default: "",
        format: "password",
        title: "API token for hierarchy setup",
        description:
          "A token with 'agent_config:update' permission. Only used to set each agent's superior after the team is created. Leave empty to wire the org chart up by hand.",
      },
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
