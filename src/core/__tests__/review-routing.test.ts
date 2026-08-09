import { describe, expect, it } from 'vitest';

import {
  PRODUCT_DECISION_REQUIRED_MARKER,
  PRODUCT_DECISION_RESOLVED_MARKER,
  QA_REVIEW_APPROVED_MARKER,
  QA_REWORK_ROUTED_MARKER,
  hasQaReviewApproval,
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