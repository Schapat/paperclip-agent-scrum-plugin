/**
 * Factories für Domain-Objekte
 *
 * Zentrale Konstruktion von Tickets, Kommentaren, Entscheidungen und
 * Nachrichten. Die Refinement-Felder eines Tickets (Akzeptanzkriterien,
 * Risiken, Links) sind erst nach dem Refinement gefüllt — die Factories setzen
 * dafür sichere Defaults, damit kein Aufrufer `undefined` behandeln muss.
 */

import type {
  AcceptanceCriterion,
  AgentDecision,
  AgentMessage,
  CeremonyRecord,
  CeremonyType,
  DecisionType,
  ScrumAgent,
  ScrumTask,
  ScrumTaskInput,
  TicketComment,
  TicketRisk,
} from './types';

/**
 * Erzeugt eine ID.
 *
 * `crypto.randomUUID` ist in Workern und modernen Browsern verfügbar; der
 * Fallback deckt ältere Umgebungen und Test-Runner ohne WebCrypto ab.
 */
export function createId(): string {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Baut ein vollständiges Ticket aus den Pflichtfeldern plus Overrides.
 *
 * Alles, was der Product Owner beim Anlegen noch nicht weiß, bekommt einen
 * Default: das Ticket ist unrefined, ohne Akzeptanzkriterien und ohne Links.
 */
export function createScrumTask(input: ScrumTaskInput): ScrumTask {
  const now = new Date().toISOString();
  const column = input.column ?? 'backlog';

  return {
    id: input.id ?? createId(),
    title: input.title,
    description: input.description,
    type: input.type ?? 'story',
    storyPoints: input.storyPoints ?? 0,
    column,
    assignedAgentId: input.assignedAgentId ?? null,
    sprintId: input.sprintId ?? null,
    parentId: input.parentId ?? null,
    labels: input.labels ?? [],
    priority: input.priority ?? 'medium',

    acceptanceCriteria: input.acceptanceCriteria ?? [],
    technicalNotes: input.technicalNotes ?? null,
    risks: input.risks ?? [],
    links: input.links ?? [],
    refined: input.refined ?? false,

    comments: input.comments ?? [],
    decisions: input.decisions ?? [],

    // Beim Normalisieren geladener Tickets müssen die Originalzeitstempel
    // erhalten bleiben, sonst verfälscht die Migration die Cycle-Time-Metrik.
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    statusHistory: input.statusHistory ?? [
      { from: null, to: column, timestamp: now, triggeredBy: input.assignedAgentId ?? null },
    ],
  };
}

/**
 * Ergänzt fehlende Felder an einem (z.B. aus dem Storage geladenen) Ticket.
 *
 * Persistierter State kann aus einer älteren Plugin-Version stammen, in der
 * die Refinement- und Protokollfelder noch nicht existierten. Ohne diese
 * Migration wären `task.comments.map(...)` und Co. Laufzeitfehler.
 */
export function normalizeScrumTask(task: Partial<ScrumTask> & { id: string }): ScrumTask {
  return createScrumTask({
    ...task,
    title: task.title ?? '(ohne Titel)',
    description: task.description ?? '',
  });
}

/**
 * Erzeugt ein Akzeptanzkriterium (ungeprüft).
 */
export function createAcceptanceCriterion(text: string, addedBy: string | null = null): AcceptanceCriterion {
  return {
    id: createId(),
    text,
    met: false,
    addedBy,
    verifiedBy: null,
    verifiedAt: null,
  };
}

/**
 * Erzeugt ein Refinement-Risiko.
 */
export function createRisk(
  description: string,
  severity: TicketRisk['severity'] = 'medium',
  raisedBy: string | null = null,
  mitigation: string | null = null
): TicketRisk {
  return {
    id: createId(),
    description,
    severity,
    mitigation,
    raisedBy,
    raisedAt: new Date().toISOString(),
  };
}

/**
 * Erzeugt einen Ticket-Kommentar.
 */
export function createComment(
  taskId: string,
  author: Pick<ScrumAgent, 'id' | 'name' | 'role'> | null,
  body: string,
  messageId: string | null = null
): TicketComment {
  return {
    id: createId(),
    taskId,
    authorId: author?.id ?? null,
    authorName: author?.name ?? 'System',
    authorRole: author?.role ?? 'system',
    body,
    createdAt: new Date().toISOString(),
    messageId,
  };
}

/**
 * Erzeugt eine protokollierte Agentenentscheidung.
 *
 * `reasoning` ist bewusst ein Pflichtparameter — eine Entscheidung ohne
 * Begründung wäre im Board nicht nachvollziehbar (Spec §5).
 */
export function createDecision(
  taskId: string | null,
  type: DecisionType,
  description: string,
  reasoning: string,
  madeBy: Pick<ScrumAgent, 'id' | 'name' | 'role'> | null,
  relatedTaskIds: string[] = []
): AgentDecision {
  return {
    id: createId(),
    taskId,
    type,
    description,
    reasoning,
    madeById: madeBy?.id ?? null,
    madeByName: madeBy?.name ?? 'System',
    madeByRole: madeBy?.role ?? 'system',
    timestamp: new Date().toISOString(),
    relatedTaskIds,
  };
}

/**
 * Erzeugt eine Agent-zu-Agent-Nachricht.
 *
 * `to === null` ist ein Broadcast an das gesamte Team (z.B. der Scrum Master
 * beim Start des Sprint Plannings).
 */
export function createMessage(params: {
  from: Pick<ScrumAgent, 'id' | 'name' | 'role'> | null;
  to: string[] | null;
  subject: string;
  body: string;
  taskId?: string | null;
  ceremony?: CeremonyType | null;
}): AgentMessage {
  return {
    id: createId(),
    fromAgentId: params.from?.id ?? null,
    fromAgentName: params.from?.name ?? 'System',
    fromAgentRole: params.from?.role ?? 'system',
    toAgentIds: params.to,
    taskId: params.taskId ?? null,
    ceremony: params.ceremony ?? null,
    subject: params.subject,
    body: params.body,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Erzeugt einen Zeremonie-Eintrag.
 */
export function createCeremonyRecord(
  type: CeremonyType,
  sprintId: string | null,
  summary: string,
  extras: Partial<Omit<CeremonyRecord, 'id' | 'type' | 'sprintId' | 'summary'>> = {}
): CeremonyRecord {
  return {
    id: createId(),
    type,
    sprintId,
    startedAt: extras.startedAt ?? new Date().toISOString(),
    summary,
    messageIds: extras.messageIds ?? [],
    taskIds: extras.taskIds ?? [],
    retrospective: extras.retrospective,
  };
}
