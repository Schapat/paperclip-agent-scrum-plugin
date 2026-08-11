/**
 * Projekt-Onboarding fur bestehende Paperclip-Projekte.
 *
 * Dieses Modul bleibt frei von SDK-Aufrufen: Worker und UI konnen denselben
 * kleinen Vertrag fur Eingabe, Statuswechsel und Agentenauftrage nutzen.
 */

import type { ProjectOnboarding, ProjectOnboardingStatus, ScrumSprint } from './types';

export interface ProjectOnboardingInput {
  projectId: string;
  brief: string;
  constraints: string | null;
  skipSprintPlanning: boolean;
  /**
   * Der Lieferbranch, wenn der Human ihn schon hier festlegt.
   *
   * Die Frage gehoert eigentlich an den Sprintstart — aber eine kleine
   * Umsetzung ueberspringt das Sprint-Planning ganz, und dann wuerde sie nie
   * gestellt. `null` heisst wie ueberall: das Team entscheidet selbst.
   */
  deliveryBranch: string | null;
}

export type ProjectOnboardingInputResult =
  | { valid: true; value: ProjectOnboardingInput }
  | { valid: false; error: string };

export interface StartProjectOnboardingParams {
  input: ProjectOnboardingInput;
  projectName: string;
  rootIssueId: string;
  requiresSprint?: boolean;
  now?: string;
}

export interface CreateProjectSprintParams {
  onboarding: ProjectOnboarding;
  id: string;
  sprintNumber: number;
  lengthWeeks: number;
  now?: string;
}

export interface NewProjectOnboardingContext {
  taskCount: number;
  hasCurrentSprint: boolean;
}

/** Marker, den der Technical Lead an seine fertiggestellte Analyse anhängt. */
export const TECHNICAL_ANALYSIS_COMPLETION_MARKER = '<!-- agent-scrum:technical-analysis-complete -->';

/** Marker, mit dem ein Human eine erneute Technical-Lead-Analyse anfordert. */
export const TECHNICAL_ANALYSIS_CHANGES_REQUESTED_MARKER =
  '<!-- agent-scrum:technical-analysis-changes-requested -->';

export interface TechnicalAnalysisComment {
  body: string;
  authorAgentId: string | null;
  createdAt?: Date | string;
}

const ALLOWED_TRANSITIONS: Record<ProjectOnboardingStatus, ProjectOnboardingStatus[]> = {
  not_started: ['analysis_in_progress'],
  analysis_in_progress: ['analysis_ready'],
  analysis_ready: ['analysis_in_progress', 'backlog_in_progress'],
  backlog_in_progress: ['sprint_planning', 'active'],
  sprint_planning: ['active'],
  active: ['completed'],
  completed: [],
};

/** Erstellt den leeren Startzustand fur eine neue Organisation. */
export function createInitialProjectOnboarding(now = new Date().toISOString()): ProjectOnboarding {
  return {
    status: 'not_started',
    projectId: null,
    projectName: null,
    rootIssueId: null,
    requiresSprint: true,
    refinementRequestedTaskIds: [],
    scopeHolds: [],
    brief: null,
    constraints: null,
    startedAt: null,
    updatedAt: now,
  };
}

/** Validiert und normalisiert die Formulareingabe aus dem Scrum Board. */
export function parseProjectOnboardingInput(input: {
  projectId?: unknown;
  brief?: unknown;
  constraints?: unknown;
  skipSprintPlanning?: unknown;
  deliveryBranch?: unknown;
}): ProjectOnboardingInputResult {
  const projectId = trimmedString(input.projectId);
  if (!projectId) return { valid: false, error: 'Choose a Paperclip project first.' };

  const brief = trimmedString(input.brief);
  if (!brief) return { valid: false, error: 'Describe the work to start.' };

  const constraints = trimmedString(input.constraints);
  return {
    valid: true,
    value: {
      projectId,
      brief,
      constraints: constraints || null,
      skipSprintPlanning: input.skipSprintPlanning === true,
      deliveryBranch: normalizeBranchName(input.deliveryBranch),
    },
  };
}

