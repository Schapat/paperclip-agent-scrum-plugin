/**
 * Scrum Team Onboarding
 *
 * Creates all 6 Scrum agents, sets up labels, and initializes the first sprint
 * when the plugin is installed.
 */

import {
  PaperclipClient,
  PaperclipApiError,
  type AgentHireRequest,
} from '../api/paperclip-client';
import { createLogger, type Logger } from '../utils/logger';

// =============================================================================
// Types
// =============================================================================

export interface AgentDefinition {
  name: string;
  role: ScrumRole;
  title: string;
  icon: AgentIcon;
  capabilities: string;
  /** Role name to report to, resolved to ID after creation */
  reportsToRole: ScrumRole | null;
}

export type ScrumRole =
  | 'product_owner'
  | 'scrum_master'
  | 'technical_lead'
  | 'developer'
  | 'developer_2'
  | 'qa_engineer';

export type AgentIcon =
  | 'clipboard-list' // Product Owner
  | 'users' // Scrum Master
  | 'code' // Technical Lead
  | 'terminal' // Developer
  | 'bug' // QA Engineer
  | 'cog'; // Generic

export interface OnboardingContext {
  client: PaperclipClient;
  companyId: string;
  projectId?: string;
  ceoAgentId?: string;
  agentInstructions: Map<ScrumRole, string>;
  logger: Logger;
  /** Adapter type to use for created agents */
  adapterType?: string;
  /** Adapter config for created agents */
  adapterConfig?: Record<string, unknown>;
}

export interface OnboardingResult {
  success: boolean;
  agents: CreatedAgent[];
  labels: CreatedLabel[];
  sprint: CreatedSprint | null;
  errors: OnboardingError[];
}

export interface CreatedAgent {
  id: string;
  name: string;
  role: ScrumRole;
  reportsTo: string | null;
  pendingApproval?: boolean;
  approvalId?: string;
}

export interface CreatedLabel {
  id: string;
  name: string;
  color: string;
}

