/**
 * Ceremonies Module Exports (Spec §2)
 *
 * Die vier im Manifest deklarierten Routine-Handler
 * (`handleImpediments`, `handleSprintReview`, `handleSprintRetro`,
 * `handleBacklogGrooming`) sind hier als benannte Aliase zusätzlich exportiert,
 * damit Manifest und Implementierung nicht auseinanderlaufen.
 */

export type { AgentWorkRequest, CeremonyContext } from './types';
export { isReady, isBlockedByDependency, byBusinessValue, PRIORITY_RANK } from './types';

export { rankCandidates, pickAssignee, currentLoad, type AssignmentCandidate } from './assignment';

export {
  reviewTicket,
  DEFAULT_CHECKLIST,
  type QaChecklist,
  type ReviewInput,
  type ReviewResult,
} from './qa-review';

export { runSprintPlanning, sprintCapacity } from './sprint-planning';
export {
  runBacklogRefinement,
  analyzeBacklog,
  MIN_READY_BACKLOG,
  SPLIT_THRESHOLD_POINTS,
  type RefinementFindings,
} from './refinement';
export {
  runImpedimentResolution,
  resolveBlockers,
  fillIdleCapacity,
  type ImpedimentResult,
} from './impediment-resolution';
export { runSprintReview, analyzeSprint, type SprintReviewResult } from './sprint-review';
export {
  runRetrospective,
  analyzeProcess,
  averageTimePerColumn,
  countReviewRejections,
  BOTTLENECK_HOURS,
} from './retrospective';

// ---------------------------------------------------------------------------
// Manifest-Handler-Aliase (manifest/manifest.js → routineTemplates.handler)
// ---------------------------------------------------------------------------

export { runImpedimentResolution as handleImpediments } from './impediment-resolution';
export { runSprintReview as handleSprintReview } from './sprint-review';
export { runRetrospective as handleSprintRetro } from './retrospective';
export { runBacklogRefinement as handleBacklogGrooming } from './refinement';
