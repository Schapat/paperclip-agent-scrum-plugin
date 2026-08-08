import { describe, expect, it } from 'vitest';

import { createScrumTask } from '../factories';
import {
  DECISION_MARKER,
  projectIssueProjection,
  projectProgress,
  REFINEMENT_MARKER,
} from '../project-issue-projection';

const agents = [
  { id: 'id-tl', name: 'Technical Lead', role: 'technical_lead' },
  { id: 'id-po', name: 'Product Owner', role: 'product_owner' },
];

describe('project issue projection', () => {
  it('maps host comments into the ticket detail timeline with resolved agent names', () => {
    const projection = projectIssueProjection({
      issueId: 'issue-slider',
      description: 'As a visitor, I want to browse images.',
      comments: [
        {
          id: 'comment-1',
          authorAgentId: 'id-tl',
          authorUserId: null,
          authorType: 'agent',
          body: 'Technical context recorded.',
          createdAt: '2026-08-09T10:00:00.000Z',
        },
      ],
      agents,
    });

    expect(projection.comments).toEqual([
      expect.objectContaining({
        id: 'comment-1',
        taskId: 'issue-slider',
        authorName: 'Technical Lead',
        authorRole: 'technical_lead',
        body: 'Technical context recorded.',
      }),
    ]);
  });

  it('projects a Technical Lead refinement marker into story points and ticket readiness fields', () => {
    const projection = projectIssueProjection({
      issueId: 'issue-slider',
      description: '## Akzeptanzkriterien\n- [ ] Fallback criterion',
      comments: [
        {
          id: 'comment-refinement',
          authorAgentId: 'id-tl',
          authorUserId: null,
          authorType: 'agent',
          createdAt: '2026-08-09T10:00:00.000Z',
          body:
            `## Technisches Refinement\n<!-- ${REFINEMENT_MARKER} ` +
            '{"storyPoints":5,"acceptanceCriteria":["Keyboard navigation works","Images have alternative text"],"technicalNotes":"Reuse the existing media primitives."} -->',
        },
      ],
      agents,
    });

    expect(projection.refinement).toMatchObject({
      storyPoints: 5,
      refined: true,
      technicalNotes: 'Reuse the existing media primitives.',
    });
    expect(projection.refinement?.acceptanceCriteria.map((criterion) => criterion.text)).toEqual([
      'Keyboard navigation works',
      'Images have alternative text',
    ]);
  });

  it('accepts a refinement marker only from the Technical Lead and only with acceptance criteria', () => {
    const untrusted = projectIssueProjection({
      issueId: 'issue-slider',
      description: '',
      comments: [
        {
          id: 'comment-po-refinement',
          authorAgentId: 'id-po',
          authorUserId: null,
          authorType: 'agent',
          createdAt: '2026-08-09T10:00:00.000Z',
          body: `<!-- ${REFINEMENT_MARKER} {"storyPoints":5,"acceptanceCriteria":["Keyboard navigation works"]} -->`,
        },
      ],
      agents,
    });
    const incomplete = projectIssueProjection({
      issueId: 'issue-slider',
      description: '',
      comments: [
        {
          id: 'comment-incomplete-refinement',
          authorAgentId: 'id-tl',
          authorUserId: null,
          authorType: 'agent',
          createdAt: '2026-08-09T10:01:00.000Z',
          body: `<!-- ${REFINEMENT_MARKER} {"storyPoints":5,"acceptanceCriteria":[]} -->`,
        },
      ],
      agents,
    });

    expect(untrusted.refinement).toMatchObject({ storyPoints: 0, refined: false });
    expect(incomplete.refinement).toMatchObject({ storyPoints: 5, refined: false });
  });

  it('projects structured agent decisions from host comments', () => {
    const projection = projectIssueProjection({
      issueId: 'issue-slider',
      description: '',
      comments: [
        {
          id: 'comment-decision',
          authorAgentId: 'id-po',
          authorUserId: null,
          authorType: 'agent',
          createdAt: '2026-08-09T10:00:00.000Z',
          body:
            `Decision recorded\n<!-- ${DECISION_MARKER} ` +
            '{"type":"priority_change","description":"Prioritized keyboard navigation","reasoning":"Accessibility is required for the first release."} -->',
        },
      ],
      agents,
    });

    expect(projection.decisions).toEqual([
      expect.objectContaining({
        taskId: 'issue-slider',
        type: 'priority_change',
        description: 'Prioritized keyboard navigation',
        reasoning: 'Accessibility is required for the first release.',
        madeByName: 'Product Owner',
      }),
    ]);
  });

  it('marks matching acceptance criteria as verified from a QA checklist comment', () => {
    const projection = projectIssueProjection({
      issueId: 'issue-slider',
      description: [
        '## Akzeptanzkriterien',
        '- [ ] Dark Mode Farbvarianten für alle bestehenden CSS-Variablen definiert',
        '- [ ] Keyboard navigation works',
      ].join('\n'),
      comments: [
        {
          id: 'comment-qa',
          authorAgentId: 'id-qa',
          authorUserId: null,
          authorType: 'agent',
          createdAt: '2026-08-09T10:00:00.000Z',
          body: [
            '## QA Abnahme',
            '- [x] **Dark Mode Farbvarianten** - all CSS variables verified',
            '- [x] Keyboard navigation works',
          ].join('\n'),
        },
      ],
      agents: [...agents, { id: 'id-qa', name: 'QA Engineer', role: 'qa_engineer' }],
    });

    expect(projection.refinement.acceptanceCriteria).toEqual([
      expect.objectContaining({
        text: 'Dark Mode Farbvarianten für alle bestehenden CSS-Variablen definiert',
        met: true,
        verifiedBy: 'id-qa',
      }),
      expect.objectContaining({ text: 'Keyboard navigation works', met: true, verifiedBy: 'id-qa' }),
    ]);
  });

  it('uses a complete QA checklist order when the checklist shortens a criterion heading', () => {
    const projection = projectIssueProjection({
      issueId: 'issue-slider',
      description: [
        '## Akzeptanzkriterien',
        '- [ ] Dark Mode Farbvarianten definiert',
        '- [ ] Markenidentität beibehalten',
        '- [ ] WCAG AA Kontrast erreicht',
        '- [ ] CSS-Variablen unter dem Dark-Selektor dokumentiert',
      ].join('\n'),
      comments: [
        {
          id: 'comment-qa-complete',
          authorAgentId: 'id-qa',
          authorUserId: null,
          authorType: 'agent',
          createdAt: '2026-08-09T10:00:00.000Z',
          body: [
            '## QA Abnahme',
            '- [x] Dark Mode Farbvarianten',
            '- [x] Markenidentität',
            '- [x] WCAG AA Kontrast',
            '- [x] Dokumentation - Kommentarblock geprüft',
          ].join('\n'),
        },
      ],
      agents: [...agents, { id: 'id-qa', name: 'QA Engineer', role: 'qa_engineer' }],
    });

    expect(projection.refinement.acceptanceCriteria).toHaveLength(4);
    expect(projection.refinement.acceptanceCriteria.every((criterion) => criterion.met)).toBe(true);
  });

  it('falls back to task completion when project stories are not estimated', () => {
    const tasks = [
      createScrumTask({ id: 'done', title: 'Done', description: '', column: 'done' }),
      createScrumTask({ id: 'todo', title: 'Todo', description: '', column: 'todo' }),
    ];

    expect(projectProgress(tasks)).toMatchObject({
      totalTasks: 2,
      doneTasks: 1,
      estimatedPoints: 0,
      completedPoints: 0,
      measure: 'tasks',
      percent: 50,
    });
  });

  it('uses story points when estimates are available', () => {
    const tasks = [
      createScrumTask({ id: 'done', title: 'Done', description: '', column: 'done', storyPoints: 3 }),
      createScrumTask({ id: 'todo', title: 'Todo', description: '', column: 'todo', storyPoints: 5 }),
    ];

    expect(projectProgress(tasks)).toMatchObject({
      totalTasks: 2,
      doneTasks: 1,
      estimatedPoints: 8,
      completedPoints: 3,
      measure: 'story_points',
      percent: 38,
    });
  });

  it('keeps task progress as the denominator until every project ticket is estimated', () => {
    const tasks = [
      createScrumTask({ id: 'done', title: 'Done', description: '', column: 'done', storyPoints: 5 }),
      createScrumTask({ id: 'todo', title: 'Todo', description: '', column: 'todo' }),
    ];

    expect(projectProgress(tasks)).toMatchObject({
      estimatedTasks: 1,
      measure: 'tasks',
      percent: 50,
    });
  });
});