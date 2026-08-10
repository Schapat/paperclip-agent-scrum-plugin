/** Routing-Regeln für Reviews projektgebundener Paperclip-Issues. */

export const PRODUCT_DECISION_REQUIRED_MARKER = '<!-- agent-scrum:po-decision-required -->';
export const PRODUCT_DECISION_RESOLVED_MARKER = '<!-- agent-scrum:po-decision-resolved -->';
export const QA_REVIEW_APPROVED_MARKER = '<!-- agent-scrum:qa-review-approved -->';
export const QA_REVIEW_REJECTED_MARKER = '<!-- agent-scrum:qa-review-rejected -->';
export const QA_REWORK_ROUTED_MARKER = '## QA rework routed';
/** Titel der automatischen Sprint-Scope-Auflösung; zugleich ihre Wiedererkennung. */
export const SPRINT_SCOPE_RESOLUTION_MARKER = '<!-- agent-scrum:sprint-scope-resolution -->';

export type ProjectReviewOwner = 'qa_engineer' | 'product_owner';

export interface ProjectReviewIssue {
  status: string;
  description: string | null;
}

export interface ProjectReviewComment {
  body: string;
  authorAgentId?: string | null;
  createdAt?: Date | string;
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

  // Chronologisch sortieren, bevor Marker-Positionen verglichen werden. Ohne das
  // entscheidet die Rueckgabereihenfolge von `listComments`, ob eine bereits
  // dokumentierte Entscheidung als offen gilt — und der Worker beantwortet
  // dieselbe Frage endlos neu.
  const history = [
    issue.description ?? '',
    ...chronologicalComments(comments).map((comment) => comment.body),
  ];
  const lastRequired = lastMarkerIndex(history, PRODUCT_DECISION_REQUIRED_MARKER);
  const lastResolved = lastMarkerIndex(history, PRODUCT_DECISION_RESOLVED_MARKER);

  if (lastRequired > lastResolved) {
    return { role: 'product_owner', reason: 'product_decision' };
  }

  return { role: 'qa_engineer', reason: 'technical_review' };
}

/**
 * Hat der Worker die aktive Sprint-Freigabe fuer diese Review-Runde bereits
 * dokumentiert?
 *
 * Die Auflösung ist eine Feststellung, kein Vorgang: sie gehoert genau einmal
 * je offener Produktentscheidung ins Ticket. Ohne diese Pruefung beantwortet
 * jeder Durchlauf dieselbe Frage erneut — und jede Antwort loest den naechsten
 * Durchlauf aus.
 */
export function hasSprintScopeResolution(comments: ProjectReviewComment[]): boolean {
  const bodies = chronologicalComments(comments).map((comment) => comment.body);
  const lastRequired = lastMarkerIndex(bodies, PRODUCT_DECISION_REQUIRED_MARKER);
  const lastResolution = lastMarkerIndex(bodies, SPRINT_SCOPE_RESOLUTION_MARKER);

  return lastResolution > lastRequired;
}

/** Kommentare, die der Worker selbst erzeugt hat, duerfen ihn nicht erneut ausloesen. */
export function isPluginAuthoredNotice(body: string): boolean {
  return (
    body.includes(SPRINT_SCOPE_RESOLUTION_MARKER) ||
    PLUGIN_NOTICE_HEADINGS.some((heading) => body.trimStart().startsWith(heading))
  );
}

const PLUGIN_NOTICE_HEADINGS = [
  '## Sprint scope already approved',
  '## QA review required',
  '## QA rework routed',
  '## QA acceptance criteria verification required',
  '## GitHub commit evidence required',
  '## Sprint planning recovery',
  '## Blocker resolved',
  '## Human scope approval required',
  '## Technical refinement requested',
  '## Refinement needs a human decision',
];

/** A QA approval survives worker restarts because it is recorded on the host issue. */
export function hasQaReviewApproval(
  comments: ProjectReviewComment[],
  qaAgentId: string
): boolean {
  let approved = false;
  for (const comment of chronologicalComments(comments)) {
    if (isQaReviewRejection(comment, qaAgentId)) approved = false;
    if (comment.authorAgentId === qaAgentId && comment.body.includes(QA_REVIEW_APPROVED_MARKER)) {
      approved = true;
    }
  }
  return approved;
}

export function isQaReviewRejection(comment: ProjectReviewComment, qaAgentId: string): boolean {
  return (
    comment.authorAgentId === qaAgentId &&
    (comment.body.includes(QA_REVIEW_REJECTED_MARKER) || /^##\s*(?:❌\s*)?Changes Requested\b/im.test(comment.body))
  );
}

function chronologicalComments(comments: ProjectReviewComment[]): ProjectReviewComment[] {
  const entries = comments.map((comment, index) => ({
    comment,
    index,
    timestamp: Date.parse(String(comment.createdAt ?? '')),
  }));
  if (!entries.every((entry) => Number.isFinite(entry.timestamp))) return comments;

  return entries
    .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index)
    .map((entry) => entry.comment);
}

function lastMarkerIndex(entries: string[], marker: string): number {
  let result = -1;
  for (const [index, entry] of entries.entries()) {
    if (entry.includes(marker)) result = index;
  }
  return result;
}