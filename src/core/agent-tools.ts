/**
 * Strukturierte Eingaben der Agenten.
 *
 * Der gesamte Ablauf haengt daran, dass ein Modell HTML-Kommentare mit gueltigem
 * JSON von Hand tippt. Ein fehlendes Anfuehrungszeichen liess ein Ticket bisher
 * dauerhaft ungeplant liegen. Ein Tool-Aufruf ist demgegenueber schemavalidiert:
 * der Host lehnt eine falsche Eingabe ab, bevor sie das Board erreicht.
 *
 * Das Speicherformat bleibt bewusst der Marker. Das Tool ist ein zusaetzlicher,
 * verlaesslicher *Eingabeweg* — kein zweites Datenmodell. Bestehende Tickets,
 * Projektion und Tests bleiben dadurch unberuehrt, und ein Agent, der weiterhin
 * von Hand schreibt, funktioniert unveraendert.
 */

import { COMMIT_MARKER, REFINEMENT_MARKER } from './project-issue-projection';
import {
  PRODUCT_DECISION_REQUIRED_MARKER,
  QA_REVIEW_APPROVED_MARKER,
  QA_REVIEW_REJECTED_MARKER,
} from './review-routing';

export const SUBMIT_REFINEMENT_TOOL = 'submit_refinement';
export const SUBMIT_QA_VERDICT_TOOL = 'submit_qa_verdict';
export const RECORD_COMMIT_TOOL = 'record_commit';
export const SUBMIT_FOR_REVIEW_TOOL = 'submit_for_review';

export interface ReviewSubmissionInput {
  summary: string;
  commit: CommitInput | null;
  testNotes: string | null;
  productDecisionRequired: boolean;
}

/**
 * Prueft eine Uebergabe an das Review.
 *
 * Der Commit-Nachweis ist Teil derselben Uebergabe, nicht ein zweiter Schritt:
 * ein Ticket ohne ihn faellt in der Done-Pruefung ohnehin wieder zurueck.
 */
export function validateReviewSubmission(input: unknown): ToolValidation<ReviewSubmissionInput> {
  const record = asRecord(input);
  const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
  if (!summary) {
    return { ok: false, error: 'summary must describe what was implemented.' };
  }

  let commit: CommitInput | null = null;
  if (record.commit !== undefined && record.commit !== null) {
    const parsed = validateCommit(record.commit);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    commit = parsed.value;
  }

  return {
    ok: true,
    value: {
      summary,
      commit,
      testNotes: typeof record.testNotes === 'string' && record.testNotes.trim()
        ? record.testNotes.trim()
        : null,
      productDecisionRequired: record.productDecisionRequired === true,
    },
  };
}

