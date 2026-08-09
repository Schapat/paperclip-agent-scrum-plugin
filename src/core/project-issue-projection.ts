/**
 * Rebuildable projection of Paperclip issue comments into Scrum board fields.
 *
 * Project-backed work has its source of truth in Paperclip. This module keeps
 * all parsing pure so worker events, board reads, and tests share the exact
 * same refinement and decision contract.
 */

import type {
  AcceptanceCriterion,
  AgentDecision,
  DecisionType,
  ScrumAgent,
  ScrumTask,
  TicketComment,
  TicketCommit,
  TicketRisk,
} from './types';

export const REFINEMENT_MARKER = 'agent-scrum:refinement:v1';
export const DECISION_MARKER = 'agent-scrum:decision:v1';
export const COMMIT_MARKER = 'agent-scrum:commit:v1';

type HostTimestamp = Date | string;

export interface ProjectIssueCommentSnapshot {
  id: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  authorType: string;
  body: string;
  createdAt: HostTimestamp;
  deletedAt?: HostTimestamp | null;
}

export interface ProjectIssueProjectionInput {
  issueId: string;
  description: string | null;
  comments: ProjectIssueCommentSnapshot[];
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>;
}

export interface ProjectRefinementProjection {
  storyPoints: number;
  acceptanceCriteria: AcceptanceCriterion[];
  technicalNotes: string | null;
  risks: TicketRisk[];
  refined: boolean;
  sourceCommentId: string | null;
}

export interface ProjectIssueProjection {
  comments: TicketComment[];
  commits: TicketCommit[];
  decisions: AgentDecision[];
  refinement: ProjectRefinementProjection;
}

export interface ProjectProgress {
  totalTasks: number;
  doneTasks: number;
  inProgressTasks: number;
  reviewTasks: number;
  blockedTasks: number;
  refinedTasks: number;
  unrefinedTasks: number;
  estimatedTasks: number;
  estimatedPoints: number;
  completedPoints: number;
  measure: 'tasks' | 'story_points';
  percent: number;
}

interface RefinementPayload {
  storyPoints?: unknown;
  acceptanceCriteria?: unknown;
  technicalNotes?: unknown;
  risks?: unknown;
}

interface DecisionPayload {
  type?: unknown;
  description?: unknown;
  reasoning?: unknown;
}

interface CommitPayload {
  sha?: unknown;
  url?: unknown;
  message?: unknown;
}

interface ValidDecisionPayload {
  type: DecisionType;
  description: string;
  reasoning: string;
}

const DECISION_TYPES: ReadonlySet<DecisionType> = new Set([
  'auto_assign',
  'status_change',
  'priority_change',
  'estimation',
  'refinement',
  'review_passed',
  'review_rejected',
  'blocked',
  'unblocked',
  'ceremony',
]);

/** Projects the host issue comment history onto its corresponding Scrum task. */
export function projectIssueProjection({
  issueId,
  description,
  comments,
  agents,
}: ProjectIssueProjectionInput): ProjectIssueProjection {
  const activeComments = comments
    .filter((comment) => !comment.deletedAt)
    .sort((left, right) => toIso(left.createdAt).localeCompare(toIso(right.createdAt)));
  const projectedComments = activeComments.map((comment) => toTicketComment(issueId, comment, agents));
  const commits = uniqueCommits(activeComments.flatMap((comment) => toCommitEvidence(comment, agents)));
  const decisions = activeComments.flatMap((comment) => toDecision(issueId, comment, agents));
  const refinement = toRefinement(issueId, description ?? '', activeComments, agents);

  return { comments: projectedComments, commits, decisions, refinement };
}

/**
 * Calculates visible project delivery progress.
 *
 * Estimates are preferred once available; before the Technical Lead estimates
 * the backlog, done-task count remains an honest and useful fallback.
 */
