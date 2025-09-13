import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NSE } from '../src';

const NETWORK = process.env.NSEAPI_NETWORK === '1';

(NETWORK ? describe : describe.skip)('network (broad coverage)', () => {
  const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nseapi-'));

  it('status()', async () => {
    const nse = new NSE(tmpDir(), { timeout: 20000 });
    const res = await nse.status();
    expect(res).toBeTruthy();
    nse.exit();
  });

  it('lookup()', async () => {
    const nse = new NSE(tmpDir(), { timeout: 20000 });
    const res = await nse.lookup('INFY');
    expect(res).toBeTruthy();
    nse.exit();
  });

  it('equityMetaInfo(), quote(), equityQuote()', async () => {
    const nse = new NSE(tmpDir(), { timeout: 20000 });
    const meta = await nse.equityMetaInfo('INFY');
    expect(meta).toBeTruthy();
    const q1 = await nse.quote({ symbol: 'INFY', type: 'equity' });
    expect(q1).toBeTruthy();
    const q2 = await nse.quote({ symbol: 'INFY', type: 'equity', section: 'trade_info' });
    expect(q2).toBeTruthy();
    const simple = await nse.equityQuote('INFY');
    expect(simple).toBeTruthy();
    nse.exit();
  });

  it('listEquityStocksByIndex(), listIndices(), listEtf(), listSme(), listSgb()', async () => {
    const nse = new NSE(tmpDir(), { timeout: 20000 });
    expect(await nse.listEquityStocksByIndex('NIFTY 50')).toBeTruthy();
    expect(await nse.listIndices()).toBeTruthy();
    expect(await nse.listEtf()).toBeTruthy();
    expect(await nse.listSme()).toBeTruthy();
    expect(await nse.listSgb()).toBeTruthy();
    nse.exit();
  });

  it('IPO listings: current, upcoming, past', async () => {
    const nse = new NSE(tmpDir(), { timeout: 20000 });
    expect(await nse.listCurrentIPO()).toBeTruthy();
    expect(await nse.listUpcomingIPO()).toBeTruthy();
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 86400000);
    expect(await nse.listPastIPO(from, to)).toBeTruthy();
    nse.exit();
  });

  it('circulars() and blockDeals()', async () => {
    const nse = new NSE(tmpDir(), { timeout: 20000 });
    expect(await nse.circulars()).toBeTruthy();
    expect(await nse.blockDeals()).toBeTruthy();
    nse.exit();
  });

  it('fnoLots()', async () => {
    const nse = new NSE(tmpDir(), { timeout: 20000 });
    const lots = await nse.fnoLots();
    expect(lots && typeof lots).toBe('object');
    nse.exit();
  });

  it('optionChain(), getFuturesExpiry(), compileOptionChain()', async () => {
    const nse = new NSE(tmpDir(), { timeout: 25000 });
    const chain = await nse.optionChain('NIFTY');
    expect(chain).toBeTruthy();

    const expiries = await nse.getFuturesExpiry('nifty');
    expect(Array.isArray(expiries)).toBe(true);
    if (expiries.length > 0) {
      // Expiries are like DD-MMM-YYYY; construct a Date object that matches
      const [dd, mmm, yyyy] = expiries[0].split('-');
      const expiryDate = new Date(`${dd} ${mmm} ${yyyy}`);
      const oc = await nse.compileOptionChain('NIFTY', expiryDate);
      expect(oc).toBeTruthy();
      expect(oc.chain).toBeTruthy();
    }
    nse.exit();
  });

  it('holidays()', async () => {
    const nse = new NSE(tmpDir(), { timeout: 20000 });
    expect(await nse.holidays('trading')).toBeTruthy();
    expect(await nse.holidays('clearing')).toBeTruthy();
    nse.exit();
  });

  it('historical: equity, vix, fno, index', async () => {
    const nse = new NSE(tmpDir(), { timeout: 25000 });
    const eq = await nse.fetch_equity_historical_data({ symbol: 'INFY' });
    expect(Array.isArray(eq)).toBe(true);

    const vix = await nse.fetch_historical_vix_data({ from_date: new Date(Date.now() - 7 * 86400000), to_date: new Date() });
    expect(Array.isArray(vix)).toBe(true);

    const fno = await nse.fetch_historical_fno_data({ symbol: 'NIFTY', instrument: 'FUTIDX', from_date: new Date(Date.now() - 7 * 86400000), to_date: new Date() });
    expect(Array.isArray(fno)).toBe(true);

    const idx = await nse.fetch_historical_index_data({ index: 'NIFTY 50', from_date: new Date(Date.now() - 7 * 86400000), to_date: new Date() });
    expect(idx && typeof idx).toBe('object');
    expect(Array.isArray(idx.price)).toBe(true);
    expect(Array.isArray(idx.turnover)).toBe(true);

    nse.exit();
  });

  it('underlyings, indices, daily report metadata', async () => {
    const nse = new NSE(tmpDir(), { timeout: 20000 });
    const under = await nse.fetch_fno_underlying();
    expect(under && typeof under).toBe('object');
    const names = await nse.fetch_index_names();
    expect(names && typeof names).toBe('object');
    const meta = await nse.fetch_daily_reports_file_metadata('CM');
    expect(meta).toBeTruthy();
    nse.exit();
  });
});
