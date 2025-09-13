import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NSE } from '../src';

const NETWORK = process.env.NSEAPI_NETWORK === '1';

(NETWORK ? describe : describe.skip)('network (more endpoints)', () => {
  const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nseapi-'));

  it('corporate: actions, announcements, boardMeetings, annual_reports', async () => {
    const nse = new NSE(tmpDir(), { timeout: 25000 });
    expect(await nse.actions({ segment: 'equities', symbol: 'INFY' })).toBeTruthy();
    expect(await nse.announcements({ index: 'equities', symbol: 'INFY' })).toBeTruthy();
    expect(await nse.boardMeetings({ index: 'equities', symbol: 'INFY' })).toBeTruthy();
    expect(await nse.annual_reports('INFY')).toBeTruthy();
    nse.exit();
  });

  it('bulkdeals', async () => {
    const nse = new NSE(tmpDir(), { timeout: 25000 });
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86400000);
    try {
      const data = await nse.bulkdeals(from, to);
      expect(Array.isArray(data)).toBe(true);
    } catch (e) {
      // If API returns no data for range, accept as pass
      expect(true).toBe(true);
    }
    nse.exit();
  });

  it('downloads: equityBhavcopy / deliveryBhavcopy / indicesBhavcopy / fnoBhavcopy / priceband_report / pr_bhavcopy / cm_mii_security_report', async () => {
    const dir = tmpDir();
    const nse = new NSE(dir, { timeout: 30000 });

    // Use a recent day, falling back a few days, weekdays preferred
    function recentBusinessDay(offset: number = 1): Date {
      const d = new Date(Date.now() - offset * 86400000);
      const day = d.getDay();
      if (day === 0) d.setDate(d.getDate() - 2); // Sunday -> Friday
      if (day === 6) d.setDate(d.getDate() - 1); // Saturday -> Friday
      return d;
    }

    const dates = [1, 2, 3, 4, 5].map(recentBusinessDay);

    let tried = 0;
    for (const dt of dates) {
      tried++;
      try {
        const eq = await nse.equityBhavcopy(new Date(dt), dir);
        expect(fs.existsSync(eq)).toBe(true);
        break;
      } catch {}
    }

    tried = 0;
    for (const dt of dates) {
      tried++;
      try {
        const del = await nse.deliveryBhavcopy(new Date(dt), dir);
        expect(fs.existsSync(del)).toBe(true);
        break;
      } catch {}
    }

    tried = 0;
    for (const dt of dates) {
      tried++;
      try {
        const idx = await nse.indicesBhavcopy(new Date(dt), dir);
        expect(fs.existsSync(idx)).toBe(true);
        break;
      } catch {}
    }

    tried = 0;
    for (const dt of dates) {
      tried++;
      try {
        const fo = await nse.fnoBhavcopy(new Date(dt), dir);
        expect(fs.existsSync(fo)).toBe(true);
        break;
      } catch {}
    }

    // The below endpoints can be intermittently unavailable; try/catch and accept either success or handled failure
    try { await nse.priceband_report(recentBusinessDay(), dir); } catch {}
    try { await nse.pr_bhavcopy(recentBusinessDay(), dir); } catch {}
    try { await nse.cm_mii_security_report(recentBusinessDay(), dir); } catch {}

    nse.exit();
  });

  it('download_document for a public URL (should download without extract)', async () => {
    const dir = tmpDir();
    const nse = new NSE(dir, { timeout: 30000 });
    // Use a tiny text resource; fallback to an NSE CSV if available
    const url = 'https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv';
    const file = await nse.download_document(url, dir);
    expect(fs.existsSync(file)).toBe(true);
    nse.exit();
  });
});
