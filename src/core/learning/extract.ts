/**
 * Gewinnung von Learnings aus abgeschlossener Arbeit
 *
 * Kernidee: Ein Learning muss aus dem Board *belegbar* sein. Deshalb wird hier
 * nichts formuliert, was nicht im Ticketverlauf steht — jedes Learning trägt
 * seinen Beleg (`evidence`) mit sich und lässt sich auf konkrete Tickets
 * zurückführen.
 *
 * Erkannt werden wiederkehrende Muster, keine Einzelfälle: ein einmal
 * zurückgewiesenes Ticket ist Alltag, dreimal derselbe Grund ist ein Learning.
 */

import type {
  AgentSkill,
  Learning,
  LearningCategory,
  LearningSource,
  ScrumTask,
  WorkerState,
} from '../types';
import { createId } from '../factories';

/**
 * Ab wie vielen gleichartigen Vorkommnissen ein Muster als Learning gilt.
 *
 * Bei 1 wäre jeder Einzelfall ein Learning und die Skill-Liste würde mit
 * Rauschen volllaufen.
 */
export const PATTERN_THRESHOLD = 2;

/**
 * Ab welcher Verweildauer (Stunden) eine Spalte als Engpass zählt.
 */
export const SLOW_COLUMN_HOURS = 48;

/**
 * Kandidat für ein Learning — vor der Zuordnung zu einem Skill.
 */
export interface LearningCandidate {
  source: LearningSource;
  category: LearningCategory;
  insight: string;
  evidence: string;
  taskIds: string[];
  /** Rollen, die aus diesem Learning einen Skill ableiten sollten */
  roles: string[];
}

// =============================================================================
// Mustererkennung
// =============================================================================

/**
 * Erkennt wiederholte Review-Rückweisungen.
 *
 * Das QA-Feedback steht als Kommentar am Ticket. Wiederholt sich derselbe
 * Ablehnungsgrund über mehrere Tickets, fehlt dem Team eine Fähigkeit.
 */
export function detectReviewRejections(tasks: ScrumTask[]): LearningCandidate[] {
  const rejectedTasks = tasks.filter((task) =>
    task.statusHistory.some((h) => h.from === 'in_review' && h.to === 'in_progress')
  );

  if (rejectedTasks.length < PATTERN_THRESHOLD) return [];

  // Ablehnungsgründe aus den QA-Kommentaren sammeln
  const reasons = new Map<string, string[]>();
  for (const task of rejectedTasks) {
    for (const comment of task.comments) {
      if (!comment.body.includes('Review abgelehnt')) continue;

      for (const line of comment.body.split('\n')) {
        const trimmed = line.trim();
        // Aufzählungspunkte sind die konkreten offenen Kriterien
        if (!trimmed.startsWith('- ')) continue;
        const reason = trimmed.slice(2).trim();
        if (!reason) continue;

        const existing = reasons.get(reason) ?? [];
        if (!existing.includes(task.id)) existing.push(task.id);
        reasons.set(reason, existing);
      }
    }
  }

  const candidates: LearningCandidate[] = [];

  // Ein Grund, der mehrere Tickets betrifft, ist ein Muster
  for (const [reason, taskIds] of reasons) {
    if (taskIds.length < PATTERN_THRESHOLD) continue;
    candidates.push({
      source: 'review_rejection',
      category: 'quality',
      insight: `Vor der Übergabe ins Review sicherstellen: ${reason}`,
      evidence: `${taskIds.length} Tickets wurden aus diesem Grund zurückgewiesen.`,
      taskIds,
      roles: ['developer'],
    });
  }

  // Auch ohne gemeinsamen Grund ist eine hohe Rückweisungsquote ein Signal
  if (candidates.length === 0) {
    candidates.push({
      source: 'review_rejection',
      category: 'quality',
      insight:
        'Akzeptanzkriterien vor der Übergabe ins Review einzeln durchgehen, statt das Ticket als fertig zu melden.',
      evidence: `${rejectedTasks.length} Tickets mussten aus dem Review zurück in die Entwicklung.`,
      taskIds: rejectedTasks.map((t) => t.id),
      roles: ['developer'],
    });
  }

  return candidates;
}

