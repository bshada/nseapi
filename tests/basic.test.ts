import { describe, it, expect } from 'vitest';
import { NSE } from '../src';

describe('basic', () => {
  it('exports NSE', () => {
    expect(typeof NSE).toBe('function');
  });
});
