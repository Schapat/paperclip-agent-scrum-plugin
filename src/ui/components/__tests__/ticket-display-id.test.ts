import { describe, expect, it } from 'vitest';

import { ticketDisplayId } from '../ticket-display-id';

describe('ticketDisplayId', () => {
  it('prefers the human-readable Paperclip ticket identifier', () => {
    expect(ticketDisplayId({ id: '80e04576-33db-4fb4-b6ea-640ddd48be4a', identifier: 'TES-42' })).toBe('TES-42');
  });

  it('falls back to a short internal ID for local-only tickets', () => {
    expect(ticketDisplayId({ id: '80e04576-33db-4fb4-b6ea-640ddd48be4a', identifier: null })).toBe('#80e04576');
  });
});