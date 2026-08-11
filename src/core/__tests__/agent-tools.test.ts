import { describe, expect, it } from 'vitest';

import {
  commitComment,
  qaVerdictComment,
  refinementComment,
  reviewSubmissionComment,
  validateRefinementBatch,
  validateCommit,
  validateReviewSubmission,
  validateQaVerdict,
  validateRefinement,
} from '../agent-tools';
import { projectIssueProjection } from '../project-issue-projection';

const TECHNICAL_LEAD = { id: 'tl-1', name: 'Technical Lead', role: 'technical_lead' };
const QA = { id: 'qa-1', name: 'QA Engineer', role: 'qa_engineer' };
const DEVELOPER = { id: 'dev-1', name: 'Developer 1', role: 'developer' };

function comment(body: string, authorAgentId: string) {
  return {
    id: `comment-${authorAgentId}`,
    authorAgentId,
    authorUserId: null,
    authorType: 'agent',
    body,
    createdAt: '2026-08-10T12:00:00.000Z',
  };
}

describe('refinement tool input', () => {
  it('rejects what the projection could not have read anyway', () => {
    expect(validateRefinement({ storyPoints: 0, acceptanceCriteria: ['a'] })).toMatchObject({ ok: false });
    expect(validateRefinement({ storyPoints: 2.5, acceptanceCriteria: ['a'] })).toMatchObject({ ok: false });
    expect(validateRefinement({ storyPoints: 5, acceptanceCriteria: [] })).toMatchObject({ ok: false });
    expect(validateRefinement({ storyPoints: 5 })).toMatchObject({ ok: false });
  });

  it('accepts a complete refinement and normalises its labels', () => {
    const parsed = validateRefinement({
      storyPoints: 5,
      acceptanceCriteria: ['  Keyboard navigation works  '],
      labels: ['Testing', 'testing', ' React '],
      risks: [{ description: 'Legacy CSS', severity: 'nonsense' }],
    });

    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.acceptanceCriteria).toEqual(['Keyboard navigation works']);
    expect(parsed.value.labels).toEqual(['testing', 'react']);
    expect(parsed.value.risks?.[0]).toMatchObject({ severity: 'medium' });
  });

  /**
   * Der eigentliche Zweck des Tools: was es erzeugt, muss die Projektion lesen
   * koennen. Sonst waere es nur ein zweiter Weg, dasselbe falsch zu machen.
   */
  it('produces a comment the projection reads back as a valid refinement', () => {
    const parsed = validateRefinement({
      storyPoints: 8,
      acceptanceCriteria: ['Dark mode covers every section', 'Contrast passes AA'],
      technicalNotes: 'Reuse the existing theme tokens.',
      labels: ['css'],
    });
    if (!parsed.ok) throw new Error(parsed.error);

    const projection = projectIssueProjection({
      issueId: 'issue-1',
      description: null,
      comments: [comment(refinementComment(parsed.value), TECHNICAL_LEAD.id)],
      agents: [TECHNICAL_LEAD],
    });

    expect(projection.refinement).toMatchObject({
      refined: true,
      storyPoints: 8,
      technicalNotes: 'Reuse the existing theme tokens.',
      labels: ['css'],
    });
    expect(projection.refinement.acceptanceCriteria).toHaveLength(2);
  });
});

describe('refinement batch tool input', () => {
  it('rejects an empty or duplicate batch before any marker can be written', () => {
    expect(validateRefinementBatch({ refinements: [] })).toMatchObject({ ok: false });
    expect(validateRefinementBatch({
      refinements: [
        { issueId: 'issue-1', storyPoints: 3, acceptanceCriteria: ['Works'] },
        { issueId: 'issue-1', storyPoints: 5, acceptanceCriteria: ['Also works'] },
      ],
    })).toMatchObject({ ok: false });
  });

  it('validates every ticket with the same refinement rules as the single-ticket tool', () => {
    const batch = validateRefinementBatch({
      refinements: [
        { issueId: 'issue-1', storyPoints: 3, acceptanceCriteria: ['Markup works'] },
        { issueId: 'issue-2', storyPoints: 5, acceptanceCriteria: ['Controls work'], labels: ['React'] },
      ],
    });

    expect(batch).toMatchObject({ ok: true });
    if (!batch.ok) return;
    expect(batch.value.refinements).toHaveLength(2);
    expect(batch.value.refinements[1]).toMatchObject({ issueId: 'issue-2', refinement: { labels: ['react'] } });
  });
});

