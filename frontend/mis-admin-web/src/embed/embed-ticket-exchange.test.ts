import { describe, expect, it } from 'vitest';
import { ticketFingerprint } from './embed-ticket-exchange';

describe('embed-ticket-exchange', () => {
  it('ticketFingerprint 稳定且不含明文', () => {
    const ticket = '-6331871886887794391';
    const fp = ticketFingerprint(ticket);
    expect(fp).toMatch(/^[0-9a-f]+:\d+$/);
    expect(fp.includes(ticket)).toBe(false);
    expect(ticketFingerprint(ticket)).toBe(fp);
  });
});
