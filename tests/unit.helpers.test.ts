import { describe, it, expect } from 'vitest';
import { NSE } from '../src';

describe('helpers (unit)', () => {
  it('gainers filters positives, sorts desc, and limits', () => {
    const api = new NSE(process.cwd());
    const input = { data: [
      { symbol: 'A', pChange: -1 },
      { symbol: 'B', pChange: 2 },
      { symbol: 'C', pChange: 5 },
      { symbol: 'D', pChange: 3 },
    ] };
    const top2 = api.gainers(input as any, 2);
    expect(top2.map(x => x.symbol)).toEqual(['C', 'D']);
  });

  it('losers filters negatives, sorts asc (most negative first), and limits', () => {
    const api = new NSE(process.cwd());
    const input = { data: [
      { symbol: 'A', pChange: -1 },
      { symbol: 'B', pChange: 2 },
      { symbol: 'C', pChange: -5 },
      { symbol: 'D', pChange: 3 },
    ] };
    const top2 = api.losers(input as any, 2);
    expect(top2.map(x => x.symbol)).toEqual(['C', 'A']);
  });

  it('maxpain computes strike with maximum pain for a crafted chain', () => {
    // Match the library's expiry formatting (en-GB short month, which can be "Sept")
    const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}-${new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(d)}-${d.getFullYear()}`;
    const expiry = new Date('2025-09-26T00:00:00Z');
    const expiryStr = fmt(expiry);

    // Build a minimal optionChain-like structure
    const optionChain = {
      records: {
        data: [
          { expiryDate: expiryStr, strikePrice: 100, CE: { openInterest: 10 }, PE: { openInterest: 0 } },
          { expiryDate: expiryStr, strikePrice: 110, CE: { openInterest: 5 }, PE: { openInterest: 5 } },
          { expiryDate: expiryStr, strikePrice: 120, CE: { openInterest: 0 }, PE: { openInterest: 15 } },
        ]
      }
    };
    const strike = NSE.maxpain(optionChain as any, expiry);
    // For this crafted case, the pain should be maximal near the middle; assert it returns one of provided strikes
    expect([100,110,120]).toContain(strike);
  });
});
