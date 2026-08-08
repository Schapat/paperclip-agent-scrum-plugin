/**
 * Learning Module Exports
 */
export {
  PATTERN_THRESHOLD,
  SLOW_COLUMN_HOURS,
  collectCandidates,
  detectReviewRejections,
  detectMaterializedRisks,
  detectFlowBottlenecks,
  detectTechnicalNotes,
  findMatchingSkill,
  toLearning,
  toSkillName,
  createSkill,
  reinforceSkill,
  activeSkillsForRole,
  type LearningCandidate,
} from './extract';

export {
  collectProposals,
  proposeFromUnmetCriteria,
  proposeFromRisks,
  proposeFromRejections,
  proposeFollowUps,
} from './story-proposals';
