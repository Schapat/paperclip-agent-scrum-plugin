/**
 * The Scrum team and its reporting line.
 *
 * Kept in one place because three things need to agree on it: the manifest
 * (which declares the managed agents), the worker (which reconciles them and
 * checks the resulting hierarchy), and the agent instructions (which tell each
 * agent who it escalates to).
 *
 * ## Why the plugin cannot set the hierarchy itself
 *
 * `pluginManagedAgentDeclarationSchema` has no `reportsTo` field, and the
 * host's `declarationPatch` does not map one — a managed agent is always
 * created without a superior. `ctx.agents` offers no update method either
 * (only list/get/pause/resume/invoke and managed get/reconcile/reset).
 *
 * So the structural hierarchy has to be set once by an operator. What the
 * plugin *can* do is state the intended line, write it into each agent's
 * instructions so escalation behaviour is correct regardless, and report drift
 * when the actual reporting line differs.
 */

/** Stable keys of the six agents this plugin manages. */
export type TeamAgentKey =
  | "product-owner"
  | "scrum-master"
  | "technical-lead"
  | "developer-1"
  | "developer-2"
  | "qa-engineer";

export interface TeamMember {
  agentKey: TeamAgentKey;
  displayName: string;
  /** Role the ceremonies and assignment logic match on. */
  role: string;
  title: string;
  icon: string;
  capabilities: string;
  /**
   * Who this agent reports to.
   *
   * `null` means the company lead (CEO) — the plugin does not own that agent,
   * so it can only name the intent, not wire it up.
   */
  reportsTo: TeamAgentKey | null;
}

/**
 * The team, in reporting order.
 *
 * Developers report to the Technical Lead; everyone else reports to the
 * company lead. That mirrors how the ceremonies actually escalate: the Tech
 * Lead receives blocked tickets and refinement work, and hands implementation
 * down to the developers.
 */
export const TEAM: TeamMember[] = [
  {
    agentKey: "product-owner",
    displayName: "Product Owner",
    role: "product_owner",
    title: "Product Owner",
    icon: "clipboard-list",
    capabilities:
      "Product vision, backlog management, user story creation, prioritisation, business value assessment, ticket assignment",
    reportsTo: null,
  },
  {
    agentKey: "scrum-master",
    displayName: "Scrum Master",
    role: "scrum_master",
    title: "Scrum Master",
    icon: "users",
    capabilities:
      "Scrum facilitation, impediment removal, flow optimisation, retrospectives, process improvement",
    reportsTo: null,
  },
  {
    agentKey: "technical-lead",
    displayName: "Technical Lead",
    role: "technical_lead",
    title: "Technical Lead",
    icon: "code",
    capabilities:
      "Software architecture, ticket refinement, story point estimation, subtask creation, implementation strategy",
    reportsTo: null,
  },
  {
    agentKey: "qa-engineer",
    displayName: "QA Engineer",
    role: "qa_engineer",
    title: "QA Engineer",
    icon: "bug",
    capabilities:
      "Quality assurance, acceptance criteria verification, test execution, code review, regression testing",
    reportsTo: null,
  },
  {
    agentKey: "developer-1",
    displayName: "Developer 1",
    role: "developer",
    title: "Developer",
    icon: "terminal",
    capabilities: "Feature development, bug fixing, unit tests, documentation, git",
    reportsTo: "technical-lead",
  },
  {
    agentKey: "developer-2",
    displayName: "Developer 2",
    role: "developer",
    title: "Developer",
    icon: "terminal",
    capabilities: "Feature development, bug fixing, unit tests, documentation, git",
    reportsTo: "technical-lead",
  },
];

/** Looks a member up by key. */
export function teamMember(agentKey: string): TeamMember | undefined {
  return TEAM.find((m) => m.agentKey === agentKey);
}

/**
 * Renders the reporting line as a human-readable tree.
 *
 * Used in logs and in the README so the intended structure is visible even
 * though the plugin cannot enforce it.
 */
export function describeReportingLine(): string {
  const lines: string[] = ["Company lead (CEO)"];

  for (const member of TEAM.filter((m) => m.reportsTo === null)) {
    lines.push(`  └─ ${member.displayName}`);
    for (const report of TEAM.filter((m) => m.reportsTo === member.agentKey)) {
      lines.push(`       └─ ${report.displayName}`);
    }
  }

  return lines.join("\n");
}

/**
 * A managed agent whose actual superior differs from the intended one.
 */
export interface ReportingDrift {
  agentKey: string;
  displayName: string;
  /** Display name of the agent it should report to, or "company lead". */
  expected: string;
  /** Agent id it currently reports to, or null. */
  actualAgentId: string | null;
}

/**
 * Compares the intended reporting line against what the host actually stored.
 *
 * Only reports drift the operator can act on: an agent whose superior is set
 * to something other than the intended one, or missing entirely.
 */
export function detectReportingDrift(
  resolved: Map<string, { agentId: string; reportsTo: string | null }>,
): ReportingDrift[] {
  const drift: ReportingDrift[] = [];

  for (const member of TEAM) {
    const actual = resolved.get(member.agentKey);
    if (!actual) continue;

    if (member.reportsTo === null) {
      // Reporting to the company lead is the host's default for a new agent;
      // only a superior *inside* the team would be wrong here.
      const inTeam = [...resolved.values()].some((r) => r.agentId === actual.reportsTo);
      if (inTeam) {
        drift.push({
          agentKey: member.agentKey,
          displayName: member.displayName,
          expected: "the company lead",
          actualAgentId: actual.reportsTo,
        });
      }
      continue;
    }

    const superior = resolved.get(member.reportsTo);
    if (superior && actual.reportsTo !== superior.agentId) {
      drift.push({
        agentKey: member.agentKey,
        displayName: member.displayName,
        expected: teamMember(member.reportsTo)?.displayName ?? member.reportsTo,
        actualAgentId: actual.reportsTo,
      });
    }
  }

  return drift;
}