/** Verbindet einen bestaetigten Auftrag mit dem vom Host angelegten Root-Issue. */
export function startProjectOnboarding({
  input,
  projectName,
  rootIssueId,
  requiresSprint = true,
  now = new Date().toISOString(),
}: StartProjectOnboardingParams): ProjectOnboarding {
  return {
    status: 'analysis_in_progress',
    projectId: input.projectId,
    projectName,
    rootIssueId,
    requiresSprint,
    refinementRequestedTaskIds: [],
    scopeHolds: [],
    brief: input.brief,
    constraints: input.constraints,
    // Die Branchwahl ueberlebt den ganzen Ablauf: sie wird am Sprintstart
    // wieder angeboten, gilt aber schon vorher — auch fuer eine kleine
    // Umsetzung, die das Sprint-Planning ueberspringt.
    deliveryBranch: input.deliveryBranch,
    startedAt: now,
    updatedAt: now,
  };
}

/** Wechselt nur entlang des menschlich freigegebenen Onboarding-Ablaufs. */
export function transitionProjectOnboarding(
  onboarding: ProjectOnboarding,
  nextStatus: ProjectOnboardingStatus,
  now = new Date().toISOString()
): ProjectOnboarding {
  if (!ALLOWED_TRANSITIONS[onboarding.status].includes(nextStatus)) {
    throw new Error(`Cannot transition project onboarding from ${onboarding.status} to ${nextStatus}.`);
  }

  return { ...onboarding, status: nextStatus, updatedAt: now };
}

/** Die Stufe, auf die ein Human den Projektablauf zurueckstellen kann. */
export type ProjectWorkflowResetTarget = 'stories' | 'refinement';

/**
 * Stellt den Ablauf auf eine fruehere Stufe zurueck.
 *
 * Ein Sprint, der auf der falschen Grundlage gestartet ist, laesst sich sonst
 * nur abwarten: die Statusuebergaenge laufen bewusst nur vorwaerts. Der Reset
 * ist die ausdrueckliche Ausnahme davon — er kommt vom Human, nicht von einem
 * Agenten, und deshalb steht er neben `transitionProjectOnboarding` statt die
 * erlaubten Uebergaenge aufzuweichen.
 *
 * `stories` gibt den Backlog an den Product Owner zurueck, `refinement` behaelt
 * die Stories und laesst den Technical Lead neu schaetzen. Beide Ziele
 * entwerten die bisherigen Schaetzungen: nach einem Reset ist keine davon mehr
 * die Grundlage einer Sprintfreigabe.
 */
export function resetProjectOnboarding(
  onboarding: ProjectOnboarding,
  target: ProjectWorkflowResetTarget,
  /** Die Refinement-Kommentare, die dieser Reset entwertet. */
  voidedCommentIds: readonly string[] = [],
  now = new Date().toISOString()
): ProjectOnboarding {
  return {
    ...onboarding,
    status: target === 'stories' ? 'backlog_in_progress' : 'sprint_planning',
    refinementResetAt: now,
    // Frueher entwertete Marker bleiben entwertet: ein zweiter Reset darf eine
    // Schaetzung aus der ersten Runde nicht wieder gueltig machen.
    refinementVoidedCommentIds: [
      ...new Set([...(onboarding.refinementVoidedCommentIds ?? []), ...voidedCommentIds]),
    ],
    refinementRequestedTaskIds: [],
    refinementAttempts: [],
    refinementWaits: [],
    updatedAt: now,
  };
}

/** Aus welchen Phasen ein Reset ueberhaupt sinnvoll ist. */
export function canResetProjectWorkflow(onboarding: ProjectOnboarding | undefined): boolean {
  return (
    onboarding?.status === 'backlog_in_progress' ||
    onboarding?.status === 'sprint_planning' ||
    onboarding?.status === 'active'
  );
}

