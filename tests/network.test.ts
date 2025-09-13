import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NSE } from '../src';

const NETWORK = process.env.NSEAPI_NETWORK === '1';

// Only run these tests when explicitly enabled to avoid flakiness in CI.
(NETWORK ? describe : describe.skip)('network', () => {
  function tmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nseapi-'));
    return dir;
  }

  it('fetches market status', async () => {
    const dir = tmpDir();
    const nse = new NSE(dir, { server: false, timeout: 20000 });
    const status = await nse.status();
    expect(status).toBeTruthy();
    nse.exit();
  });

  it('looks up a known symbol', async () => {
    const dir = tmpDir();
    const nse = new NSE(dir, { server: false, timeout: 20000 });
    const results = await nse.lookup('INFY');
    expect(results).toBeTruthy();
    // Autocomplete endpoint returns an object; try common array fields, otherwise allow array
    const list = Array.isArray(results)
      ? results
      : (results as any)?.symbols ?? (results as any)?.items ?? (results as any)?.data ?? (results as any)?.searchdata ?? [];
    expect(Array.isArray(list)).toBe(true);
    if ((list as any[]).length > 0) {
      expect(typeof (list as any[])[0]).toBe('object');
    }
    nse.exit();
  });
});
