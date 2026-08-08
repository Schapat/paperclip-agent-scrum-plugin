import { describe, expect, it } from 'vitest';

import {
  PRODUCT_DECISION_REQUIRED_MARKER,
  PRODUCT_DECISION_RESOLVED_MARKER,
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

  it('does not route tickets outside review', () => {
    expect(reviewOwnerForProjectIssue({ status: 'in_progress', description: null }, [])).toBeNull();
  });
});