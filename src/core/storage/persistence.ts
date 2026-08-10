/**
 * Migration persistierter Board-Daten
 *
 * Der Board-Zustand liegt im Plugin-State des Hosts (`ctx.state`). Gespeicherte
 * Daten können aus einer älteren Plugin-Version stammen, in der einzelne Felder
 * noch nicht existierten — ohne Migration würde `state.messages.push(...)` beim
 * ersten Zeremonie-Lauf werfen.
 */

import type { ProjectOnboarding, ScrumTask, TimeoutRecovery, WorkerState } from '../types';
import { normalizeScrumTask } from '../factories';
import { createInitialProjectOnboarding } from '../project-onboarding';

/**
 * Aktuelle Schema-Version des persistierten States.
 */
export const STATE_SCHEMA_VERSION = 8;

function normalizeTimeoutRecoveries(value: unknown): Record<string, TimeoutRecovery> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const recoveries: Record<string, TimeoutRecovery> = {};
  for (const [taskId, candidate] of Object.entries(value)) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue;
    const recovery = candidate as Partial<TimeoutRecovery>;
    if (
      typeof recovery.sourceRunId !== 'string' ||
      typeof recovery.sourceRunCreatedAt !== 'string' ||
      typeof recovery.attemptedAt !== 'string' ||
      typeof recovery.queued !== 'boolean'
    ) {
      continue;
    }

    recoveries[taskId] = {
      sourceRunId: recovery.sourceRunId,
      sourceRunCreatedAt: recovery.sourceRunCreatedAt,
      attemptedAt: recovery.attemptedAt,
      queued: recovery.queued,
      recoveryRunId: typeof recovery.recoveryRunId === 'string' ? recovery.recoveryRunId : null,
    };
  }
  return recoveries;
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
    timeoutRecoveries: normalizeTimeoutRecoveries(raw.timeoutRecoveries),
  };
}