export function projectProgress(tasks: ScrumTask[]): ProjectProgress {
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((task) => task.column === 'done').length;
  const inProgressTasks = tasks.filter((task) => task.column === 'in_progress').length;
  const reviewTasks = tasks.filter((task) => task.column === 'in_review').length;
  const blockedTasks = tasks.filter((task) => task.column === 'blocked').length;
  const refinedTasks = tasks.filter((task) => task.refined).length;
  const unrefinedTasks = totalTasks - refinedTasks;
  const estimatedTasks = tasks.filter((task) => task.storyPoints > 0).length;
  const estimatedPoints = tasks.reduce((total, task) => total + Math.max(0, task.storyPoints), 0);
  const completedPoints = tasks
    .filter((task) => task.column === 'done')
    .reduce((total, task) => total + Math.max(0, task.storyPoints), 0);
  const measure = totalTasks > 0 && estimatedTasks === totalTasks && estimatedPoints > 0
    ? 'story_points'
    : 'tasks';
  const numerator = measure === 'story_points' ? completedPoints : doneTasks;
  const denominator = measure === 'story_points' ? estimatedPoints : totalTasks;

  return {
    totalTasks,
    doneTasks,
    inProgressTasks,
    reviewTasks,
    blockedTasks,
    refinedTasks,
    unrefinedTasks,
    estimatedTasks,
    estimatedPoints,
    completedPoints,
    measure,
    percent: denominator === 0 ? 0 : Math.round((numerator / denominator) * 100),
  };
}

function toTicketComment(
  taskId: string,
  comment: ProjectIssueCommentSnapshot,
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>
): TicketComment {
  const author = comment.authorAgentId
    ? agents.find((agent) => agent.id === comment.authorAgentId) ?? null
    : null;

  return {
    id: comment.id,
    taskId,
    authorId: comment.authorAgentId ?? comment.authorUserId ?? null,
    authorName: author?.name ?? (comment.authorType === 'user' ? 'Human' : 'Paperclip agent'),
    authorRole: author?.role ?? comment.authorType,
    body: comment.body,
    createdAt: toIso(comment.createdAt),
  };
}

function toDecision(
  taskId: string,
  comment: ProjectIssueCommentSnapshot,
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>
): AgentDecision[] {
  const payload = lastMarkerPayload<DecisionPayload>(comment.body, DECISION_MARKER);
  if (!payload || !isDecisionPayload(payload)) return [];

  const author = comment.authorAgentId
    ? agents.find((agent) => agent.id === comment.authorAgentId) ?? null
    : null;

  return [
    {
      id: `host-decision:${comment.id}`,
      taskId,
      type: payload.type,
      description: payload.description,
      reasoning: payload.reasoning,
      madeById: comment.authorAgentId ?? comment.authorUserId ?? null,
      madeByName: author?.name ?? (comment.authorType === 'user' ? 'Human' : 'Paperclip agent'),
      madeByRole: author?.role ?? comment.authorType,
      timestamp: toIso(comment.createdAt),
      relatedTaskIds: [],
    },
  ];
}

function toCommitEvidence(
  comment: ProjectIssueCommentSnapshot,
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>
): TicketCommit[] {
  if (!isDeveloper(comment, agents) || !comment.authorAgentId) return [];

  return markerPayloads<CommitPayload>(comment.body, COMMIT_MARKER).flatMap((payload, index) => {
    const sha = parseCommitSha(payload.sha);
    if (!sha) return [];
    return [{
      id: `host-commit:${comment.id}:${index}`,
      sha,
      url: parseGitHubCommitUrl(payload.url),
      message: parseText(payload.message),
      recordedBy: comment.authorAgentId,
      recordedAt: toIso(comment.createdAt),
    }];
  });
}

function isDeveloper(
  comment: ProjectIssueCommentSnapshot,
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>
): boolean {
  return Boolean(
    comment.authorAgentId &&
      agents.some((agent) => agent.id === comment.authorAgentId && agent.role === 'developer')
  );
}

function uniqueCommits(commits: TicketCommit[]): TicketCommit[] {
  const knownShas = new Set<string>();
  return commits.filter((commit) => {
    if (knownShas.has(commit.sha)) return false;
    knownShas.add(commit.sha);
    return true;
  });
}

function toRefinement(
  issueId: string,
  description: string,
  comments: ProjectIssueCommentSnapshot[],
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>
): ProjectRefinementProjection {
  const source = [...comments]
    .reverse()
    .map((comment) => ({ comment, payload: lastMarkerPayload<RefinementPayload>(comment.body, REFINEMENT_MARKER) }))
    .find(
      (entry) =>
        entry.payload &&
        isRefinementPayload(entry.payload) &&
        isTechnicalLead(entry.comment, agents)
    );
  const payload = source?.payload;
  const sourceComment = source?.comment ?? null;
  const sourceAgentId = sourceComment?.authorAgentId ?? null;
  const storyPoints = payload ? parseStoryPoints(payload.storyPoints) : findStoryPoints(description, comments);
  const acceptanceTexts = payload
    ? parseCriteria(payload.acceptanceCriteria)
    : extractChecklist(description);
  const technicalNotes = payload
    ? parseText(payload.technicalNotes)
    : extractSection(description, ['Technischer Kontext', 'Technical Context', 'Technische Hinweise']);
  const risks = payload ? parseRisks(issueId, payload.risks, sourceAgentId) : [];
  const qaChecks = qaChecksForCriteria(acceptanceTexts, comments, agents);
  const refined = storyPoints > 0 && acceptanceTexts.length > 0;

  return {
    storyPoints,
    acceptanceCriteria: acceptanceTexts.map((text, index) => {
      const qaCheck = qaChecks[index];
      return {
        id: `host-criterion:${issueId}:${index}`,
        text,
        met: qaCheck?.met ?? false,
        addedBy: sourceAgentId,
        verifiedBy: qaCheck?.verifiedBy ?? null,
        verifiedAt: qaCheck?.verifiedAt ?? null,
      };
    }),
    technicalNotes,
    risks,
    refined,
    sourceCommentId: sourceComment?.id ?? null,
  };
}

