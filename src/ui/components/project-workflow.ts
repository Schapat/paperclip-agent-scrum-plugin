import type { ProjectOnboarding, ProjectRefinementWait, TicketStall } from '../../core/types';

export interface ProjectWorkflowProgress {
  unrefinedTasks: number;
  /** Wie viele Stories bereits existieren — auch vor ihrer Freigabe. */
  totalTasks?: number;
}

/** Wie lange eine Phase laufen darf, bevor sie erklaerungsbeduerftig wird. */
const PHASE_ATTENTION_AFTER_MS = 30 * 60 * 1000;

export interface ProjectWorkflowContext {
  /** Tickets, die nachweislich stehen. */
  stalls?: TicketStall[];
  /** Wann die aktuelle Phase begonnen hat. */
  phaseSince?: string | null;
  /**
   * Laeuft gerade ein Agent-Run?
   *
   * `undefined` heisst "unbekannt" — etwa wenn der Host keinen
   * Orchestrierungs-Snapshot liefert. Dann bleibt die Phasenaussage stehen;
   * geraten wird nicht in beide Richtungen.
   */
  agentRunning?: boolean;
  /** Tickets, deren Refinement hinter einem Blocker wartet. */
  refinementWaits?: ProjectRefinementWait[];
  now?: number;
}

/** Ein Ticket wartet auf ein anderes — Reihenfolge, kein Stillstand. */
function describeWaits(waits: ProjectRefinementWait[]): string {
  const blockers = [...new Set(waits.flatMap((wait) => wait.blockedBy))];
  const carried = waits.some((wait) => wait.carriedBy);
  const subject = waits.length === 1 ? '1 story' : `${waits.length} stories`;
  const reason = blockers.length > 0
    ? `${subject} cannot be refined on their own yet: they are blocked by ${blockers.join(', ')}.`
    : `${subject} are waiting behind a blocking ticket.`;

  return carried
    ? `${reason} The Technical Lead refines them alongside the ticket it is working on.`
    : `${reason} Refinement starts as soon as the blocker is done.`;
}

/** Menschenlesbare Dauer, bewusst grob — die Zahl soll einordnen, nicht messen. */
export function describeDuration(sinceIso: string, now = Date.now()): string | null {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return null;

  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return 'less than a minute';
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
      if (stall.retriedAt) return `${stall.reason}${suffix}`;
      return `An agent run did not finish${suffix}. Retry the ticket.`;
    case 'run_stalled':
      return `An agent run exceeded its execution budget${suffix}. Stop any server or watcher, then retry the ticket.`;
    case 'wakeup_failed':
      return `The responsible agent could not be woken${suffix}.`;
    case 'awaiting_approval':
      return `Waiting for a human approval outside the board${suffix}.`;
    case 'budget':
      return `A budget incident stopped this agent${suffix}.`;
    case 'awaiting_decision':
      // Die Frage steht jetzt oben auf dieser Seite, im Klartext und mit
      // Antwortfeld. Der Satz schickt niemanden mehr ins Ticket suchen.
      return `${stall.reason}${suffix} Answer it at the top of this page — the board cannot decide this for you.`;
    case 'refinement_invalid':
      return `Refinement did not produce a usable estimate${suffix}.`;
    case 'escalated':
      // Der Grund traegt hier schon die Zahl der Versuche — er sagt mehr als
      // jeder Satz, den dieses Modul daraus bauen koennte.
      return `${stall.reason}${suffix} The board stopped waking agents for it; decide how it proceeds.`;
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
  /**
   * Wer gerade am Zug ist.
   *
   * Der Unterschied zwischen "ein Agent arbeitet" und "wir warten auf dich" ist
   * die eigentliche Frage, die der Header beantworten muss — er stand bisher
   * nur im Fliesstext.
   */
  waitingOn: 'agent' | 'human' | 'none';
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
  base: ProjectWorkflowActivity,
  { stalls = [], phaseSince, agentRunning, refinementWaits = [], now = Date.now() }: ProjectWorkflowContext
): ProjectWorkflowActivity {
  // Ein Phasentext, der Arbeit behauptet, braucht einen laufenden Agenten.
  // Fehlt er, sagt der Header, dass die Phase offen ist — nicht, dass jemand
  // arbeitet. Das war der Unterschied zwischen "Technical Lead is refining
  // backlog stories" und einem seit einer halben Stunde untaetigen Technical
  // Lead. `undefined` bleibt unangetastet: unbekannt ist nicht dasselbe wie
  // "kein Lauf".
  const idlePhase = agentRunning === false && base.waitingOn === 'agent';
  const queued = idlePhase && refinementWaits.length > 0;
  const activity: ProjectWorkflowActivity = idlePhase
    ? {
        ...base,
        title: queued ? `${base.title} — queued` : `${base.title} — no agent run`,
        nextStep: queued
          ? base.nextStep
          : `${base.nextStep} No agent run is active right now — check the agent log if this does not move.`,
        waitingOn: 'none',
      }
    : base;

  const waited = phaseSince ? describeDuration(phaseSince, now) : null;
  // "Running for 23 min" war die Dauer der *Phase*, nicht die eines Laufs.
  const elapsed = waited
    ? idlePhase
      ? `${activity.detail} Waiting for ${waited}.`
      : `${activity.detail} Running for ${waited}.`
    : activity.detail;
  const running = refinementWaits.length > 0 ? `${elapsed} ${describeWaits(refinementWaits)}` : elapsed;

  if (stalls.length === 0) {
    const overdue =
      phaseSince !== undefined &&
      phaseSince !== null &&
      now - Date.parse(phaseSince) > PHASE_ATTENTION_AFTER_MS &&
      !activity.attentionRequired &&
      activity.phase !== 'completed' &&
      activity.phase !== 'project_request' &&
      // Auf einen Blocker zu warten ist erklaert. Die Zeit dafuer ist keine
      // Auffaelligkeit, sondern die Lieferreihenfolge des Product Owners.
      refinementWaits.length === 0;

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
    title: `${base.title} — blocked`,
    detail: `${running} ${describeStall(first, now)}${more}`,
    nextStep: 'Resolve the blocked ticket, then the board continues on its own.',
    attentionRequired: true,
    waitingOn: 'human',
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
        waitingOn: 'agent',
      };
    case 'analysis_ready':
      return {
        phase: 'technical_analysis_approval',
        actor: 'You',
        title: 'Technical analysis needs your approval',
        // Der Product Owner schreibt manchmal schon los, bevor die Freigabe da
        // ist. Das Board hat diese Stories frueher verschwiegen — sichtbar sind
        // sie jetzt, und der Satz sagt, woran sie haengen.
        detail: progress.totalTasks
          ? `The Technical Lead has completed the analysis and is waiting for a product decision. The Product Owner has already written ${progress.totalTasks} ${progress.totalTasks === 1 ? 'story' : 'stories'} — they stay out of delivery until you approve.`
          : 'The Technical Lead has completed the analysis and is waiting for a product decision.',
        nextStep: 'Approve the analysis or request concrete changes.',
        attentionRequired: true,
        ticketLinkLabel: 'Open approval',
        waitingOn: 'human',
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
        waitingOn: 'agent',
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
        waitingOn: 'agent',
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
        waitingOn: 'human',
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
        waitingOn: 'agent',
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
        waitingOn: 'none',
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
        waitingOn: 'human',
      };
  }
}