/** Bestehende Board-Automationen starten erst nach einer Backlog-Freigabe. */
export function canRunAutomaticDelivery(onboarding: ProjectOnboarding): boolean {
  return onboarding.status === 'active';
}

/**
 * Darf das Plugin ein Ticket durch Development, Review und QA reichen?
 *
 * Dieselbe Frage wie `canRunAutomaticDelivery`, aber fuer die Host-Ereignisse.
 * Die Weiterleitungskette lief bisher ungeprueft bei *jedem* Issue-Event — ein
 * Agent, der sich vor dem Sprintstart selbst ein Ticket auf `done` setzte,
 * bekam daraufhin vom Plugin einen Developer zugewiesen und die Lieferung lief
 * am Sprint-Gate vorbei.
 */
export function canRouteDelivery(onboarding: ProjectOnboarding | undefined): boolean {
  return Boolean(onboarding && canRunAutomaticDelivery(onboarding));
}

/**
 * Phasen, in denen der Human die Lieferung noch nicht freigegeben hat.
 *
 * Der Product Owner schreibt Stories, der Technical Lead verfeinert sie — was
 * darueber hinausgeht, gehoert zurueck ins Backlog.
 */
export function isPreDeliveryGate(onboarding: ProjectOnboarding | undefined): boolean {
  return onboarding?.status === 'backlog_in_progress' || onboarding?.status === 'sprint_planning';
}

/** Git erlaubt vieles, aber nicht alles — und ein Branch mit Leerzeichen bricht jeden Push. */
export function normalizeBranchName(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[~^:?*[\\\]]/g, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^[/.]+|[/.]+$/g, '')
    .slice(0, 200);

  if (!normalized || normalized.includes('..') || normalized.endsWith('.lock')) return null;
  return normalized;
}

/** Schlaegt einen Lieferbranch vor, solange der Human keinen gewaehlt hat. */
export function suggestDeliveryBranch(
  onboarding: Pick<ProjectOnboarding, 'projectName' | 'brief'>,
  sprintNumber = 1
): string {
  const source = onboarding.projectName ?? onboarding.brief ?? 'delivery';
  const slug = source
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return `feature/${slug || 'delivery'}-sprint-${Math.max(1, sprintNumber)}`;
}

