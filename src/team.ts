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
  /** Adapter selected when Paperclip creates this managed agent. */
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  /** Host runtime configuration reconciled with the managed agent. */
  runtimeConfig: Record<string, unknown>;
  /**
   * Who this agent reports to.
   *
   * `null` means the company lead (CEO) — the plugin does not own that agent,
   * so it can only name the intent, not wire it up.
   */
  reportsTo: TeamAgentKey | null;
}

/** Kiro CLI adapter installed on the local Paperclip host. */
export const KIRO_CLI_ADAPTER_TYPE = "kiro_local";
/** Model identifier accepted by Kiro CLI for Claude Opus 4.5. */
export const KIRO_CLI_OPUS_45_MODEL = "claude-opus-4.5";
/** Every managed run is forcibly bounded before it can hold a ticket indefinitely. */
export const SCRUM_AGENT_RUN_TIMEOUT_SEC = 10 * 60;
/** Give a graceful adapter shutdown a brief window before the host escalates it. */
export const SCRUM_AGENT_RUN_GRACE_SEC = 15;
export const KIRO_CLI_OPUS_45_ADAPTER_CONFIG: Record<string, unknown> = {
  model: KIRO_CLI_OPUS_45_MODEL,
  timeoutSec: SCRUM_AGENT_RUN_TIMEOUT_SEC,
  graceSec: SCRUM_AGENT_RUN_GRACE_SEC,
};

/**
 * Builds the safe, partial adapter-config migration for existing managed agents.
 *
 * Paperclip merges this PATCH server-side, so secrets, model choices, and
 * adapter-specific settings that a user already configured stay untouched.
 */
export function scrumRunTimeoutAdapterConfigPatch(
  adapterConfig: Record<string, unknown> | null | undefined
): Record<string, number> | null {
  const current = adapterConfig ?? {};
  const timeoutMatches = current.timeoutSec === SCRUM_AGENT_RUN_TIMEOUT_SEC;
  const graceMatches = current.graceSec === SCRUM_AGENT_RUN_GRACE_SEC;
  if (timeoutMatches && graceMatches) return null;

  return {
    timeoutSec: SCRUM_AGENT_RUN_TIMEOUT_SEC,
    graceSec: SCRUM_AGENT_RUN_GRACE_SEC,
  };
}

/**
 * The Scrum Master is the sole timer-driven watchdog. Event handling in the
 * plugin worker remains the primary coordinator; this timer only catches work
 * that was stranded by a missed event or failed wake-up.
 */
export const SCRUM_MASTER_WATCHDOG_RUNTIME_CONFIG: Record<string, unknown> = {
  heartbeat: {
    enabled: true,
    intervalSec: 1800,
    wakeOnDemand: true,
    maxConcurrentRuns: 1,
    // The watchdog must inspect the board even without an assigned ticket.
    skipTimerWhenNoActionableWork: false,
  },
};

/** All delivery roles are invoked only by assignment or by the event-driven worker. */
export const SCRUM_ON_DEMAND_RUNTIME_CONFIG: Record<string, unknown> = {
  heartbeat: {
    enabled: false,
    intervalSec: 1800,
    wakeOnDemand: true,
    maxConcurrentRuns: 1,
    skipTimerWhenNoActionableWork: true,
  },
};

/** Returns the runtime policy for one managed Scrum role. */
export function scrumRuntimeConfig(agentKey: TeamAgentKey): Record<string, unknown> {
  return agentKey === "scrum-master"
    ? SCRUM_MASTER_WATCHDOG_RUNTIME_CONFIG
    : SCRUM_ON_DEMAND_RUNTIME_CONFIG;
}

