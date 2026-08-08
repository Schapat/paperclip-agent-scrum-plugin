/** Routing-Regeln für Reviews projektgebundener Paperclip-Issues. */

export const PRODUCT_DECISION_REQUIRED_MARKER = '<!-- agent-scrum:po-decision-required -->';
export const PRODUCT_DECISION_RESOLVED_MARKER = '<!-- agent-scrum:po-decision-resolved -->';
export const QA_REVIEW_APPROVED_MARKER = '<!-- agent-scrum:qa-review-approved -->';

export type ProjectReviewOwner = 'qa_engineer' | 'product_owner';

export interface ProjectReviewIssue {
  status: string;
  description: string | null;
}

export interface ProjectReviewComment {
  body: string;
  authorAgentId?: string | null;
}

export interface ProjectReviewRoute {
  role: ProjectReviewOwner;
  reason: 'technical_review' | 'product_decision';
}

/**
 * QA prüft standardmäßig jedes technische Review. Ein Developer kann eine
 * Produktentscheidung ausdrücklich anfordern; nach der dokumentierten
 * Entscheidung geht der Review automatisch zurück an QA.
 */
export function reviewOwnerForProjectIssue(
  issue: ProjectReviewIssue,
  comments: ProjectReviewComment[]
): ProjectReviewRoute | null {
  if (issue.status !== 'in_review') return null;

  const history = [issue.description ?? '', ...comments.map((comment) => comment.body)];
  const lastRequired = lastMarkerIndex(history, PRODUCT_DECISION_REQUIRED_MARKER);
  const lastResolved = lastMarkerIndex(history, PRODUCT_DECISION_RESOLVED_MARKER);

  if (lastRequired > lastResolved) {
    return { role: 'product_owner', reason: 'product_decision' };
  }

  return { role: 'qa_engineer', reason: 'technical_review' };
}

/** A QA approval survives worker restarts because it is recorded on the host issue. */
export function hasQaReviewApproval(
  comments: ProjectReviewComment[],
  qaAgentId: string
): boolean {
  return comments.some(
    (comment) =>
      comment.authorAgentId === qaAgentId &&
      comment.body.includes(QA_REVIEW_APPROVED_MARKER)
  );
}

function lastMarkerIndex(entries: string[], marker: string): number {
  let result = -1;
  for (const [index, entry] of entries.entries()) {
    if (entry.includes(marker)) result = index;
  }
  return result;
}