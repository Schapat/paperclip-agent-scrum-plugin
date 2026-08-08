/**
 * Migration persistierter Board-Daten
 *
 * Der Board-Zustand liegt im Plugin-State des Hosts (`ctx.state`). Gespeicherte
 * Daten können aus einer älteren Plugin-Version stammen, in der einzelne Felder
 * noch nicht existierten — ohne Migration würde `state.messages.push(...)` beim
 * ersten Zeremonie-Lauf werfen.
 */

import type { ScrumTask, WorkerState } from '../types';
import { normalizeScrumTask } from '../factories';

/**
 * Aktuelle Schema-Version des persistierten States.
 */
export const STATE_SCHEMA_VERSION = 3;

/**
 * Stellt einen geladenen State auf das aktuelle Schema um.
 *
 * Fehlende Felder aus älteren Versionen werden ergänzt, statt sie als
 * `undefined` durchzureichen — sonst würde etwa `state.messages.push(...)`
 * beim ersten Zeremonie-Lauf werfen.
 */
export function migrateState(raw: Partial<WorkerState>): Partial<WorkerState> {
  return {
    ...raw,
    tasks: (raw.tasks ?? []).map((t) => normalizeScrumTask(t as Partial<ScrumTask> & { id: string })),
    agents: raw.agents ?? [],
    messages: raw.messages ?? [],
    ceremonies: raw.ceremonies ?? [],
    completedSprints: raw.completedSprints ?? [],
    learnings: raw.learnings ?? [],
    skills: raw.skills ?? [],
    proposedStories: raw.proposedStories ?? [],
    agentInstructions: raw.agentInstructions ?? {},
  };
}

