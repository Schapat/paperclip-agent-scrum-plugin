import type { ProjectOnboarding, TicketStall } from '../../core/types';

export interface ProjectWorkflowProgress {
  unrefinedTasks: number;
}

/** Wie lange eine Phase laufen darf, bevor sie erklaerungsbeduerftig wird. */
const PHASE_ATTENTION_AFTER_MS = 30 * 60 * 1000;

export interface ProjectWorkflowContext {
  /** Tickets, die nachweislich stehen. */
  stalls?: TicketStall[];
  /** Wann die aktuelle Phase begonnen hat. */
  phaseSince?: string | null;
  now?: number;
}

/** Menschenlesbare Dauer, bewusst grob — die Zahl soll einordnen, nicht messen. */
export function describeDuration(sinceIso: string, now = Date.now()): string | null {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return null;

  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/**
 * Uebersetzt einen Stillstand in einen Satz, der sagt, was zu tun ist.
 *
 * Ein Ticket steht nicht, weil es lange dauert. Es steht, weil etwas
 * Benennbares passiert ist — und genau das gehoert in den Header.
 */
export function describeStall(stall: TicketStall, now = Date.now()): string {
  const waited = describeDuration(stall.detectedAt, now);
  const suffix = waited ? ` (since ${waited})` : '';

  switch (stall.kind) {
    case 'run_failed':
      return `An agent run did not finish${suffix}. Retry the ticket.`;
    case 'wakeup_failed':
      return `The responsible agent could not be woken${suffix}.`;
    case 'awaiting_approval':
      return `Waiting for a human approval outside the board${suffix}.`;
    case 'budget':
      return `A budget incident stopped this agent${suffix}.`;
    case 'refinement_invalid':
      return `Refinement did not produce a usable estimate${suffix}.`;
  }
}

export interface ProjectWorkflowActivity {
  phase:
    | 'project_request'
    | 'technical_analysis'
    | 'technical_analysis_approval'
    | 'product_backlog'
    | 'technical_refinement'
    | 'sprint_approval'
    | 'delivery'
    | 'completed';
  actor: string;
  title: string;
  detail: string;
  nextStep: string;
  attentionRequired: boolean;
  ticketLinkLabel: string;
}

export function describeProjectWorkflow(
  onboarding: Pick<ProjectOnboarding, 'status'>,
  progress: ProjectWorkflowProgress,
  context: ProjectWorkflowContext = {}
): ProjectWorkflowActivity {
  const base = describeBaseWorkflow(onboarding, progress);
  return withEvidence(base, context);
}

/**
 * Ergaenzt die Phasenbeschreibung um das, was tatsaechlich beobachtet wurde.
 *
 * Der Status allein kennt keine Zeit: "Technical analysis is in progress" stand
 * nach zwei Minuten genauso da wie nach drei Tagen, und die Delivery-Phase
 * behauptete ungeprueft, es sei keine Freigabe noetig.
 */
function withEvidence(
  activity: ProjectWorkflowActivity,
  { stalls = [], phaseSince, now = Date.now() }: ProjectWorkflowContext
): ProjectWorkflowActivity {
  const waited = phaseSince ? describeDuration(phaseSince, now) : null;
  const running = waited ? `${activity.detail} Running for ${waited}.` : activity.detail;

  if (stalls.length === 0) {
    const overdue =
      phaseSince !== undefined &&
      phaseSince !== null &&
      now - Date.parse(phaseSince) > PHASE_ATTENTION_AFTER_MS &&
      !activity.attentionRequired &&
      activity.phase !== 'completed' &&
      activity.phase !== 'project_request';

    return {
      ...activity,
      detail: running,
      attentionRequired: activity.attentionRequired || overdue,
      nextStep: overdue
        ? `${activity.nextStep} This phase is taking unusually long — check the agent log.`
        : activity.nextStep,
    };
  }

  const first = stalls[0];
  const more = stalls.length > 1 ? ` ${stalls.length - 1} further ticket(s) are affected.` : '';

  return {
    ...activity,
    title: `${activity.title} — blocked`,
    detail: `${running} ${describeStall(first, now)}${more}`,
    nextStep: 'Resolve the blocked ticket, then the board continues on its own.',
    attentionRequired: true,
  };
}

function describeBaseWorkflow(
  onboarding: Pick<ProjectOnboarding, 'status'>,
  progress: ProjectWorkflowProgress
): ProjectWorkflowActivity {
  switch (onboarding.status) {
    case 'analysis_in_progress':
      return {
        phase: 'technical_analysis',
        actor: 'Technical Lead',
        title: 'Technical analysis is in progress',
        detail: 'The Technical Lead is inspecting the project and documenting the delivery approach in Paperclip.',
        nextStep: 'Wait for the completed analysis.',
        attentionRequired: false,
        ticketLinkLabel: 'Open technical analysis',
      };
    case 'analysis_ready':
      return {
        phase: 'technical_analysis_approval',
        actor: 'You',
        title: 'Technical analysis needs your approval',
        detail: 'The Technical Lead has completed the analysis and is waiting for a product decision.',
        nextStep: 'Approve the analysis or request concrete changes.',
        attentionRequired: true,
        ticketLinkLabel: 'Open approval',
      };
    case 'backlog_in_progress':
      return {
        phase: 'product_backlog',
        actor: 'Product Owner',
        title: 'Product Owner is writing the first stories',
        detail: 'The Product Owner is turning the approved analysis into an ordered Paperclip backlog.',
        nextStep: 'Review and approve the backlog when it is ready.',
        attentionRequired: false,
        ticketLinkLabel: 'Open Product Owner backlog',
      };
    case 'sprint_planning':
      if (progress.unrefinedTasks > 0) {
        return {
          phase: 'technical_refinement',
          actor: 'Technical Lead',
          title: 'Technical Lead is refining backlog stories',
          detail: `${progress.unrefinedTasks} backlog ${progress.unrefinedTasks === 1 ? 'story needs' : 'stories need'} estimates and acceptance criteria before the sprint can start.`,
          nextStep: 'Wait for refinement to finish.',
          attentionRequired: false,
          ticketLinkLabel: 'Open technical refinement',
        };
      }
      return {
        phase: 'sprint_approval',
        actor: 'You',
        title: 'Sprint is ready for your approval',
        detail: 'The Product Owner backlog and Technical Lead refinement are complete.',
        nextStep: 'Start the first sprint.',
        attentionRequired: true,
        ticketLinkLabel: 'Open sprint planning',
      };
    case 'active':
      return {
        phase: 'delivery',
        actor: 'Delivery team',
        title: 'Delivery is running on this board',
        detail: 'Development, review, and QA progress are tracked in the Kanban below.',
        // Bewusst keine Zusage mehr, dass nichts wartet: das weiss nur die
        // Stillstandsliste, und die ergaenzt `withEvidence`.
        nextStep: 'Watch the board; blocked work is reported here.',
        attentionRequired: false,
        ticketLinkLabel: 'Open project kickoff',
      };
    case 'completed':
      return {
        phase: 'completed',
        actor: 'Delivery team',
        title: 'Project workflow is complete',
        detail: 'Sprint review and retrospective have been recorded.',
        nextStep: 'Plan the next feature when you are ready.',
        attentionRequired: false,
        ticketLinkLabel: 'Open project summary',
      };
    default:
      return {
        phase: 'project_request',
        actor: 'You',
        title: 'No external project work is running',
        detail: 'Start a project request to begin the Technical Lead analysis.',
        nextStep: 'Choose a project and describe the requested outcome.',
        attentionRequired: false,
        ticketLinkLabel: 'Open project request',
      };
  }
}