function isTechnicalLead(
  comment: ProjectIssueCommentSnapshot,
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>
): boolean {
  return Boolean(
    comment.authorAgentId &&
      agents.some((agent) => agent.id === comment.authorAgentId && agent.role === 'technical_lead')
  );
}

interface QaCheck {
  met: boolean;
  verifiedBy: string;
  verifiedAt: string;
}

function qaChecksForCriteria(
  acceptanceTexts: string[],
  comments: ProjectIssueCommentSnapshot[],
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>
): Array<QaCheck | null> {
  const checks: Array<QaCheck | null> = acceptanceTexts.map(() => null);

  for (const comment of comments) {
    if (!isQaEngineer(comment, agents) || !comment.authorAgentId) continue;

    const entries = checklistEntries(comment.body);
    const isCompleteChecklist =
      entries.length === acceptanceTexts.length &&
      entries.filter((entry, index) => checklistMatches(acceptanceTexts[index], entry.text)).length >=
        Math.max(1, acceptanceTexts.length - 1);

    if (isCompleteChecklist) {
      entries.forEach((entry, index) => {
        checks[index] = {
          met: entry.met,
          verifiedBy: comment.authorAgentId!,
          verifiedAt: toIso(comment.createdAt),
        };
      });
      continue;
    }

    for (const entry of entries) {
      const criterionIndex = acceptanceTexts.findIndex((criterion) => checklistMatches(criterion, entry.text));
      if (criterionIndex === -1) continue;

      checks[criterionIndex] = {
        met: entry.met,
        verifiedBy: comment.authorAgentId,
        verifiedAt: toIso(comment.createdAt),
      };
    }
  }

  return checks;
}

function isQaEngineer(
  comment: ProjectIssueCommentSnapshot,
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>
): boolean {
  return Boolean(
    comment.authorAgentId &&
      agents.some((agent) => agent.id === comment.authorAgentId && agent.role === 'qa_engineer')
  );
}

function checklistEntries(body: string): Array<{ text: string; met: boolean }> {
  return body.split('\n').flatMap((line) => {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (match?.[2].trim()) {
      return [{ text: match[2].trim(), met: match[1].toLowerCase() === 'x' }];
    }

    const numberedEmojiMatch = line.match(
      /^\s*(?:\*\*)?(?:(?:ac|criterion|kriterium)\s*)?\d+\s*[.:)\-]\s*(.+?)(?:\*\*)?\s*(✅|❌)\s*$/iu
    );
    if (!numberedEmojiMatch?.[1].trim()) return [];
    return [{
      text: numberedEmojiMatch[1].replace(/\*\*/g, '').trim(),
      met: numberedEmojiMatch[2] === '✅',
    }];
  });
}

function checklistMatches(criterion: string, checklistText: string): boolean {
  const criterionTokens = meaningfulTokens(criterion);
  const checklistTokens = meaningfulTokens(checklistText);
  if (criterionTokens.length === 0 || checklistTokens.length === 0) return false;

  const criterionKey = criterionTokens.join(' ');
  const checklistKey = checklistTokens.join(' ');
  if (criterionKey.includes(checklistKey) || checklistKey.includes(criterionKey)) return true;

  const checklistSet = new Set(checklistTokens);
  const overlap = criterionTokens.filter((token) => checklistSet.has(token)).length;
  return overlap >= 2 && overlap / Math.min(criterionTokens.length, checklistTokens.length) >= 0.6;
}