/** Creates the persisted local sprint context for a host-backed project delivery cycle. */
export function createProjectSprint({
  onboarding,
  id,
  sprintNumber,
  lengthWeeks,
  now = new Date().toISOString(),
}: CreateProjectSprintParams): ScrumSprint {
  if (onboarding.status !== 'sprint_planning') {
    throw new Error('A project sprint can only start from the sprint-planning gate.');
  }

  const startDate = new Date(now);
  const endDate = new Date(now);
  endDate.setUTCDate(endDate.getUTCDate() + Math.max(1, lengthWeeks) * 7);

  return {
    id,
    name: `Sprint ${sprintNumber}: ${onboarding.projectName ?? 'Project'}`,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    status: 'active',
    taskIds: [],
    goal: onboarding.brief,
    velocity: 0,
    completedPoints: 0,
    // Der Branch ist eine Sprintentscheidung, keine Ticketentscheidung: alle
    // Tickets eines Sprints liefern auf denselben Branch, damit am Ende genau
    // ein Pull Request entsteht.
    deliveryBranch: onboarding.deliveryBranch ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Nur eine ausdrücklich abgeschlossene Technical-Lead-Analyse entsperrt den PO. */
export function isTechnicalAnalysisComplete(
  comments: TechnicalAnalysisComment[],
  technicalLeadId: string | null
): boolean {
  if (!technicalLeadId) return false;

  const markers = comments
    .map((comment, index) => ({ comment, index, timestamp: Date.parse(String(comment.createdAt ?? "")) }))
    .filter(({ comment }) =>
      comment.body.includes(TECHNICAL_ANALYSIS_CHANGES_REQUESTED_MARKER) ||
      (comment.authorAgentId === technicalLeadId &&
        comment.body.includes(TECHNICAL_ANALYSIS_COMPLETION_MARKER))
    );
  if (markers.length === 0) return false;

  const hasTimestamps = markers.every(({ timestamp }) => Number.isFinite(timestamp));
  const latest = markers.reduce((current, candidate) => {
    if (hasTimestamps) return candidate.timestamp >= current.timestamp ? candidate : current;
    return candidate.index > current.index ? candidate : current;
  });

  return (
    latest.comment.authorAgentId === technicalLeadId &&
    latest.comment.body.includes(TECHNICAL_ANALYSIS_COMPLETION_MARKER)
  );
}

/**
 * Entscheidet, ob ein Board einen neuen Projektauftrag beginnen darf.
 *
 * Alte leere Boards wurden bei der Migration als `active` erhalten, damit ein
 * Upgrade ihre frühere Automation nicht abstellt. Ohne Projekt, Ticket oder
 * Sprint sind sie trotzdem ein sinnvoller Einstieg für das neue Onboarding.
 */
export function canStartNewProjectOnboarding(
  onboarding: ProjectOnboarding | undefined,
  { taskCount, hasCurrentSprint }: NewProjectOnboardingContext
): boolean {
  if (!onboarding || onboarding.status === 'not_started') return true;
  if (onboarding.status === 'completed') return !hasCurrentSprint;

  return (
    onboarding.status === 'active' &&
    onboarding.projectId === null &&
    onboarding.rootIssueId === null &&
    taskCount === 0 &&
    !hasCurrentSprint
  );
}

/** Formuliert den ersten, projektgebundenen Auftrag an den Technical Lead. */
export function createTechnicalAnalysisPrompt(onboarding: ProjectOnboarding): string {
  return [
    'You are the Technical Lead for a project kickoff.',
    `Project: ${onboarding.projectName ?? 'Unknown project'}`,
    `Human request:\n${onboarding.brief ?? ''}`,
    onboarding.constraints ? `Constraints:\n${onboarding.constraints}` : null,
    [
      'Inspect the repository and the project workspace attached to this issue before proposing work.',
      'Do not implement code and do not create user stories.',
      'Document your findings as a comment on this issue:',
      '- relevant application areas, components, and file paths',
      '- existing UI, design-system, accessibility, and testing patterns',
      '- build and test commands that the delivery team should use',
      '- implementation risks, dependencies, and an initial technical approach',
      `End the completed analysis comment with exactly: ${TECHNICAL_ANALYSIS_COMPLETION_MARKER}`,
      'Wait for the human to request Product Owner backlog discovery after your analysis.',
    ].join('\n'),
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

/** Formuliert den zweiten, vom Human freigegebenen Auftrag an den Product Owner. */
export function createBacklogDiscoveryPrompt(onboarding: ProjectOnboarding): string {
  return [
    'You are the Product Owner for a project kickoff.',
    `Project: ${onboarding.projectName ?? 'Unknown project'}`,
    `Human request:\n${onboarding.brief ?? ''}`,
    onboarding.constraints ? `Constraints:\n${onboarding.constraints}` : null,
    [
      'Read the Technical Lead analysis and all prior comments on this issue before creating work.',
      'Do not implement code.',
      'Create a small, ordered first backlog as child issues of this kickoff issue.',
      'Each child issue must retain the project context, inherit this issue\'s execution workspace,',
      'and include a user story, acceptance criteria, priority, and a clear value statement.',
      'Keep the initial backlog focused on the requested outcome; call out open product decisions in a comment.',
      'Wait for human backlog approval before moving any story into delivery.',
    ].join('\n'),
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}