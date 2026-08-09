import { describe, expect, it } from 'vitest';

import { descriptionWithoutAcceptanceCriteria } from '../ticket-description';

describe('descriptionWithoutAcceptanceCriteria', () => {
  it('keeps the ticket context while removing the acceptance criteria duplicated below it', () => {
    const description = [
      '## User Story',
      'As a visitor, I want to switch themes.',
      '',
      '## Akzeptanzkriterien',
      '- [ ] A visible theme toggle exists',
      '- [ ] The toggle has an accessible label',
      '',
      '## Wert',
      'Visitors can adapt the screen to their environment.',
    ].join('\n');

    expect(descriptionWithoutAcceptanceCriteria(description)).toBe([
      '## User Story',
      'As a visitor, I want to switch themes.',
      '',
      '## Wert',
      'Visitors can adapt the screen to their environment.',
    ].join('\n'));
  });
});