/**
 * Onboarding Module
 *
 * Handles automatic setup of the Scrum Team when the plugin is installed:
 * - Creates all 6 Scrum agents with their AGENTS.md instructions
 * - Sets up reporting structure
 * - Creates Scrum labels
 * - Creates initial sprint
 * - Sends success notification to board
 */

export {
  // Main functions
  createScrumTeam,
  createScrumLabels,
  createInitialSprint,
  runOnboarding,
  // Instructions helpers
  loadAgentInstructionsFromFiles,
  createAgentInstructions,
  createOnboardingLogger,
  // Constants
  SCRUM_AGENTS,
  SCRUM_LABELS,
  // Types
  type OnboardingResult,
  type OnboardingContext,
  type OnboardingError,
  type AgentDefinition,
  type LabelDefinition,
  type ScrumRole,
  type AgentIcon,
  type CreatedAgent,
  type CreatedLabel,
  type CreatedSprint,
} from './onboarding';