export interface CreatedSprint {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface OnboardingError {
  step: 'agent' | 'label' | 'sprint' | 'notification';
  detail: string;
  agentRole?: ScrumRole;
  labelName?: string;
}

// =============================================================================
// Agent Definitions
// =============================================================================

/**
 * Definitions for all 6 Scrum team agents.
 * Order matters: agents must be created in dependency order (reports-to hierarchy)
 */
export const SCRUM_AGENTS: AgentDefinition[] = [
  // Level 1: Reports to CEO (no internal dependencies)
  {
    name: 'Product Owner',
    role: 'product_owner',
    title: 'Product Owner',
    icon: 'clipboard-list',
    capabilities:
      'Product vision, backlog management, user story creation, prioritization, business value assessment, ticket assignment',
    reportsToRole: null, // Reports to CEO
  },
  {
    name: 'Scrum Master',
    role: 'scrum_master',
    title: 'Scrum Master',
    icon: 'users',
    capabilities:
      'Scrum process facilitation, sprint planning, daily standups, retrospectives, blocker removal, flow optimization',
    reportsToRole: null, // Reports to CEO
  },
  {
    name: 'Technical Lead',
    role: 'technical_lead',
    title: 'Technical Lead',
    icon: 'code',
    capabilities:
      'Technical architecture, ticket refinement, story point estimation, subtask creation, implementation strategy, developer support',
    reportsToRole: null, // Reports to CEO
  },
  {
    name: 'QA Engineer',
    role: 'qa_engineer',
    title: 'QA Engineer',
    icon: 'bug',
    capabilities:
      'Quality assurance, code review, acceptance criteria validation, test execution, regression testing, approval decisions',
    reportsToRole: null, // Reports to CEO
  },
  // Level 2: Reports to Technical Lead
  {
    name: 'Developer 1',
    role: 'developer',
    title: 'Developer',
    icon: 'terminal',
    capabilities:
      'Feature implementation, test writing, code documentation, pull request creation, clean code practices',
    reportsToRole: 'technical_lead',
  },
  {
    name: 'Developer 2',
    role: 'developer_2',
    title: 'Developer',
    icon: 'terminal',
    capabilities:
      'Feature implementation, test writing, code documentation, pull request creation, clean code practices',
    reportsToRole: 'technical_lead',
  },
];

// =============================================================================
// Label Definitions
// =============================================================================

export interface LabelDefinition {
  name: string;
  color: string;
  description: string;
}

export const SCRUM_LABELS: LabelDefinition[] = [
  { name: 'epic', color: '#8B5CF6', description: 'Large feature spanning multiple sprints' },
  { name: 'feature', color: '#10B981', description: 'New functionality or capability' },
  { name: 'story', color: '#3B82F6', description: 'User story describing a user need' },
  { name: 'bug', color: '#EF4444', description: 'Defect or issue to be fixed' },
  { name: 'improvement', color: '#F59E0B', description: 'Enhancement to existing functionality' },
  { name: 'scrum-event', color: '#EC4899', description: 'Scrum ceremony (planning, daily, retro)' },
];

// =============================================================================
// Main Onboarding Function
// =============================================================================

/**
 * Run the complete onboarding process.
 * Creates agents, labels, initial sprint, and sends notification.
 */
export async function runOnboarding(context: OnboardingContext): Promise<OnboardingResult> {
  const { logger } = context;
  const result: OnboardingResult = {
    success: true,
    agents: [],
    labels: [],
    sprint: null,
    errors: [],
  };

  logger.info('Starting Scrum Team onboarding...');

  // Step 1: Create all agents
  try {
    const agents = await createScrumTeam(context);
    result.agents = agents;
    logger.info(`Created ${agents.length} Scrum agents`);
  } catch (error) {
    result.success = false;
    result.errors.push({
      step: 'agent',
      detail: error instanceof Error ? error.message : String(error),
    });
    logger.error('Failed to create Scrum team:', error);
  }

  // Step 2: Create labels
  try {
    const labels = await createScrumLabels(context);
    result.labels = labels;
    logger.info(`Created ${labels.length} Scrum labels`);
  } catch (error) {
    // Labels are non-critical, continue
    result.errors.push({
      step: 'label',
      detail: error instanceof Error ? error.message : String(error),
    });
    logger.warn('Failed to create some labels:', error);
  }

  // Step 3: Create initial sprint
  try {
    const sprint = await createInitialSprint(context);
    result.sprint = sprint;
    logger.info(`Created initial sprint: ${sprint.name}`);
  } catch (error) {
    // Sprint is non-critical, continue
    result.errors.push({
      step: 'sprint',
      detail: error instanceof Error ? error.message : String(error),
    });
    logger.warn('Failed to create initial sprint:', error);
  }

  // Step 4: Send success notification
  try {
    await sendOnboardingNotification(context, result);
    logger.info('Sent onboarding success notification');
  } catch (error) {
    result.errors.push({
      step: 'notification',
      detail: error instanceof Error ? error.message : String(error),
    });
    logger.warn('Failed to send notification:', error);
  }

  logger.info(
    `Onboarding ${result.success ? 'completed successfully' : 'completed with errors'}`,
    {
      agents: result.agents.length,
      labels: result.labels.length,
      sprint: result.sprint?.name,
      errors: result.errors.length,
    }
  );

  return result;
}

// =============================================================================
// Agent Creation
// =============================================================================

/**
 * Create all 6 Scrum team agents with proper reporting structure.
 */
export async function createScrumTeam(context: OnboardingContext): Promise<CreatedAgent[]> {
  const { client, ceoAgentId, agentInstructions, adapterType, adapterConfig, logger } = context;

  const createdAgents: CreatedAgent[] = [];
  const roleToAgentId = new Map<ScrumRole, string>();

  for (const agentDef of SCRUM_AGENTS) {
    try {
      // Resolve reportsTo
      let reportsTo: string | null = null;
      if (agentDef.reportsToRole) {
        // Reports to another Scrum agent
        reportsTo = roleToAgentId.get(agentDef.reportsToRole) ?? null;
        if (!reportsTo) {
          logger.warn(
            `Cannot find ${agentDef.reportsToRole} for ${agentDef.name}, using CEO as fallback`
          );
          reportsTo = ceoAgentId ?? null;
        }
      } else {
        // Reports to CEO
        reportsTo = ceoAgentId ?? null;
      }

      // Get instructions for this role
      const instructions = agentInstructions.get(agentDef.role);
      if (!instructions) {
        throw new Error(`Missing instructions for role: ${agentDef.role}`);
      }

      // Build the hire request
      const hireRequest: AgentHireRequest = {
        name: agentDef.name,
        role: mapRoleToApiRole(agentDef.role),
        title: agentDef.title,
        icon: agentDef.icon,
        capabilities: agentDef.capabilities,
        reportsTo,
        instructionsBundle: {
          files: {
            'AGENTS.md': instructions,
          },
        },
        runtimeConfig: {
          heartbeat: {
            enabled: true,
            wakeOnDemand: true,
          },
        },
      };

      // Add adapter config if provided
      if (adapterType) {
        hireRequest.adapterType = adapterType;
      }
      if (adapterConfig) {
        hireRequest.adapterConfig = adapterConfig;
      }

      // Create the agent via hire request
      const response = await client.createAgentHire(hireRequest);

      roleToAgentId.set(agentDef.role, response.agent.id);

      const createdAgent: CreatedAgent = {
        id: response.agent.id,
        name: response.agent.name,
        role: agentDef.role,
        reportsTo,
      };

      // Track approval status if applicable
      if (response.approval) {
        createdAgent.pendingApproval = true;
        createdAgent.approvalId = response.approval.id;
        logger.info(
          `Agent ${agentDef.name} pending approval: ${response.approval.id}`
        );
      }

      createdAgents.push(createdAgent);
      logger.info(`Created agent: ${agentDef.name} (${response.agent.id})`);
    } catch (error) {
      // Handle specific API errors
      if (error instanceof PaperclipApiError) {
        if (error.isConflict()) {
          logger.warn(`Agent ${agentDef.name} already exists, skipping`);
          continue;
        }
      }
      logger.error(`Failed to create agent ${agentDef.name}:`, error);
      throw new Error(`Failed to create agent ${agentDef.name}: ${error}`);
    }
  }

  return createdAgents;
}

/**
 * Map internal role names to Paperclip API role names.
 */
function mapRoleToApiRole(role: ScrumRole): string {
  const mapping: Record<ScrumRole, string> = {
    product_owner: 'product_owner',
    scrum_master: 'scrum_master',
    technical_lead: 'technical_lead',
    developer: 'developer',
    developer_2: 'developer',
    qa_engineer: 'qa_engineer',
  };
  return mapping[role];
}

// =============================================================================
// Label Creation
// =============================================================================

/**
 * Create Scrum labels for the company.
 */
export async function createScrumLabels(context: OnboardingContext): Promise<CreatedLabel[]> {
  const { client, logger } = context;
  const createdLabels: CreatedLabel[] = [];

  // First, check for existing labels to avoid duplicates
  let existingLabels: string[] = [];
  try {
    const labels = await client.listLabels();
    existingLabels = labels.map((l) => l.name.toLowerCase());
  } catch (error) {
    logger.warn('Could not fetch existing labels, will create all:', error);
  }

  for (const labelDef of SCRUM_LABELS) {
    // Skip if label already exists
    if (existingLabels.includes(labelDef.name.toLowerCase())) {
      logger.info(`Label ${labelDef.name} already exists, skipping`);
      continue;
    }

    try {
      const label = await client.createLabel({
        name: labelDef.name,
        color: labelDef.color,
        description: labelDef.description,
      });

      createdLabels.push({
        id: label.id,
        name: label.name,
        color: label.color,
      });

      logger.info(`Created label: ${labelDef.name}`);
    } catch (error) {
      if (error instanceof PaperclipApiError && error.isConflict()) {
        logger.info(`Label ${labelDef.name} already exists, skipping`);
        continue;
      }
      logger.warn(`Failed to create label ${labelDef.name}:`, error);
      // Continue with other labels
    }
  }

  return createdLabels;
}

// =============================================================================
// Sprint Creation
// =============================================================================

/**
 * Create the initial sprint for the team.
 * Sprint starts today and runs for 2 weeks.
 */
export async function createInitialSprint(context: OnboardingContext): Promise<CreatedSprint> {
  const { client, projectId, logger } = context;

  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 14); // 2-week sprint