/**
 * Erkennt eingetretene Risiken.
 *
 * Ein Risiko, das der Technical Lead erfasst hat und dessen Ticket dann
 * blockiert war oder zurückgewiesen wurde, hat sich bewahrheitet — daraus
 * lässt sich für kommende Tickets etwas ableiten.
 */
export function detectMaterializedRisks(tasks: ScrumTask[]): LearningCandidate[] {
  const candidates: LearningCandidate[] = [];

  for (const task of tasks) {
    if (task.risks.length === 0) continue;

    const wasBlocked = task.statusHistory.some((h) => h.to === 'blocked');
    const wasRejected = task.statusHistory.some(
      (h) => h.from === 'in_review' && h.to === 'in_progress'
    );
    if (!wasBlocked && !wasRejected) continue;

    for (const risk of task.risks.filter((r) => r.severity !== 'low')) {
      candidates.push({
        source: 'materialized_risk',
        category: 'architecture',
        insight: risk.mitigation
          ? `Risiko "${risk.description}" früh adressieren: ${risk.mitigation}`
          : `Risiko "${risk.description}" bereits im Refinement mit einer Gegenmaßnahme versehen.`,
        evidence: `Ticket "${task.title}" wurde ${wasBlocked ? 'blockiert' : 'im Review zurückgewiesen'}, obwohl das Risiko bekannt war.`,
        taskIds: [task.id],
        roles: ['technical_lead', 'developer'],
      });
    }
  }

  return candidates;
}

/**
 * Erkennt Spalten, in denen Tickets systematisch liegen bleiben.
 */
export function detectFlowBottlenecks(
  tasks: ScrumTask[],
  averagePerColumn: Record<string, number>
): LearningCandidate[] {
  const labels: Record<string, string> = {
    todo: 'TODO',
    in_progress: 'Development',
    in_review: 'Review',
    blocked: 'Blocked',
  };

  const rolesPerColumn: Record<string, string[]> = {
    todo: ['product_owner'],
    in_progress: ['developer', 'technical_lead'],
    in_review: ['qa_engineer'],
    blocked: ['scrum_master'],
  };

  const candidates: LearningCandidate[] = [];

  for (const [column, hours] of Object.entries(averagePerColumn)) {
    if (column === 'done' || column === 'backlog') continue;
    if (hours < SLOW_COLUMN_HOURS) continue;

    candidates.push({
      source: 'flow_bottleneck',
      category: 'process',
      insight:
        column === 'in_review'
          ? 'Review-Kapazität vor der Zuweisung neuer Tickets einplanen, damit fertige Arbeit nicht liegen bleibt.'
          : `Tickets kleiner schneiden, damit sie "${labels[column] ?? column}" schneller verlassen.`,
      evidence: `Durchschnittliche Verweildauer in "${labels[column] ?? column}": ${hours.toFixed(1)}h.`,
      taskIds: tasks.filter((t) => t.statusHistory.some((h) => h.to === column)).map((t) => t.id),
      roles: rolesPerColumn[column] ?? ['scrum_master'],
    });
  }

  return candidates;
}

/**
 * Sammelt technische Hinweise aus abgeschlossenen Tickets.
 *
 * Diese hat der Technical Lead im Refinement geschrieben; nach erfolgreichem
 * Abschluss haben sie sich bewährt und taugen als wiederverwendbares Wissen.
 */
export function detectTechnicalNotes(tasks: ScrumTask[]): LearningCandidate[] {
  const withNotes = tasks.filter((t) => t.column === 'done' && t.technicalNotes?.trim());
  if (withNotes.length === 0) return [];

  return withNotes.map((task) => ({
    source: 'technical_note' as LearningSource,
    category: 'code' as LearningCategory,
    insight: task.technicalNotes!.trim(),
    evidence: `Bewährt bei "${task.title}" (abgeschlossen).`,
    taskIds: [task.id],
    roles: ['developer', 'technical_lead'],
  }));
}

