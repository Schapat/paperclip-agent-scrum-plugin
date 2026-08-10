import { describe, expect, it } from 'vitest';

import {
  PRODUCT_DECISION_REQUIRED_MARKER,
  PRODUCT_DECISION_RESOLVED_MARKER,
  QA_REVIEW_APPROVED_MARKER,
  QA_REWORK_ROUTED_MARKER,
  SPRINT_SCOPE_RESOLUTION_MARKER,
  hasQaReviewApproval,
  hasSprintScopeResolution,
  isPluginAuthoredNotice,
  reviewOwnerForProjectIssue,
} from '../review-routing';

describe('project review routing', () => {
  it('routes technical review to QA by default', () => {
    expect(
      reviewOwnerForProjectIssue({ status: 'in_review', description: null }, [])
    ).toEqual({ role: 'qa_engineer', reason: 'technical_review' });
  });

  it('routes an unresolved product decision to the Product Owner', () => {
    expect(
      reviewOwnerForProjectIssue(
        { status: 'in_review', description: null },
        [{ body: `Decision needed\n${PRODUCT_DECISION_REQUIRED_MARKER}` }]
      )
    ).toEqual({ role: 'product_owner', reason: 'product_decision' });
  });

  it('returns a resolved product decision to QA', () => {
    expect(
      reviewOwnerForProjectIssue(
        { status: 'in_review', description: null },
        [
          { body: PRODUCT_DECISION_REQUIRED_MARKER },
          { body: `Decision recorded\n${PRODUCT_DECISION_RESOLVED_MARKER}` },
        ]
      )
    ).toEqual({ role: 'qa_engineer', reason: 'technical_review' });
  });

  it('keeps a final QA approval after a system rework route but invalidates it after QA rejection', () => {
    expect(
      hasQaReviewApproval(
        [
          { authorAgentId: 'qa-1', body: QA_REVIEW_APPROVED_MARKER },
          { authorAgentId: null, body: QA_REWORK_ROUTED_MARKER },
        ],
        'qa-1'
      )
    ).toBe(true);
    expect(
      hasQaReviewApproval(
        [
          { authorAgentId: 'qa-1', body: QA_REVIEW_APPROVED_MARKER },
          { authorAgentId: 'qa-1', body: '## ❌ Changes Requested' },
          { authorAgentId: 'qa-1', body: QA_REVIEW_APPROVED_MARKER },
        ],
        'qa-1'
      )
    ).toBe(true);
    expect(
      hasQaReviewApproval(
        [
          { authorAgentId: 'qa-1', body: QA_REVIEW_APPROVED_MARKER },
          { authorAgentId: 'qa-1', body: '## ❌ Changes Requested' },
        ],
        'qa-1'
      )
    ).toBe(false);
  });

  it('uses comment timestamps when the host returns a newer QA approval before older rework', () => {
    expect(
      hasQaReviewApproval(
        [
          {
            authorAgentId: 'qa-1',
            body: QA_REVIEW_APPROVED_MARKER,
            createdAt: '2026-08-09T17:56:14.000Z',
          },
          {
            authorAgentId: null,
            body: QA_REWORK_ROUTED_MARKER,
            createdAt: '2026-08-09T17:54:29.000Z',
          },
        ],
        'qa-1'
      )
    ).toBe(true);
  });

  it('does not route tickets outside review', () => {
    expect(reviewOwnerForProjectIssue({ status: 'in_progress', description: null }, [])).toBeNull();
  });
});
/**
 * Regressionen aus dem gemeldeten Kommentar-Sturm.
 *
 * Der Worker hat dieselbe Frage endlos neu beantwortet und jede Antwort als
 * Kommentar ins Ticket geschrieben. Diese Faelle halten die drei Ursachen fest.
 */
describe('routing must not re-decide a settled question', () => {
  it('honours the newest decision even when comments arrive out of order', () => {
    // `listComments` garantiert keine Reihenfolge. Vorher entschied die
    // Array-Position, ob eine dokumentierte Entscheidung als offen galt.
    const route = reviewOwnerForProjectIssue({ status: 'in_review', description: null }, [
      {
        body: `Decision recorded\n${PRODUCT_DECISION_RESOLVED_MARKER}`,
        createdAt: '2026-08-10T11:50:10.000Z',
      },
      {
        body: `Decision needed\n${PRODUCT_DECISION_REQUIRED_MARKER}`,
        createdAt: '2026-08-10T11:50:00.000Z',
      },
    ]);

    expect(route).toEqual({ role: 'qa_engineer', reason: 'technical_review' });
  });

  it('reports an already documented sprint-scope resolution', () => {
    const comments = [
      { body: PRODUCT_DECISION_REQUIRED_MARKER, createdAt: '2026-08-10T11:50:00.000Z' },
      {
        body: `## Sprint scope already approved\n\n${SPRINT_SCOPE_RESOLUTION_MARKER}`,
        createdAt: '2026-08-10T11:50:05.000Z',
      },
    ];

    expect(hasSprintScopeResolution(comments)).toBe(true);
  });

  it('treats a fresh product decision after a resolution as open again', () => {
    const comments = [
      {
        body: `## Sprint scope already approved\n\n${SPRINT_SCOPE_RESOLUTION_MARKER}`,
        createdAt: '2026-08-10T11:50:05.000Z',
      },
      { body: PRODUCT_DECISION_REQUIRED_MARKER, createdAt: '2026-08-10T12:10:00.000Z' },
    ];

    expect(hasSprintScopeResolution(comments)).toBe(false);
  });

  it('recognises its own notices so they cannot trigger the next round', () => {
    expect(
      isPluginAuthoredNotice(
        `## Sprint scope already approved\n\nThis decision is covered by the human-approved active sprint.`
      )
    ).toBe(true);
    expect(isPluginAuthoredNotice('## Ready for Review\n\nImplemented the slider.')).toBe(false);
  });
});