  const sprintNumber = 1;
  const sprintName = `Sprint ${sprintNumber}`;

  // Create a sprint tracking issue (sprints are tracked via issues in Paperclip)
  try {
    const sprintIssue = await client.createIssue({
      title: `🏃 ${sprintName}`,
      description: formatSprintDescription(sprintName, today, endDate),
      status: 'in_progress',
      priority: 'high',
      projectId,
      labels: ['scrum-event'],
    });

    const sprint: CreatedSprint = {
      id: sprintIssue.id,
      name: sprintName,
      startDate: today.toISOString(),
      endDate: endDate.toISOString(),
    };

    logger.info(
      `Created sprint: ${sprintName} (${today.toDateString()} - ${endDate.toDateString()})`
    );

    return sprint;
  } catch (error) {
    logger.warn('Failed to create sprint issue, using local sprint:', error);

    // Return a local sprint if API fails
    return {
      id: crypto.randomUUID(),
      name: sprintName,
      startDate: today.toISOString(),
      endDate: endDate.toISOString(),
    };
  }
}

/**
 * Format sprint description markdown.
 */
function formatSprintDescription(name: string, startDate: Date, endDate: Date): string {
  return `
## ${name}

**Duration:** ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()} (2 weeks)

### Sprint Goal
_To be defined in Sprint Planning_

### Sprint Metrics
- **Planned Story Points:** 0
- **Completed Story Points:** 0
- **Velocity:** -

### Ceremonies
- [ ] Sprint Planning
- [ ] Daily Standups (daily)
- [ ] Sprint Review
- [ ] Sprint Retrospective

---
_This issue tracks the overall sprint progress._
  `.trim();
}