/** Baut den Ready-for-Review-Kommentar samt Commit-Nachweis. */
export function reviewSubmissionComment(input: ReviewSubmissionInput): string {
  return [
    '## Ready for Review',
    input.summary,
    input.testNotes ? `### Test notes for QA\n\n${input.testNotes}` : null,
    input.commit ? `### Delivered commit\n\n\`${input.commit.sha}\` ${input.commit.message}` : null,
    input.commit ? `<!-- ${COMMIT_MARKER} ${JSON.stringify(input.commit)} -->` : null,
    input.productDecisionRequired ? PRODUCT_DECISION_REQUIRED_MARKER : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

export interface RefinementInput {
  storyPoints: number;
  acceptanceCriteria: string[];
  technicalNotes?: string | null;
  risks?: Array<{ description: string; severity?: string; mitigation?: string | null }>;
  labels?: string[];
}

export interface QaVerdictInput {
  approved: boolean;
  criteria: Array<{ text: string; met: boolean }>;
  notes?: string | null;
}

export interface CommitInput {
  sha: string;
  url: string;
  message: string;
}

export type ToolValidation<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Prueft eine Refinement-Eingabe.
 *
 * Dieselben Grenzen wie die Projektion, nur frueher: was hier durchgeht, ist
 * danach garantiert als Refinement lesbar.
 */
export function validateRefinement(input: unknown): ToolValidation<RefinementInput> {
  const record = asRecord(input);
  const storyPoints = Number(record.storyPoints);
  if (!Number.isInteger(storyPoints) || storyPoints < 1 || storyPoints > 100) {
    return { ok: false, error: 'storyPoints must be a whole number between 1 and 100.' };
  }

  const acceptanceCriteria = asStringList(record.acceptanceCriteria);
  if (acceptanceCriteria.length === 0) {
    return { ok: false, error: 'acceptanceCriteria must contain at least one verifiable criterion.' };
  }

  const risks = Array.isArray(record.risks)
    ? record.risks.flatMap((entry) => {
        const risk = asRecord(entry);
        const description = typeof risk.description === 'string' ? risk.description.trim() : '';
        if (!description) return [];
        const severity =
          risk.severity === 'low' || risk.severity === 'medium' || risk.severity === 'high'
            ? risk.severity
            : 'medium';
        return [{
          description,
          severity,
          mitigation: typeof risk.mitigation === 'string' ? risk.mitigation.trim() : null,
        }];
      })
    : [];

  return {
    ok: true,
    value: {
      storyPoints,
      acceptanceCriteria,
      technicalNotes: typeof record.technicalNotes === 'string' && record.technicalNotes.trim()
        ? record.technicalNotes.trim()
        : null,
      risks,
      // Wie in der Projektion: klein geschrieben und ohne Wiederholungen. Sonst
      // zaehlt derselbe Begriff bei der Zuweisung doppelt.
      labels: [...new Set(asStringList(record.labels).map((label) => label.toLowerCase()))],
    },
  };
}

export function validateQaVerdict(input: unknown): ToolValidation<QaVerdictInput> {
  const record = asRecord(input);
  if (typeof record.approved !== 'boolean') {
    return { ok: false, error: 'approved must be true or false.' };
  }

  const criteria = Array.isArray(record.criteria)
    ? record.criteria.flatMap((entry) => {
        const criterion = asRecord(entry);
        const text = typeof criterion.text === 'string' ? criterion.text.trim() : '';
        if (!text) return [];
        return [{ text, met: criterion.met === true }];
      })
    : [];
  if (criteria.length === 0) {
    return { ok: false, error: 'criteria must list every acceptance criterion with its result.' };
  }
  // Eine Freigabe, in der ein Kriterium offen ist, waere ein Widerspruch — und
  // genau der Widerspruch, den die Done-Pruefung spaeter wieder aufmachen wuerde.
  if (record.approved === true && criteria.some((criterion) => !criterion.met)) {
    return { ok: false, error: 'Cannot approve while an acceptance criterion is still unmet.' };
  }

  return {
    ok: true,
    value: {
      approved: record.approved,
      criteria,
      notes: typeof record.notes === 'string' && record.notes.trim() ? record.notes.trim() : null,
    },
  };
}

export function validateCommit(input: unknown): ToolValidation<CommitInput> {
  const record = asRecord(input);
  const sha = typeof record.sha === 'string' ? record.sha.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{7,64}$/.test(sha)) {
    return { ok: false, error: 'sha must be a hexadecimal commit SHA.' };
  }

  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!isGitHubCommitUrl(url, sha)) {
    return { ok: false, error: 'url must be the https://github.com/<owner>/<repo>/commit/<sha> URL of this commit.' };
  }

  const message = typeof record.message === 'string' ? record.message.trim() : '';
  if (!message) return { ok: false, error: 'message must describe the commit.' };

  return { ok: true, value: { sha, url, message } };
}

/** Baut den Refinement-Kommentar, den die Projektion ohnehin erwartet. */
export function refinementComment(input: RefinementInput): string {
  const payload = {
    storyPoints: input.storyPoints,
    acceptanceCriteria: input.acceptanceCriteria,
    technicalNotes: input.technicalNotes ?? null,
    risks: input.risks ?? [],
    labels: input.labels ?? [],
  };

  return [
    '## Technical refinement',
    `**Estimate:** ${input.storyPoints} story points`,
    ['**Acceptance criteria:**', ...input.acceptanceCriteria.map((text) => `- [ ] ${text}`)].join('\n'),
    input.technicalNotes ? `**Technical notes:**\n${input.technicalNotes}` : null,
    `<!-- ${REFINEMENT_MARKER} ${JSON.stringify(payload)} -->`,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

/** Baut den QA-Kommentar inklusive Checkliste und Verdikt-Marker. */
export function qaVerdictComment(input: QaVerdictInput): string {
  const heading = input.approved ? '## QA approved' : '## Changes Requested';
  const checklist = input.criteria
    .map((criterion) => `- [${criterion.met ? 'x' : ' '}] ${criterion.text}`)
    .join('\n');

  return [
    heading,
    checklist,
    input.notes,
    input.approved ? QA_REVIEW_APPROVED_MARKER : QA_REVIEW_REJECTED_MARKER,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

/** Baut den Commit-Nachweis, den die Done-Pruefung verlangt. */
export function commitComment(input: CommitInput): string {
  return [
    '## Commit recorded',
    `\`${input.sha}\` ${input.message}`,
    `<!-- ${COMMIT_MARKER} ${JSON.stringify(input)} -->`,
  ].join('\n\n');
}

function isGitHubCommitUrl(url: string, sha: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === 'github.com' &&
      new RegExp(`^/[^/]+/[^/]+/commit/${sha}$`, 'i').test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
