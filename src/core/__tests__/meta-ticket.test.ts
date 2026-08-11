import { describe, expect, it } from 'vitest';

import { isAgentWorkOrderTicket } from '../meta-ticket';

/**
 * Ein Agent legt sich seinen eigenen Auftrag als Ticket an. Als Child des
 * Kickoffs zaehlt das als Story — verfeinert wird es aber nie, und der Sprint
 * blieb deshalb dauerhaft nicht startbar.
 */
describe('an agent work order posing as a story', () => {
  it('recognises the orders that actually appeared on the board', () => {
    expect(isAgentWorkOrderTicket({ title: 'Product Owner Backlog Discovery: Tetris' })).toBe(true);
    expect(isAgentWorkOrderTicket({ title: 'Watchdog: Board-Stau - alle Tickets blocked' })).toBe(true);
    expect(isAgentWorkOrderTicket({ title: 'Technical Lead Analysis' })).toBe(true);
    expect(isAgentWorkOrderTicket({ title: 'QA Review der Sprint-Tickets' })).toBe(true);
  });

  it('leaves a delivery story alone, whatever its title suggests', () => {
    expect(isAgentWorkOrderTicket({ title: 'Tetris Core Game Loop' })).toBe(false);
    expect(isAgentWorkOrderTicket({ title: 'Dark Mode: Theme-Toggle Labels internationalisieren' })).toBe(
      false
    );
    // "Review" kommt vor, aber nicht als Auftrag einer Rolle.
    expect(isAgentWorkOrderTicket({ title: 'Review-Seite für Produktbewertungen bauen' })).toBe(false);
  });

  it('treats a ticket with a user story as a story, even under a role-shaped title', () => {
    expect(
      isAgentWorkOrderTicket({
        title: 'Product Owner Dashboard: Review-Übersicht',
        description: '## User Story\n\nAls Product Owner möchte ich offene Reviews sehen…',
      })
    ).toBe(false);
  });

  it('does not fire on an empty or unrelated title', () => {
    expect(isAgentWorkOrderTicket({ title: '' })).toBe(false);
    expect(isAgentWorkOrderTicket({ title: 'Snake: Unit Tests (80% Coverage)' })).toBe(false);
  });
});