describe('QA verdict tool input', () => {
  it('refuses an approval that contradicts its own checklist', () => {
    const parsed = validateQaVerdict({
      approved: true,
      criteria: [{ text: 'Contrast passes AA', met: false }],
    });

    expect(parsed).toMatchObject({ ok: false });
  });

  it('requires the criteria it is meant to verify', () => {
    expect(validateQaVerdict({ approved: false, criteria: [] })).toMatchObject({ ok: false });
    expect(validateQaVerdict({ criteria: [{ text: 'a', met: true }] })).toMatchObject({ ok: false });
  });

  it('produces an approval the projection accepts as verified', () => {
    const parsed = validateQaVerdict({
      approved: true,
      criteria: [
        { text: 'Dark mode covers every section', met: true },
        { text: 'Contrast passes AA', met: true },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.error);

    const refinement = validateRefinement({
      storyPoints: 8,
      acceptanceCriteria: ['Dark mode covers every section', 'Contrast passes AA'],
    });
    if (!refinement.ok) throw new Error(refinement.error);

    const projection = projectIssueProjection({
      issueId: 'issue-1',
      description: null,
      comments: [
        comment(refinementComment(refinement.value), TECHNICAL_LEAD.id),
        { ...comment(qaVerdictComment(parsed.value), QA.id), createdAt: '2026-08-10T13:00:00.000Z' },
      ],
      agents: [TECHNICAL_LEAD, QA],
    });

    expect(projection.refinement.acceptanceCriteria.every((criterion) => criterion.met)).toBe(true);
  });
});

describe('commit tool input', () => {
  it('rejects a URL that does not match its own SHA', () => {
    expect(
      validateCommit({
        sha: 'a1b2c3d4e5f6',
        url: 'https://github.com/example/site/commit/deadbeef',
        message: 'feat: x',
      })
    ).toMatchObject({ ok: false });
  });

  it('rejects a non-GitHub host', () => {
    expect(
      validateCommit({
        sha: 'a1b2c3d4e5f6',
        url: 'https://gitlab.com/example/site/commit/a1b2c3d4e5f6',
        message: 'feat: x',
      })
    ).toMatchObject({ ok: false });
  });

  it('produces evidence the projection accepts from a developer', () => {
    const parsed = validateCommit({
      sha: 'A1B2C3D4E5F6',
      url: 'https://github.com/example/site/commit/a1b2c3d4e5f6',
      message: 'feat: dark mode',
    });
    if (!parsed.ok) throw new Error(parsed.error);

    const projection = projectIssueProjection({
      issueId: 'issue-1',
      description: null,
      comments: [comment(commitComment(parsed.value), DEVELOPER.id)],
      agents: [DEVELOPER],
    });

    expect(projection.commits).toHaveLength(1);
    expect(projection.commits[0]).toMatchObject({ sha: 'a1b2c3d4e5f6' });
  });
});

/**
 * Die Uebergabe an QA.
 *
 * Ein Developer patchte den Status selbst nach `in_review`, der Host lehnte ab
 * ("no review path"), und der Agent baute sich daraufhin eine Confirmation, die
 * auf einen menschlichen Klick wartete statt auf QA. Das Ticket stand still,
 * obwohl die Arbeit fertig war.
 */
describe('review submission tool input', () => {
  it('requires a summary QA can act on', () => {
    expect(validateReviewSubmission({})).toMatchObject({ ok: false });
    expect(validateReviewSubmission({ summary: '   ' })).toMatchObject({ ok: false });
  });

  it('rejects a commit that does not match its own URL', () => {
    expect(
      validateReviewSubmission({
        summary: 'Fixed the lint errors.',
        commit: {
          sha: 'a1b2c3d4e5f6',
          url: 'https://github.com/example/site/commit/deadbeef',
          message: 'fix: lint',
        },
      })
    ).toMatchObject({ ok: false });
  });

  it('carries the commit evidence the done gate later demands', () => {
    const parsed = validateReviewSubmission({
      summary: 'Escaped the quotes and replaced img with Image.',
      testNotes: 'Run npm run lint.',
      commit: {
        sha: '1e8e7490657ee5802eaaff9b9e9581c41a8055df',
        url: 'https://github.com/Schapat/Wiebusch-Website/commit/1e8e7490657ee5802eaaff9b9e9581c41a8055df',
        message: 'fix(lint): resolve ESLint errors',
      },
    });
    if (!parsed.ok) throw new Error(parsed.error);

    const projection = projectIssueProjection({
      issueId: 'issue-1',
      description: null,
      comments: [comment(reviewSubmissionComment(parsed.value), DEVELOPER.id)],
      agents: [DEVELOPER],
    });

    expect(projection.commits).toHaveLength(1);
    expect(projection.commits[0].sha).toBe('1e8e7490657ee5802eaaff9b9e9581c41a8055df');
  });

  it('routes to the Product Owner only when a product decision is declared', () => {
    const plain = validateReviewSubmission({ summary: 'Done.' });
    const decision = validateReviewSubmission({ summary: 'Done.', productDecisionRequired: true });
    if (!plain.ok || !decision.ok) throw new Error('expected both to validate');

    expect(reviewSubmissionComment(plain.value)).not.toContain('po-decision-required');
    expect(reviewSubmissionComment(decision.value)).toContain('po-decision-required');
  });
});