// =============================================================================
// Zusammenführung
// =============================================================================

/**
 * Sammelt alle Learning-Kandidaten aus den Tickets eines Sprints.
 */
export function collectCandidates(
  tasks: ScrumTask[],
  averagePerColumn: Record<string, number>
): LearningCandidate[] {
  return [
    ...detectReviewRejections(tasks),
    ...detectMaterializedRisks(tasks),
    ...detectFlowBottlenecks(tasks, averagePerColumn),
    ...detectTechnicalNotes(tasks),
  ];
}

/**
 * Findet einen bestehenden Skill mit gleicher Aussage.
 *
 * Wiederkehrende Erkenntnisse sollen den vorhandenen Skill *bestärken*, statt
 * Duplikate anzulegen — sonst wäre die Skill-Liste nach wenigen Sprints
 * unbrauchbar.
 */
export function findMatchingSkill(state: WorkerState, candidate: LearningCandidate): AgentSkill | null {
  const normalized = candidate.insight.trim().toLowerCase();
  return (
    state.skills.find(
      (s) => s.category === candidate.category && s.description.trim().toLowerCase() === normalized
    ) ?? null
  );
}

/**
 * Wandelt einen Kandidaten in ein Learning um.
 */
export function toLearning(
  candidate: LearningCandidate,
  sprintId: string | null,
  skillId: string | null = null
): Learning {
  return {
    id: createId(),
    sourceTaskIds: candidate.taskIds,
    source: candidate.source,
    category: candidate.category,
    insight: candidate.insight,
    evidence: candidate.evidence,
    sprintId,
    skillId,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Kürzt eine Erkenntnis zu einem Skill-Namen.
 */
export function toSkillName(candidate: LearningCandidate): string {
  const firstSentence = candidate.insight.split(/[.:]/)[0].trim();
  return firstSentence.length > 60 ? `${firstSentence.slice(0, 57)}…` : firstSentence;
}

/**
 * Legt einen neuen Skill aus einem Kandidaten an.
 *
 * Neue Skills sind zunächst inaktiv: erst wenn dasselbe Muster erneut auftritt
 * — oder es aus einer harten Quelle wie einer Review-Rückweisung stammt —
 * wird der Skill aktiviert. So sammeln sich keine Einzelbeobachtungen als
 * verbindliche Anweisungen an.
 */
export function createSkill(candidate: LearningCandidate, learningId: string): AgentSkill {
  const activateImmediately = candidate.source === 'review_rejection';
  const now = new Date().toISOString();

  return {
    id: createId(),
    name: toSkillName(candidate),
    description: candidate.insight,
    category: candidate.category,
    roles: candidate.roles,
    active: activateImmediately,
    learningIds: [learningId],
    reinforcementCount: 1,
    createdAt: now,
    activatedAt: activateImmediately ? now : null,
  };
}

/**
 * Bestärkt einen bestehenden Skill.
 *
 * Beim zweiten Auftreten desselben Musters wird ein bislang inaktiver Skill
 * aktiviert — das Muster hat sich damit bestätigt.
 */
export function reinforceSkill(skill: AgentSkill, learningId: string): AgentSkill {
  skill.learningIds.push(learningId);
  skill.reinforcementCount += 1;

  if (!skill.active) {
    skill.active = true;
    skill.activatedAt = new Date().toISOString();
  }

  return skill;
}

/**
 * Liefert die aktiven Skills einer Rolle.
 *
 * Grundlage dafür, dass ein Agent sein gelerntes Wissen tatsächlich anwendet.
 */
export function activeSkillsForRole(state: WorkerState, role: string): AgentSkill[] {
  return state.skills.filter((s) => s.active && s.roles.includes(role));
}
