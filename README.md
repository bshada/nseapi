# nseapi

TypeScript/JavaScript client for NSE India endpoints. 

- Fully typed API (see `dist/index.d.ts` after build)
- Works in Node.js (ESM and CJS builds)
- Handles NSE cookies automatically and persists them in the downloads folder

## Node-only
This library targets Node.js environments only. It relies on Node core modules like `fs`, `path`, and `zlib`, and performs file I/O for cookie persistence and report downloads. It is not intended for use in browsers.

## Installation

```bash
npm install @bshada/nseapi
# or
yarn add @bshada/nseapi
# or
pnpm add @bshada/nseapi
```

## Import and Initialize

```ts
// ESM / TypeScript
import { NSE } from '@bshada/nseapi';

// Create an instance with a download/cache folder (used for cookies and downloaded reports)
const nse = new NSE('./downloads', { server: false, timeout: 15000 });
```

```js
// CommonJS
const { NSE } = require('@bshada/nseapi');
const nse = new NSE('./downloads', { server: false, timeout: 15000 });
```

Notes:
- `server: true` uses HTTP/2 via `got`, which can be better in some environments. `server: false` uses `axios`.
- Cookies are stored under the provided folder as `nse_cookies_http1.json` or `nse_cookies_http2.json`.

## Usage Examples

```ts
import { NSE } from '@bshada/nseapi';

const nse = new NSE('./downloads');

// Market status
const status = await nse.status();
console.log('Market state:', status);

// Fetch current IPOs
const currentIpo = await nse.listCurrentIPO();
console.log('Current IPOs:', currentIpo);

// Equity quote
const quote = await nse.equityQuote('HDFCBANK');
console.log('HDFCBANK quote:', quote);
```

## Quick Start

```ts
const status = await nse.status();
console.log('Market state:', status);
```

## Scripts
- `npm run build` — Build ESM to `dist/` and CJS to `dist-cjs/`

## API Reference
The full list of methods is available in the `NSE` class under `src/nse/NSE.ts`. A summary is below. See inline JSDoc and `README.md` in the original repo for detailed examples.

- Market and Search: `status()`, `lookup()`
- Daily Files: `equityBhavcopy()`, `deliveryBhavcopy()`, `indicesBhavcopy()`, `fnoBhavcopy()`, `priceband_report()`, `pr_bhavcopy()`, `cm_mii_security_report()`
- Corporate: `actions()`, `announcements()`, `boardMeetings()`, `annual_reports()`
- Quotes: `equityMetaInfo()`, `quote()`, `equityQuote()`
- Listings/Indices: `listEquityStocksByIndex()`, `listIndices()`, `listEtf()`, `listSme()`, `listSgb()`
- IPO: `listCurrentIPO()`, `listUpcomingIPO()`, `listPastIPO()`
- Circulars/Deals: `circulars()`, `blockDeals()`
- F&O Utilities: `fnoLots()`, `optionChain()`, `getFuturesExpiry()`, `compileOptionChain()`, `NSE.maxpain()`
- Historical: `fetch_equity_historical_data()`, `fetch_historical_vix_data()`, `fetch_historical_fno_data()`, `fetch_historical_index_data()`
- Reference Data: `fetch_fno_underlying()`, `fetch_index_names()`, `fetch_daily_reports_file_metadata()`

## Requirements
- Node.js >= 18

## License
MIT
