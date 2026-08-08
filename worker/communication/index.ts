/**
 * Communication Module Exports
 */
export {
  findAgentByRole,
  findAgentsByRole,
  findAgentById,
  sendMessage,
  broadcast,
  recordDecision,
  collectDecisions,
  messagesForTask,
  type SendMessageParams,
  type RecordDecisionParams,
} from './message-bus';