// =============================================================================
// Notification
// =============================================================================

/**
 * Send onboarding success notification to the board.
 */
async function sendOnboardingNotification(
  context: OnboardingContext,
  result: OnboardingResult
): Promise<void> {
  const { client, projectId, logger } = context;

  const agentList = result.agents
    .map((a) => `- **${a.name}** (${a.role})${a.pendingApproval ? ' ⏳ _pending approval_' : ' ✅'}`)
    .join('\n');

  const labelList = result.labels.map((l) => `- \`${l.name}\``).join('\n');

  const notificationBody = `
## 🎉 Scrum Team Onboarding Complete

### Created Agents (${result.agents.length}/6)
${agentList || '_No agents created_'}

${result.agents.some((a) => a.pendingApproval) ? '> **Note:** Some agents are pending board approval.' : ''}

### Created Labels (${result.labels.length})
${labelList || '_No new labels created_'}

### Initial Sprint
${result.sprint ? `- **${result.sprint.name}**
  - Start: ${new Date(result.sprint.startDate).toLocaleDateString()}
  - End: ${new Date(result.sprint.endDate).toLocaleDateString()}` : '_Not created_'}

${
  result.errors.length > 0
    ? `### ⚠️ Warnings (${result.errors.length})
${result.errors.map((e) => `- \`${e.step}\`: ${e.detail}`).join('\n')}`
    : ''
}

---

### Next Steps
1. Review and approve pending agent hires (if any)
2. Define the Sprint Goal in Sprint Planning
3. Product Owner: Create initial backlog items
4. Technical Lead: Refine backlog items with story points

_The Scrum team is ready to start working!_ 🚀
  `.trim();

  // Create a notification issue
  try {
    await client.createIssue({
      title: '🎉 Scrum Team Onboarding Complete',
      description: notificationBody,
      status: 'done',
      priority: 'low',
      projectId: projectId,
      labels: ['scrum-event'],
    });
  } catch (error) {
    logger.warn('Failed to create notification issue:', error);
    // Not critical, don't throw
  }
}

// =============================================================================
// Instructions Loader
// =============================================================================

/**
 * Load agent instructions from the filesystem.
 * This maps role names to their AGENTS.md content.
 */
export async function loadAgentInstructionsFromFiles(
  basePath: string,
  readFile: (path: string) => Promise<string>
): Promise<Map<ScrumRole, string>> {
  const instructions = new Map<ScrumRole, string>();

  // File name mapping
  const fileMapping: Record<ScrumRole, string> = {
    product_owner: 'product-owner.md',
    scrum_master: 'scrum-master.md',
    technical_lead: 'technical-lead.md',
    developer: 'developer.md',
    developer_2: 'developer-2.md',
    qa_engineer: 'qa-engineer.md',
  };

  for (const [role, fileName] of Object.entries(fileMapping)) {
    const filePath = `${basePath}/${fileName}`;
    try {
      const content = await readFile(filePath);
      instructions.set(role as ScrumRole, content);
    } catch (error) {
      throw new Error(`Failed to load instructions for ${role} from ${filePath}: ${error}`);
    }
  }

  return instructions;
}

/**
 * Create agent instructions map from inline content.
 * Useful for testing or when files are bundled.
 */
export function createAgentInstructions(
  content: Partial<Record<ScrumRole, string>>
): Map<ScrumRole, string> {
  const instructions = new Map<ScrumRole, string>();
  for (const [role, text] of Object.entries(content)) {
    if (text) {
      instructions.set(role as ScrumRole, text);
    }
  }
  return instructions;
}

/**
 * Create a default logger for onboarding.
 */
export function createOnboardingLogger(): Logger {
  return createLogger({ prefix: '[Onboarding]', level: 'info' });
}
