/**
 * Materialisiert projektgebundene Paperclip-Issues im lokalen Scrum Board.
 *
 * Das Modul kennt nur einen kleinen Snapshot des Host-Issues. Der Worker
 * liefert diesen nach einem kanonischen `ctx.issues.get()` und entscheidet
 * anschliessend, ob der geaenderte State gespeichert werden muss.
 */

import { createScrumTask } from './factories';
import {
  projectIssueProjection,
  type ProjectIssueCommentSnapshot,
} from './project-issue-projection';
import type { ProjectOnboarding, ScrumAgent, ScrumTask, TaskStatus } from './types';

type ProjectIssueStatus = TaskStatus | 'cancelled';
type HostTimestamp = Date | string;

/** Die fuer das Board benoetigte, stabile Teilmenge eines Paperclip-Issues. */
export interface ProjectIssueSnapshot {
  id: string;
  identifier: string | null;
  projectId: string | null;
  parentId: string | null;
  title: string;
  description: string | null;
  status: ProjectIssueStatus;
  priority: ScrumTask['priority'];
  assigneeAgentId: string | null;
  startedAt: HostTimestamp | null;
  completedAt: HostTimestamp | null;
  createdAt: HostTimestamp;
  updatedAt: HostTimestamp;
  comments?: ProjectIssueCommentSnapshot[];
}

export type ProjectIssueSyncAction = 'ignored' | 'unchanged' | 'created' | 'updated' | 'removed';

export interface ProjectIssueSyncResult {
  /** Der Event gehoert zum aktuellen Projekt-Onboarding und braucht keine Zeremonie-Auswertung. */
  handled: boolean;
  changed: boolean;
  action: ProjectIssueSyncAction;
  taskId?: string;
}

/** Completes legacy board tasks with the current human-readable Paperclip identifier. */
export function syncTaskIdentifiers(
  tasks: ScrumTask[],
  issues: Array<Pick<ProjectIssueSnapshot, 'id' | 'identifier'>>
): boolean {
  const identifiers = new Map(
    issues.flatMap((issue) => {
      const identifier = issue.identifier?.trim();
      return identifier ? [[issue.id, identifier]] : [];
    })
  );

  let changed = false;
  for (const task of tasks) {
    const identifier = identifiers.get(task.id);
    if (identifier && task.identifier !== identifier) {
      task.identifier = identifier;
      changed = true;
    }
  }
  return changed;
}

/**
 * Synchronisiert einen direkten Child-Issue des Kickoff-Issues in das lokale
 * Board. Lokale Refinement-Felder, Kommentare und Entscheidungen bleiben bei
 * Host-Updates erhalten; ausschliesslich Host-eigene Felder werden ersetzt.
 */
export function syncProjectOnboardingIssue(
  tasks: ScrumTask[],
  onboarding: ProjectOnboarding | undefined,
  issue: ProjectIssueSnapshot,
  actorId: string | null = null,
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>> = []
): ProjectIssueSyncResult {
  if (!onboarding?.rootIssueId || !onboarding.projectId) {
    return ignored();
  }

  // Der Root-Issue ist ein Steuerobjekt, kein Kanban-Ticket.
  if (issue.id === onboarding.rootIssueId) {
    return { handled: true, changed: false, action: 'unchanged', taskId: issue.id };
  }

  const existingIndex = tasks.findIndex((task) => task.id === issue.id);
  const isDirectChild =
    issue.projectId === onboarding.projectId && issue.parentId === onboarding.rootIssueId;

  // Wird eine bereits gespiegelte Story verschoben, umgehaengt oder storniert,
  // verschwindet sie auch aus diesem projektgebundenen Board.
  if (!isDirectChild || issue.status === 'cancelled') {
    if (existingIndex === -1) return ignored();
    tasks.splice(existingIndex, 1);
    return { handled: true, changed: true, action: 'removed', taskId: issue.id };
  }

  // Frueher wurde ein Child-Issue vor der Backlog-Phase gar nicht gespiegelt.
  // Die Absicht war richtig — vor der Freigabe darf keine Automation
  // anspringen — das Mittel war es nicht: der Product Owner hat die Stories
  // trotzdem geschrieben, und das Board zeigte einen leeren Backlog neben
  // sieben existierenden Tickets. Unsichtbare Arbeit ist die teuerste Sorte.
  //
  // Gespiegelt wird deshalb immer. Dass daraus nichts *laeuft*, sichern die
  // Gates an ihren eigenen Stellen: `canRouteDelivery` fuer die Weiterleitung,
  // `isPreDeliveryGate` fuer die Rueckholung, und Refinement wie Planung
  // pruefen den Status ohnehin selbst.

  const hostFields = toHostFields(issue, agents, onboarding.refinementVoidedCommentIds);
  if (existingIndex === -1) {
    tasks.push(
      createScrumTask({
        id: issue.id,
        identifier: hostFields.identifier,
        title: hostFields.title,
        description: hostFields.description,
        column: hostFields.column,
        priority: hostFields.priority,
        assignedAgentId: hostFields.assignedAgentId,
        parentId: hostFields.parentId,
        labels: hostFields.labels,
        // Ein Ticket, das erst nach seinem Refinement gespiegelt wird — nach
        // einem Worker-Neustart der Normalfall — kam bisher ohne Schaetzung und
        // ohne Akzeptanzkriterien auf dem Board an. Erst die naechste Aenderung
        // des Host-Issues holte sie nach; blieb sie aus, galt das Ticket
        // dauerhaft als unverfeinert.
        storyPoints: hostFields.storyPoints,
        acceptanceCriteria: hostFields.acceptanceCriteria,
        technicalNotes: hostFields.technicalNotes,
        risks: hostFields.risks,
        refined: hostFields.refined,
        comments: hostFields.comments,
        decisions: hostFields.decisions,
        createdAt: hostFields.createdAt,
        updatedAt: hostFields.updatedAt,
        startedAt: hostFields.startedAt,
        completedAt: hostFields.completedAt,
        commits: hostFields.commits,
        statusHistory: [
          {
            from: null,
            to: hostFields.column,
            timestamp: hostFields.updatedAt,
            triggeredBy: actorId,
          },
        ],
      })
    );
    return { handled: true, changed: true, action: 'created', taskId: issue.id };
  }

  const existing = tasks[existingIndex];
  if (hasSameHostFields(existing, hostFields)) {
    return { handled: true, changed: false, action: 'unchanged', taskId: issue.id };
  }

  if (existing.column !== hostFields.column) {
    existing.statusHistory.push({
      from: existing.column,
      to: hostFields.column,
      timestamp: hostFields.updatedAt,
      triggeredBy: actorId,
    });
  }

  Object.assign(existing, hostFields);
  return { handled: true, changed: true, action: 'updated', taskId: issue.id };
}