/** Preserves unrelated runtime settings while enforcing the Scrum runtime policy. */
export function withScrumHeartbeatRuntimeConfig(
  agentKey: TeamAgentKey,
  runtimeConfig: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const current = runtimeConfig ?? {};
  const currentHeartbeat = isRecord(current.heartbeat) ? current.heartbeat : {};
  const heartbeat = scrumRuntimeConfig(agentKey).heartbeat as Record<string, unknown>;

  return {
    ...current,
    heartbeat: {
      ...currentHeartbeat,
      ...heartbeat,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    adapterType: KIRO_CLI_ADAPTER_TYPE,
    adapterConfig: KIRO_CLI_OPUS_45_ADAPTER_CONFIG,
    runtimeConfig: scrumRuntimeConfig("product-owner"),
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
    adapterType: KIRO_CLI_ADAPTER_TYPE,
    adapterConfig: KIRO_CLI_OPUS_45_ADAPTER_CONFIG,
    runtimeConfig: scrumRuntimeConfig("scrum-master"),
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
    adapterType: KIRO_CLI_ADAPTER_TYPE,
    adapterConfig: KIRO_CLI_OPUS_45_ADAPTER_CONFIG,
    runtimeConfig: scrumRuntimeConfig("technical-lead"),
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
    adapterType: KIRO_CLI_ADAPTER_TYPE,
    adapterConfig: KIRO_CLI_OPUS_45_ADAPTER_CONFIG,
    runtimeConfig: scrumRuntimeConfig("qa-engineer"),
    reportsTo: null,
  },
  {
    agentKey: "developer-1",
    displayName: "Developer 1",
    role: "developer",
    title: "Developer",
    icon: "terminal",
    capabilities: "Feature development, bug fixing, unit tests, documentation, git",
    adapterType: KIRO_CLI_ADAPTER_TYPE,
    adapterConfig: KIRO_CLI_OPUS_45_ADAPTER_CONFIG,
    runtimeConfig: scrumRuntimeConfig("developer-1"),
    reportsTo: "technical-lead",
  },
  {
    agentKey: "developer-2",
    displayName: "Developer 2",
    role: "developer",
    title: "Developer",
    icon: "terminal",
    capabilities: "Feature development, bug fixing, unit tests, documentation, git",
    adapterType: KIRO_CLI_ADAPTER_TYPE,
    adapterConfig: KIRO_CLI_OPUS_45_ADAPTER_CONFIG,
    runtimeConfig: scrumRuntimeConfig("developer-2"),
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
 * Resolves the agent a team member should report to.
 *
 * `reportsTo: null` means the company lead. That is an *agent* in the company
 * (role `ceo`), not the absence of a superior — leaving the field empty puts
 * the Scrum roles beside the CEO in the org chart instead of underneath.
 *
 * Returns `null` only when the company genuinely has no lead, in which case
 * these roles really are top level.
 */
export function expectedSuperiorId(
  member: TeamMember,
  resolved: Map<string, { agentId: string; reportsTo: string | null }>,
  companyLeadId: string | null,
): string | null {
  if (member.reportsTo === null) return companyLeadId;
  return resolved.get(member.reportsTo)?.agentId ?? null;
}

/**
 * Compares the intended reporting line against what the host actually stored.
 *
 * Only reports drift the operator can act on: an agent whose superior differs
 * from the intended one.
 */
export function detectReportingDrift(
  resolved: Map<string, { agentId: string; reportsTo: string | null }>,
  companyLeadId: string | null = null,
): ReportingDrift[] {
  const drift: ReportingDrift[] = [];

  for (const member of TEAM) {
    const actual = resolved.get(member.agentKey);
    if (!actual) continue;

    const expected = expectedSuperiorId(member, resolved, companyLeadId);

    // Nothing to compare against — the superior itself was not resolved, or
    // the company has no lead and this role is genuinely top level.
    if (expected === null && member.reportsTo !== null) continue;
    if (expected === actual.reportsTo) continue;

    drift.push({
      agentKey: member.agentKey,
      displayName: member.displayName,
      expected:
        member.reportsTo === null
          ? "the company lead"
          : teamMember(member.reportsTo)?.displayName ?? member.reportsTo,
      actualAgentId: actual.reportsTo,
    });
  }

  return drift;
}
