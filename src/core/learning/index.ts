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
  SKILL_BLOCK_START,
  SKILL_BLOCK_END,
  renderSkillBlock,
  stripSkillBlock,
  applySkillBlock,
  buildInstructionsForRole,
  collectInstructionUpdates,
  type InstructionUpdate,
} from './instructions';

export {
  toSkillSlug,
  toSkillMarkdown,
  ensureLibrarySkills,
  assignSkillsToAgent,
  type SkillSyncClient,
  type SkillSyncResult,
} from './skill-sync';

export {
  collectProposals,
  proposeFromUnmetCriteria,
  proposeFromRisks,
  proposeFromRejections,
  proposeFollowUps,
} from './story-proposals';