/**
 * Projects a host issue for board-side inspection without turning it into a
 * delivery card. The kickoff uses this so its analysis remains in the board
 * while direct child issues alone remain Kanban work.
 */
export function projectIssueDetailTask(
  issue: ProjectIssueSnapshot,
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>> = []
): ScrumTask | null {
  if (issue.status === 'cancelled') return null;

  const fields = toHostFields(issue, agents);
  return createScrumTask({
    id: issue.id,
    identifier: fields.identifier,
    title: fields.title,
    description: fields.description,
    type: 'epic',
    column: fields.column,
    priority: fields.priority,
    assignedAgentId: fields.assignedAgentId,
    parentId: fields.parentId,
    labels: fields.labels,
    storyPoints: fields.storyPoints,
    acceptanceCriteria: fields.acceptanceCriteria,
    technicalNotes: fields.technicalNotes,
    risks: fields.risks,
    refined: fields.refined,
    comments: fields.comments,
    commits: fields.commits,
    decisions: fields.decisions,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
    startedAt: fields.startedAt,
    completedAt: fields.completedAt,
    statusHistory: [
      {
        from: null,
        to: fields.column,
        timestamp: fields.updatedAt,
        triggeredBy: fields.assignedAgentId,
      },
    ],
  });
}

interface HostTaskFields {
  identifier: string | null;
  title: string;
  description: string;
  column: TaskStatus;
  priority: ScrumTask['priority'];
  assignedAgentId: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  storyPoints: number;
  acceptanceCriteria: ScrumTask['acceptanceCriteria'];
  technicalNotes: string | null;
  risks: ScrumTask['risks'];
  refined: boolean;
  labels: string[];
  comments: ScrumTask['comments'];
  commits: ScrumTask['commits'];
  decisions: ScrumTask['decisions'];
}

function toHostFields(
  issue: ProjectIssueSnapshot,
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>,
  voidedRefinementCommentIds: readonly string[] = []
): HostTaskFields {
  if (issue.status === 'cancelled') {
    throw new Error('Cancelled issues cannot be materialized as Scrum tasks.');
  }

  const projection = projectIssueProjection({
    issueId: issue.id,
    description: issue.description,
    comments: issue.comments ?? [],
    agents,
    voidedRefinementCommentIds,
  });

  return {
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? '',
    column: issue.status,
    priority: issue.priority,
    assignedAgentId: issue.assigneeAgentId,
    parentId: issue.parentId,
    createdAt: toIso(issue.createdAt),
    updatedAt: toIso(issue.updatedAt),
    startedAt: issue.startedAt ? toIso(issue.startedAt) : null,
    completedAt: issue.completedAt ? toIso(issue.completedAt) : null,
    storyPoints: projection.refinement.storyPoints,
    acceptanceCriteria: projection.refinement.acceptanceCriteria,
    technicalNotes: projection.refinement.technicalNotes,
    risks: projection.refinement.risks,
    refined: projection.refinement.refined,
    labels: projection.refinement.labels,
    comments: projection.comments,
    commits: projection.commits,
    decisions: projection.decisions,
  };
}

function hasSameHostFields(task: ScrumTask, fields: HostTaskFields): boolean {
  return (
    task.identifier === fields.identifier &&
    task.title === fields.title &&
    task.description === fields.description &&
    task.column === fields.column &&
    task.priority === fields.priority &&
    task.assignedAgentId === fields.assignedAgentId &&
    task.parentId === fields.parentId &&
    task.createdAt === fields.createdAt &&
    task.updatedAt === fields.updatedAt &&
    task.startedAt === fields.startedAt &&
    task.completedAt === fields.completedAt &&
    task.storyPoints === fields.storyPoints &&
    task.technicalNotes === fields.technicalNotes &&
    task.refined === fields.refined &&
    sameJson(task.labels, fields.labels) &&
    sameJson(task.acceptanceCriteria, fields.acceptanceCriteria) &&
    sameJson(task.risks, fields.risks) &&
    sameJson(task.comments, fields.comments) &&
    sameJson(task.commits, fields.commits) &&
    sameJson(task.decisions, fields.decisions)
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toIso(value: HostTimestamp): string {
  return value instanceof Date ? value.toISOString() : value;
}

function ignored(): ProjectIssueSyncResult {
  return { handled: false, changed: false, action: 'ignored' };
}