/**
 * Migration persistierter Board-Daten
 *
 * Der Board-Zustand liegt im Plugin-State des Hosts (`ctx.state`). Gespeicherte
 * Daten können aus einer älteren Plugin-Version stammen, in der einzelne Felder
 * noch nicht existierten — ohne Migration würde `state.messages.push(...)` beim
 * ersten Zeremonie-Lauf werfen.
 */

import type {
  IntentLog,
  IntentRecord,
  ProjectOnboarding,
  ScrumTask,
  WorkerState,
} from '../types';
import { normalizeScrumTask } from '../factories';
import { createInitialProjectOnboarding } from '../project-onboarding';

/**
 * Aktuelle Schema-Version des persistierten States.
 */
export const STATE_SCHEMA_VERSION = 9;

/**
 * Liest die Zustellvermerke eines gespeicherten Boards.
 *
 * Ein unlesbarer Vermerk wird verworfen statt repariert: er kostet hoechstens
 * einen zusaetzlichen Weckruf, waehrend ein geratener Zaehler eine Eskalation
 * ausloesen koennte, die nie stattgefunden hat.
 */
function normalizeIntentLog(value: unknown): IntentLog {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const log: IntentLog = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue;
    const record = candidate as Partial<IntentRecord>;
    if (typeof record.lastDeliveredAt !== 'string' || typeof record.attempts !== 'number') continue;
    if (!Number.isFinite(record.attempts) || record.attempts < 0) continue;

    log[key] = { lastDeliveredAt: record.lastDeliveredAt, attempts: Math.floor(record.attempts) };
  }
  return log;
}

/**
 * Stellt einen geladenen State auf das aktuelle Schema um.
 *
 * Fehlende Felder aus älteren Versionen werden ergänzt, statt sie als
 * `undefined` durchzureichen — sonst würde etwa `state.messages.push(...)`
 * beim ersten Zeremonie-Lauf werfen.
 */
export function migrateState(raw: Partial<WorkerState>): Partial<WorkerState> {
  // Eine vor dem Onboarding gespeicherte Organisation soll beim Upgrade ihre
  // bisherige Automation behalten. Frisch angelegte Boards setzen dagegen im
  // Worker explizit den Status `not_started`.
  const legacyOnboarding = {
    ...createInitialProjectOnboarding(),
    status: 'active' as const,
  };
  const savedOnboarding = raw.projectOnboarding as Partial<ProjectOnboarding> | undefined;
  const projectOnboarding = savedOnboarding
    ? {
        ...createInitialProjectOnboarding(),
        ...savedOnboarding,
        requiresSprint:
          typeof savedOnboarding.requiresSprint === 'boolean'
            ? savedOnboarding.requiresSprint
            : savedOnboarding.status === 'not_started',
        refinementRequestedTaskIds: Array.isArray(savedOnboarding.refinementRequestedTaskIds)
          ? savedOnboarding.refinementRequestedTaskIds.filter((taskId): taskId is string => typeof taskId === 'string')
          : [],
        scopeHolds: Array.isArray(savedOnboarding.scopeHolds)
          ? savedOnboarding.scopeHolds.flatMap((hold) => {
              if (typeof hold !== 'object' || hold === null) return [];
              const candidate = hold as Partial<ProjectOnboarding['scopeHolds'][number]>;
              return (
                typeof candidate.issueId === 'string' &&
                typeof candidate.title === 'string' &&
                typeof candidate.heldAt === 'string'
              )
                ? [{ issueId: candidate.issueId, title: candidate.title, heldAt: candidate.heldAt }]
                : [];
            })
          : [],
      }
    : legacyOnboarding;

  return {
    ...raw,
    projectOnboarding,
    tasks: (raw.tasks ?? []).map((t) => normalizeScrumTask(t as Partial<ScrumTask> & { id: string })),
    agents: raw.agents ?? [],
    messages: raw.messages ?? [],
    ceremonies: raw.ceremonies ?? [],
    completedSprints: raw.completedSprints ?? [],
    learnings: raw.learnings ?? [],
    skills: raw.skills ?? [],
    proposedStories: raw.proposedStories ?? [],
    agentInstructions: raw.agentInstructions ?? {},
    intentLog: normalizeIntentLog(raw.intentLog),
  };
}