function meaningfulTokens(value: string): string[] {
  const ignored = new Set([
    'alle', 'all', 'and', 'die', 'der', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'für', 'for',
    'mit', 'the', 'und', 'von', 'im', 'in', 'is', 'are', 'works', 'work', 'verified', 'erfüllt',
  ]);
  const normalized = value
    .replace(/\[[^\]]*\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, ' ')
    .split(/\s(?:—|–|-)\s/)[0]
    .replace(/^\s*(?:ac|criterion|kriterium)\s*\d+\s*[:.-]?\s*/i, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return normalized
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !ignored.has(token));
}

function isDecisionPayload(payload: DecisionPayload): payload is ValidDecisionPayload {
  return (
    typeof payload.type === 'string' &&
    DECISION_TYPES.has(payload.type as DecisionType) &&
    typeof payload.description === 'string' &&
    payload.description.trim().length > 0 &&
    typeof payload.reasoning === 'string' &&
    payload.reasoning.trim().length > 0
  );
}

function isRefinementPayload(payload: RefinementPayload): boolean {
  return parseStoryPoints(payload.storyPoints) > 0;
}

function parseStoryPoints(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 && number <= 100 ? number : 0;
}

function parseCriteria(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

function parseText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseRisks(issueId: string, value: unknown, raisedBy: string | null): TicketRisk[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const risk = entry as { description?: unknown; severity?: unknown; mitigation?: unknown };
    if (typeof risk.description !== 'string' || !risk.description.trim()) return [];
    const severity = risk.severity === 'low' || risk.severity === 'medium' || risk.severity === 'high'
      ? risk.severity
      : 'medium';

    return [{
      id: `host-risk:${issueId}:${index}`,
      description: risk.description.trim(),
      severity,
      mitigation: parseText(risk.mitigation),
      raisedBy,
      raisedAt: new Date(0).toISOString(),
    }];
  });
}

function findStoryPoints(description: string, comments: ProjectIssueCommentSnapshot[]): number {
  const sources = [description, ...comments.map((comment) => comment.body)].reverse();
  for (const source of sources) {
    const normalized = source.replace(/\*+/g, '');
    const match = normalized.match(/\b(?:story\s*points?|aufwand|schätzung|schaetzung)\s*:\s*(\d{1,3})\b/i);
    const storyPoints = parseStoryPoints(match?.[1]);
    if (storyPoints > 0) return storyPoints;
  }
  return 0;
}

function extractChecklist(description: string): string[] {
  const section = extractSection(description, ['Akzeptanzkriterien', 'Acceptance Criteria']);
  if (!section) return [];

  return section
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^\s*[-*]\s+\[[ xX]\]\s+(.+)$/);
      return match?.[1]?.trim() ? [match[1].trim()] : [];
    });
}

function extractSection(markdown: string, headings: string[]): string | null {
  const lines = markdown.split('\n');
  const headingIndex = lines.findIndex((line) => {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    return match ? headings.some((heading) => match[1].toLocaleLowerCase() === heading.toLocaleLowerCase()) : false;
  });
  if (headingIndex === -1) return null;

  const content: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (/^#{1,6}\s+/.test(line)) break;
    content.push(line);
  }
  const result = content.join('\n').trim();
  return result || null;
}

function lastMarkerPayload<T>(body: string, marker: string): T | null {
  const expression = new RegExp(`<!--\\s*${escapeRegExp(marker)}\\s+([\\s\\S]*?)\\s*-->`, 'g');
  let result: T | null = null;
  for (const match of body.matchAll(expression)) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      if (typeof parsed === 'object' && parsed !== null) result = parsed as T;
    } catch {
      // A malformed marker is non-authoritative and must never alter board data.
    }
  }
  return result;
}

function markerPayloads<T>(body: string, marker: string): T[] {
  const expression = new RegExp(`<!--\\s*${escapeRegExp(marker)}\\s+([\\s\\S]*?)\\s*-->`, 'g');
  const payloads: T[] = [];
  for (const match of body.matchAll(expression)) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      if (typeof parsed === 'object' && parsed !== null) payloads.push(parsed as T);
    } catch {
      // A malformed marker is non-authoritative and must never alter board data.
    }
  }
  return payloads;
}

function parseCommitSha(value: unknown): string | null {
  const sha = parseText(value);
  return sha && /^[0-9a-f]{7,64}$/i.test(sha) ? sha.toLowerCase() : null;
}

function parseGitHubCommitUrl(value: unknown): string | null {
  const url = parseText(value);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === 'github.com' &&
      /^\/[^/]+\/[^/]+\/commit\/[0-9a-f]{7,64}$/i.test(parsed.pathname)
    )
      ? url
      : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toIso(value: HostTimestamp): string {
  return value instanceof Date ? value.toISOString() : value;
}