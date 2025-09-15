import fs from "fs";
import path from "path";
import { promisify } from "util";
import zlib from "zlib";
import { pipeline as pipelineCb } from "stream";
import AdmZip from "adm-zip";
import axios, { AxiosInstance } from "axios";
import { wrapper as axiosCookieJarSupport } from "axios-cookiejar-support";
import got, { Got } from "got";
import { CookieJar } from "tough-cookie";

const pipeline = promisify(pipelineCb);

export type Literal<T extends string> = T;

export class NSE {
  static readonly __version__ = "0.1.0";

  static readonly SEGMENT_EQUITY = "equities" as const;
  static readonly SEGMENT_SME = "sme" as const;
  static readonly SEGMENT_MF = "mf" as const;
  static readonly SEGMENT_DEBT = "debt" as const;

  static readonly HOLIDAY_CLEARING = "clearing" as const;
  static readonly HOLIDAY_TRADING = "trading" as const;

  static readonly FNO_BANK = "banknifty" as const;
  static readonly FNO_NIFTY = "nifty" as const;
  static readonly FNO_FINNIFTY = "finnifty" as const;
  static readonly FNO_IT = "niftyit" as const;
  static readonly UDIFF_SWITCH_DATE = new Date("2024-07-08");

  private static readonly optionIndex = [
    NSE.FNO_BANK,
    NSE.FNO_NIFTY,
    NSE.FNO_FINNIFTY,
    NSE.FNO_IT,
  ] as const;

  private static readonly base_url = "https://www.nseindia.com/api";
  private static readonly archive_url = "https://nsearchives.nseindia.com";

  private dir: string;
  private server: boolean;
  private timeout: number;

  private axiosClient?: AxiosInstance;
  private gotClient?: Got;
  private jar: CookieJar;
  private cookiePath: string;
  private cookiesPrimed = false;

  constructor(download_folder: string, opts?: { server?: boolean; timeout?: number }) {
    const server = !!opts?.server;
    const timeout = opts?.timeout ?? 15000;

    const uAgent =
      "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/118.0";

    const headers = {
      "User-Agent": uAgent,
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate",
      Referer:
        "https://www.nseindia.com/get-quotes/equity?symbol=HDFCBANK",
    } as const;

    this.dir = NSE.getPath(download_folder, true);
    this.server = server;
    this.timeout = timeout;

    // Set up cookie jar and load from disk
    this.cookiePath = path.join(
      this.dir,
      server ? "nse_cookies_http2.json" : "nse_cookies_http1.json"
    );
    this.jar = new CookieJar();

    this.loadCookies();

    if (server) {
      // got with HTTP/2
      this.gotClient = got.extend({
        http2: true,
        headers,
        cookieJar: this.jar,
        timeout: { request: this.timeout },
        throwHttpErrors: false,
      });
    } else {
      // axios with cookie jar
      const ax = axios.create({
        headers,
        timeout: this.timeout,
        decompress: true,
        validateStatus: () => true,
      });
      axiosCookieJarSupport(ax);
      (ax as any).defaults.jar = this.jar;
      this.axiosClient = ax;
    }
  }

  // region lifecycle
  exit() {
    this.saveCookies();
  }

  // endregion

  // region cookie persistence
  private loadCookies() {
    if (!fs.existsSync(this.cookiePath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.cookiePath, "utf8"));
      this.jar = CookieJar.fromJSON(data);
    } catch {}
  }

  private saveCookies() {
    try {
      const json = this.jar.toJSON();
      fs.writeFileSync(this.cookiePath, JSON.stringify(json), "utf8");
    } catch {}
  }
  // endregion

  // region utils
  private static getPath(p: string, isFolder = false): string {
    const resolved = path.resolve(p);
    if (isFolder) {
      try {
        const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : undefined;
        if (stat && stat.isFile()) throw new Error(`${resolved}: must be a folder`);
        if (!stat) fs.mkdirSync(resolved, { recursive: true });
      } catch (e) {
        throw e;
      }
    }
    return resolved;
  }

  private async unzip(filePath: string, folder: string, extractFiles?: string[]) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".zip") {
      const zip = new AdmZip(filePath);
      if (extractFiles && extractFiles.length > 0) {
        zip.extractEntryTo(extractFiles[extractFiles.length - 1], folder, false, true);
        const out = path.join(folder, extractFiles[extractFiles.length - 1]);
        fs.rmSync(filePath, { force: true });
        return out;
      } else {
        const entries = zip.getEntries();
        if (!entries.length) throw new Error("Zip is empty");
        const first = entries[0].entryName;
        zip.extractAllTo(folder, true);
        const out = path.join(folder, first);
        fs.rmSync(filePath, { force: true });
        return out;
      }
    } else if (ext === ".gz") {
      const dest = path.join(path.dirname(filePath), path.basename(filePath, ".gz"));
      const gzip = zlib.createGunzip();
      await pipeline(fs.createReadStream(filePath), gzip, fs.createWriteStream(dest));
      fs.rmSync(filePath, { force: true });
      return dest;
    } else {
      throw new Error("Unknown file format");
    }
  }

  private async download(url: string, folder: string): Promise<string> {
    const fname = path.join(folder, path.basename(new URL(url).pathname));

    await this.primeCookies();

    if (this.server && this.gotClient) {
      const res = await this.gotClient.get(url, { responseType: "buffer" });
      const contentType = res.headers["content-type"];
      if (contentType && String(contentType).includes("text/html")) {
        throw new Error("NSE file is unavailable or not yet updated.");
      }
      fs.writeFileSync(fname, res.body as unknown as Buffer);
    } else if (this.axiosClient) {
      const res = await this.axiosClient.get(url, { responseType: "stream" });
      const contentType = res.headers["content-type"] as string | undefined;
      if (contentType && contentType.includes("text/html")) {
        throw new Error("NSE file is unavailable or not yet updated.");
      }
      await pipeline(res.data, fs.createWriteStream(fname));
    } else {
      throw new Error("HTTP client not initialized");
    }

    return fname;
  }

  private async req(url: string, params?: Record<string, unknown>) {
    await this.primeCookies();
    if (this.server && this.gotClient) {
      const res = await this.gotClient.get(url, {
        searchParams: params as unknown as Record<string, string | number | boolean | null | undefined>,
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`${url} ${res.statusCode}: ${res.statusMessage}`);
      }
      return JSON.parse(res.body as string);
    }

    if (this.axiosClient) {
      const res = await this.axiosClient.get(url, { params });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`${url} ${res.status}: ${res.statusText}`);
      }
      return res.data;
    }

    throw new Error("HTTP client not initialized");
  }
  // endregion

  private async primeCookies() {
    if (this.cookiesPrimed) return;
    const primeUrl = "https://www.nseindia.com/option-chain";
    try {
      if (this.server && this.gotClient) {
        await this.gotClient.get(primeUrl);
      } else if (this.axiosClient) {
        await this.axiosClient.get(primeUrl);
      }
      this.cookiesPrimed = true;
      this.saveCookies();
    } catch {
      // ignore priming failures; subsequent requests may still succeed
    }
  }

  // region Public API (subset; extend as needed)
  async status(): Promise<any[]> {
    return (await this.req(`${NSE.base_url}/marketStatus`)).marketState;
  }

  async lookup(query: string): Promise<Record<string, any>> {
    return await this.req(`${NSE.base_url}/search/autocomplete`, { q: query });
  }

  async equityBhavcopy(date: Date, folder?: string): Promise<string> {
    const outDir = folder ? NSE.getPath(folder, true) : this.dir;
    let url: string;
    const dt = date;
    if (dt < NSE.UDIFF_SWITCH_DATE) {
      const dateStr = dt
        .toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
        .toUpperCase()
        .replace(/ /g, "");
      const month = dateStr.substring(2, 5);
      url = `${NSE.archive_url}/content/historical/EQUITIES/${dt.getFullYear()}/${month}/cm${dateStr}bhav.csv.zip`;
    } else {
      const ymd = `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
      url = `${NSE.archive_url}/content/cm/BhavCopy_NSE_CM_0_0_0_${ymd}_F_0000.csv.zip`;
    }
    const file = await this.download(url, outDir);
    if (!fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      throw new Error(`Failed to download file: ${path.basename(file)}`);
    }
    return await this.unzip(file, path.dirname(file));
  }

  async deliveryBhavcopy(date: Date, folder?: string): Promise<string> {
    const outDir = folder ? NSE.getPath(folder, true) : this.dir;
    const dt = date;
    const ddmmyyyy = `${String(dt.getDate()).padStart(2, "0")}${String(dt.getMonth() + 1).padStart(2, "0")}${dt.getFullYear()}`;
    const url = `${NSE.archive_url}/products/content/sec_bhavdata_full_${ddmmyyyy}.csv`;
    const file = await this.download(url, outDir);
    if (!fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      throw new Error(`Failed to download file: ${path.basename(file)}`);
    }
    return file;
  }

  async indicesBhavcopy(date: Date, folder?: string): Promise<string> {
    const outDir = folder ? NSE.getPath(folder, true) : this.dir;
    const dt = date;
    const ddmmyyyy = `${String(dt.getDate()).padStart(2, "0")}${String(dt.getMonth() + 1).padStart(2, "0")}${dt.getFullYear()}`;
    const url = `${NSE.archive_url}/content/indices/ind_close_all_${ddmmyyyy}.csv`;
    const file = await this.download(url, outDir);
    if (!fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      throw new Error(`Failed to download file: ${path.basename(file)}`);
    }
    return file;
  }

  async fnoBhavcopy(date: Date, folder?: string): Promise<string> {
    const outDir = folder ? NSE.getPath(folder, true) : this.dir;
    const dt = date;
    const ymd = `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
    const url = `${NSE.archive_url}/content/fo/BhavCopy_NSE_FO_0_0_0_${ymd}_F_0000.csv.zip`;
    const file = await this.download(url, outDir);
    if (!fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      throw new Error(`Failed to download file: ${path.basename(file)}`);
    }
    return await this.unzip(file, path.dirname(file));
  }

  async priceband_report(date: Date, folder?: string): Promise<string> {
    const outDir = folder ? NSE.getPath(folder, true) : this.dir;
    const dt = date;
    const ddmmyyyy = `${String(dt.getDate()).padStart(2, "0")}${String(dt.getMonth() + 1).padStart(2, "0")}${dt.getFullYear()}`;
    const url = `${NSE.archive_url}/content/equities/sec_list_${ddmmyyyy}.csv`;
    const file = await this.download(url, outDir);
    if (!fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      throw new Error(`Failed to download file: ${path.basename(file)}`);
    }
    return file;
  }

  async pr_bhavcopy(date: Date, folder?: string): Promise<string> {
    const outDir = folder ? NSE.getPath(folder, true) : this.dir;
    const dt = date;
    const ddmmyy = `${String(dt.getDate()).padStart(2, "0")}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getFullYear()).slice(-2)}`;
    const url = `${NSE.archive_url}/archives/equities/bhavcopy/pr/PR${ddmmyy}.zip`;
    const file = await this.download(url, outDir);
    if (!fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      throw new Error(`Failed to download file: ${path.basename(file)}`);
    }
    return file;
  }

  async cm_mii_security_report(date: Date, folder?: string): Promise<string> {
    const outDir = folder ? NSE.getPath(folder, true) : this.dir;
    const dt = date;
    const ddmmyyyy = `${String(dt.getDate()).padStart(2, "0")}${String(dt.getMonth() + 1).padStart(2, "0")}${dt.getFullYear()}`;
    const url = `${NSE.archive_url}/content/cm/NSE_CM_security_${ddmmyyyy}.csv.gz`;
    const file = await this.download(url, outDir);
    if (!fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      throw new Error(`Failed to download file: ${path.basename(file)}`);
    }
    return await this.unzip(file, path.dirname(file));
  }

  async actions(params: {
    segment?: "equities" | "sme" | "debt" | "mf";
    symbol?: string;
    from_date?: Date;
    to_date?: Date;
  } = {}): Promise<any[]> {
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

    const query: Record<string, any> = {
      index: params.segment ?? "equities",
    };
    if (params.symbol) query.symbol = params.symbol;
    if (params.from_date && params.to_date) {
      if (params.from_date > params.to_date)
        throw new Error("'from_date' cannot be greater than 'to_date'");
      query.from_date = fmt(params.from_date);
      query.to_date = fmt(params.to_date);
    }
    return await this.req(`${NSE.base_url}/corporates-corporateActions`, query);
  }

  async announcements(params: {
    index?: "equities" | "sme" | "debt" | "mf" | "invitsreits";
    symbol?: string;
    fno?: boolean;
    from_date?: Date;
    to_date?: Date;
  } = {}): Promise<any[]> {
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

    const query: Record<string, any> = {
      index: params.index ?? "equities",
    };
    if (params.symbol) query.symbol = params.symbol;
    if (params.fno) query.fo_sec = true;
    if (params.from_date && params.to_date) {
      if (params.from_date > params.to_date)
        throw new Error("'from_date' cannot be greater than 'to_date'");
      query.from_date = fmt(params.from_date);
      query.to_date = fmt(params.to_date);
    }
    return await this.req(`${NSE.base_url}/corporate-announcements`, query);
  }

  async boardMeetings(params: {
    index?: "equities" | "sme";
    symbol?: string;
    fno?: boolean;
    from_date?: Date;
    to_date?: Date;
  } = {}): Promise<any[]> {
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

    const query: Record<string, any> = {
      index: params.index ?? "equities",
    };
    if (params.symbol) query.symbol = params.symbol;
    if (params.fno) query.fo_sec = true;
    if (params.from_date && params.to_date) {
      if (params.from_date > params.to_date)
        throw new Error("'from_date' cannot be greater than 'to_date'");
      query.from_date = fmt(params.from_date);
      query.to_date = fmt(params.to_date);
    }
    return await this.req(`${NSE.base_url}/corporate-board-meetings`, query);
  }

  async annual_reports(symbol: string, segment: "equities" | "sme" = "equities") {
    return await this.req(`${NSE.base_url}/annual-reports`, {
      index: segment,
      symbol,
    });
  }

  async equityMetaInfo(symbol: string) {
    return await this.req(`${NSE.base_url}/equity-meta-info`, { symbol: symbol.toUpperCase() });
  }

  async quote(params: { symbol: string; type?: "equity" | "fno"; section?: "trade_info" }) {
    const type = params.type ?? "equity";
    const url = type === "equity" ? `${NSE.base_url}/quote-equity` : `${NSE.base_url}/quote-derivative`;
    const query: Record<string, any> = { symbol: params.symbol.toUpperCase() };
    if (params.section) {
      if (params.section !== "trade_info") throw new Error("'Section' if specified must be 'trade_info'");
      query.section = params.section;
    }
    return await this.req(url, query);
  }

  async equityQuote(symbol: string) {
    const q = await this.quote({ symbol, type: "equity" });
    const v = await this.quote({ symbol, type: "equity", section: "trade_info" });
    const open = q.priceInfo?.open;
    const minmax = q.priceInfo?.intraDayHighLow;
    const close = q.priceInfo?.close;
    const ltp = q.priceInfo?.lastPrice;
    return {
      date: q.metadata?.lastUpdateTime,
      open,
      high: minmax?.max,
      low: minmax?.min,
      close: close ?? ltp,
      volume: v.securityWiseDP?.quantityTraded,
    } as Record<string, string | number | undefined>;
  }

  gainers(data: { data: Array<{ pChange: number; [k: string]: any }> }, count?: number) {
    const filtered = data.data.filter((d) => d.pChange > 0).sort((a, b) => b.pChange - a.pChange);
    return typeof count === "number" ? filtered.slice(0, count) : filtered;
  }

  losers(data: { data: Array<{ pChange: number; [k: string]: any }> }, count?: number) {
    const filtered = data.data.filter((d) => d.pChange < 0).sort((a, b) => a.pChange - b.pChange);
    return typeof count === "number" ? filtered.slice(0, count) : filtered;
  }

  async listEquityStocksByIndex(index = "NIFTY 50") {
    return await this.req(`${NSE.base_url}/equity-stockIndices`, { index });
  }

  async listIndices() {
    return await this.req(`${NSE.base_url}/allIndices`);
  }

  async listEtf() {
    return await this.req(`${NSE.base_url}/etf`);
  }

  async listSme() {
    return await this.req(`${NSE.base_url}/live-analysis-emerge`);
  }

  async listSgb() {
    return await this.req(`${NSE.base_url}/sovereign-gold-bonds`);
  }

  async listCurrentIPO() {
    return await this.req(`${NSE.base_url}/ipo-current-issue`);
  }

  async listUpcomingIPO() {
    return await this.req(`${NSE.base_url}/all-upcoming-issues?category=ipo`);
  }

  async getIpoDetails(params: { symbol: string; series?: "EQ" | "SME" }) {
    const symbol = params.symbol.toUpperCase();
    const series = params.series ?? "EQ";
    return await this.req(`${NSE.base_url}/ipo-detail`, { symbol, series });
  }

  async listPastIPO(from_date?: Date, to_date?: Date) {
    const to = to_date ?? new Date();
    const from = from_date ?? new Date(to.getTime() - 90 * 86400000);
    if (to < from) throw new Error("Argument `to_date` cannot be less than `from_date`");
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    return await this.req(`${NSE.base_url}/public-past-issues`, {
      from_date: fmt(from),
      to_date: fmt(to),
    });
  }

  async circulars(params: {
    subject?: string;
    dept_code?: string;
    from_date?: Date;
    to_date?: Date;
  } = {}) {
    const to = params.to_date ?? new Date();
    const from = params.from_date ?? new Date(to.getTime() - 7 * 86400000);
    if (to < from) throw new Error("Argument `to_date` cannot be less than `from_date`");
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

    const query: Record<string, any> = {
      from_date: fmt(from),
      to_date: fmt(to),
    };
    if (params.subject) query.sub = params.subject;
    if (params.dept_code) query.dept = params.dept_code.toUpperCase();

    return await this.req(`${NSE.base_url}/circulars`, query);
  }

  async blockDeals() {
    return await this.req(`${NSE.base_url}/block-deal`);
  }

  async fnoLots(): Promise<Record<string, number>> {
    const url = "https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv";
    const res = await this.req(url);
    // When called via req it tries JSON; use direct HTTP to fetch CSV
    let csv: string;
    if (typeof res === "string") csv = res;
    else {
      if (this.server && this.gotClient) {
        const r = await this.gotClient.get(url, { responseType: "text" });
        csv = r.body as string;
      } else if (this.axiosClient) {
        const r = await this.axiosClient.get(url, { responseType: "text" });
        csv = r.data as string;
      } else {
        throw new Error("HTTP client not initialized");
      }
    }
    const lines = csv.trim().split(/\r?\n/);
    const dct: Record<string, number> = {};
    for (const line of lines) {
      const parts = line.split(",");
      if (parts.length < 4) continue;
      const sym = parts[1]?.trim();
      const lot = Number(parts[3]?.trim());
      if (!sym || !Number.isFinite(lot)) continue;
      dct[sym] = lot;
    }
    return dct;
  }

  async optionChain(symbol: string) {
    const idx = NSE.optionIndex.includes(symbol.toLowerCase() as any);
    const url = idx
      ? `${NSE.base_url}/option-chain-indices`
      : `${NSE.base_url}/option-chain-equities`;
    return await this.req(url, { symbol: symbol.toUpperCase() });
  }

  static maxpain(optionChain: any, expiryDate: Date): number {
    const out: Record<number, number> = {};
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${new Intl.DateTimeFormat("en-GB", { month: "short" }).format(d)}-${d.getFullYear()}`;
    const expiryDateStr = fmt(expiryDate);

    for (const x of optionChain.records.data) {
      if (x.expiryDate !== expiryDateStr) continue;
      const expiryStrike = x.strikePrice;
      let pain = 0;
      for (const y of optionChain.records.data) {
        if (y.expiryDate !== expiryDateStr) continue;
        const diff = expiryStrike - y.strikePrice;
        if (diff > 0 && y.CE) pain += -diff * y.CE.openInterest;
        if (diff < 0 && y.PE) pain += diff * y.PE.openInterest;
      }
      out[expiryStrike] = pain;
    }

    const keys = Object.keys(out).map(Number);
    return keys.sort((a, b) => out[b] - out[a])[0];
  }

  async getFuturesExpiry(index: "nifty" | "banknifty" | "finnifty" = "nifty"): Promise<string[]> {
    const idx = index === "banknifty" ? "nifty_bank_fut" : index === "finnifty" ? "finnifty_fut" : "nse50_fut";
    const res = await this.req(`${NSE.base_url}/liveEquity-derivatives`, { index: idx });
    const data: string[] = res.data.map((i: any) => i.expiryDate);
    return data.sort(
      (a, b) =>
        new Date(a.replace(/-/g, "/")).getTime() - new Date(b.replace(/-/g, "/")).getTime()
    );
  }

  async compileOptionChain(symbol: string, expiryDate: Date) {
    const data = await this.optionChain(symbol);
    const chain: Record<string, any> = {};
    const oc: Record<string, any> = {};

    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${new Intl.DateTimeFormat("en-GB", { month: "short" }).format(d)}-${d.getFullYear()}`;
    const expiryDateStr = fmt(expiryDate);

    oc.expiry = expiryDateStr;
    oc.timestamp = data.records.timestamp;
    const strike1 = data.filtered.data[0].strikePrice;
    const strike2 = data.filtered.data[1].strikePrice;
    const multiple = strike1 - strike2;

    const underlying = data.records.underlyingValue;
    oc.underlying = underlying;
    oc.atm = multiple * Math.round(underlying / multiple);

    let maxCoi = 0;
    let maxPoi = 0;
    let totalCoi = 0;
    let totalPoi = 0;
    let maxCoiStrike = 0;
    let maxPoiStrike = 0;

    for (const idx of data.records.data) {
      if (idx.expiryDate !== expiryDateStr) continue;
      const strike = String(idx.strikePrice);
      if (!chain[strike]) chain[strike] = { pe: {}, ce: {} };

      let poi = 0;
      let coi = 0;

      if (idx.PE) {
        const { openInterest, lastPrice, chg, impliedVolatility } = idx.PE;
        poi = openInterest;
        chain[strike].pe = { last: lastPrice, oi: poi, chg, iv: impliedVolatility };
        totalPoi += poi;
        if (poi > maxPoi) {
          maxPoi = poi;
          maxPoiStrike = Number(strike);
        }
      } else {
        chain[strike].pe = { last: 0, oi: 0, chg: 0, iv: 0 };
      }

      if (idx.CE) {
        const { openInterest, lastPrice, chg, impliedVolatility } = idx.CE;
        coi = openInterest;
        chain[strike].ce = { last: lastPrice, oi: coi, chg, iv: impliedVolatility };
        totalCoi += coi;
        if (coi > maxCoi) {
          maxCoi = coi;
          maxCoiStrike = Number(strike);
        }
      } else {
        chain[strike].ce = { last: 0, oi: 0, chg: 0, iv: 0 };
      }

      chain[strike].pcr = poi === 0 || coi === 0 ? null : Number((poi / coi).toFixed(2));
    }

    oc.maxpain = NSE.maxpain(data, expiryDate);
    oc.maxCoi = maxCoiStrike;
    oc.maxPoi = maxPoiStrike;
    oc.coiTotal = totalCoi;
    oc.poiTotal = totalPoi;
    oc.pcr = Number((totalPoi / totalCoi).toFixed(2));
    oc.chain = chain;

    return oc;
  }

  async holidays(type: "trading" | "clearing" = "trading") {
    return await this.req(`${NSE.base_url}/holiday-master`, { type });
  }

  async bulkdeals(fromdate: Date, todate: Date) {
    if ((todate.getTime() - fromdate.getTime()) / 86400000 > 365)
      throw new Error("The date range cannot exceed one year.");
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    const url = `${NSE.base_url}/historical/bulk-deals?from=${fmt(fromdate)}&to=${fmt(todate)}`;
    const data = await this.req(url);
    if (!data.data || data.data.length < 1) {
      throw new Error("No bulk deals data available for the specified date range.");
    }
    return data.data;
  }

  async download_document(url: string, folder?: string, extract_files?: string[]) {
    const outDir = folder ? NSE.getPath(folder, true) : this.dir;
    const file = await this.download(url, outDir);
    if (!fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      throw new Error(`Failed to download file: ${path.basename(file)}`);
    }
    if (path.extname(file).toLowerCase() === ".zip") {
      try {
        return await this.unzip(file, path.dirname(file), extract_files);
      } catch (e: any) {
        fs.rmSync(file, { force: true });
        throw new Error(`Failed to extract zip file: ${String(e?.message ?? e)}`);
      }
    }
    return file;
  }

  // region Historical and auxiliary endpoints
  private splitDateRange(from: Date, to: Date, maxChunkSizeDays = 365): Array<[Date, Date]> {
    const chunks: Array<[Date, Date]> = [];
    let currentStart = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    while (currentStart.getTime() <= end.getTime()) {
      const currentEnd = new Date(currentStart.getTime() + (maxChunkSizeDays - 1) * 86400000);
      const boundedEnd = currentEnd.getTime() > end.getTime() ? end : currentEnd;
      chunks.push([currentStart, boundedEnd]);
      currentStart = new Date(boundedEnd.getTime() + 86400000);
    }
    return chunks;
  }

  async fetch_equity_historical_data(params: {
    symbol: string;
    from_date?: Date;
    to_date?: Date;
    series?: string[];
  }): Promise<Record<string, any>[]> {
    const symbol = params.symbol;
    const series = params.series ?? ["EQ"];

    // Simple case
    if (!params.from_date && !params.to_date && JSON.stringify(series) === JSON.stringify(["EQ"])) {
      const data = await this.req(`${NSE.base_url}/historical/cm/equity`, { symbol });
      return (data.data as any[]).slice().reverse();
    }

    const to = params.to_date ?? new Date();
    const from = params.from_date ?? new Date(to.getTime() - 30 * 86400000);
    if (to < from) throw new Error("The from date must occur before the to date");

    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

    const chunks = this.splitDateRange(from, to, 100);
    const out: Record<string, any>[] = [];
    for (const [cFrom, cTo] of chunks) {
      const d = await this.req(`${NSE.base_url}/historical/cm/equity`, {
        symbol,
        series: JSON.stringify(series),
        from: fmt(cFrom),
        to: fmt(cTo),
      });
      const arr = (d.data as any[]).slice().reverse();
      out.push(...arr);
    }
    return out;
  }

  async fetch_historical_vix_data(params: { from_date?: Date; to_date?: Date } = {}): Promise<Record<string, any>[]> {
    const to = params.to_date ?? new Date();
    const from = params.from_date ?? new Date(to.getTime() - 30 * 86400000);
    if (to < from) throw new Error("The from date must occur before the to date");
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

    const chunks = this.splitDateRange(from, to, 365);
    const data: any[] = [];
    for (const [cFrom, cTo] of chunks) {
      const d = await this.req(`${NSE.base_url}/historical/vixhistory`, {
        from: fmt(cFrom),
        to: fmt(cTo),
      });
      data.push(...(d.data as any[]));
    }
    return data;
  }

  async fetch_historical_fno_data(params: {
    symbol: string;
    instrument?: "FUTIDX" | "FUTSTK" | "OPTIDX" | "OPTSTK" | "FUTIVX";
    from_date?: Date;
    to_date?: Date;
    expiry?: Date;
    option_type?: "CE" | "PE";
    strike_price?: number;
  }): Promise<Record<string, any>[]> {
    const instrument = (params.instrument ?? "FUTIDX").toUpperCase() as typeof params.instrument;
    const to = params.to_date ?? new Date();
    const from = params.from_date ?? new Date(to.getTime() - 30 * 86400000);
    if (to < from) throw new Error("The from date must occur before the to date");

    const query: Record<string, any> = {
      instrumentType: instrument,
      symbol: params.symbol.toUpperCase(),
    };

    const fmtDMY = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    const fmtExpiry = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${new Intl.DateTimeFormat("en-GB", { month: "short" }).format(d)}-${d.getFullYear()}`;

    if (params.expiry) {
      query.expiryDate = fmtExpiry(params.expiry);
      query.year = params.expiry.getFullYear();
    }

    if (instrument === "OPTIDX" || instrument === "OPTSTK") {
      if (!params.option_type) throw new Error("`option_type` param is required for Stock or Index options.");
      query.optionType = params.option_type;
      if (params.strike_price != null) query.strikePrice = params.strike_price;
    }

    const chunks = this.splitDateRange(from, to, 365);
    const data: any[] = [];
    for (const [cFrom, cTo] of chunks) {
      query.from = fmtDMY(cFrom);
      query.to = fmtDMY(cTo);
      const d = await this.req(`${NSE.base_url}/historical/foCPV`, query);
      data.push(...(d.data as any[]));
    }
    return data;
  }

  async fetch_historical_index_data(params: {
    index: string;
    from_date?: Date;
    to_date?: Date;
  }): Promise<{ price: any[]; turnover: any[] }> {
    const to = params.to_date ?? new Date();
    const from = params.from_date ?? new Date(to.getTime() - 30 * 86400000);
    if (to < from) throw new Error("The from date must occur before the to date");
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

    const chunks = this.splitDateRange(from, to, 365);
    const out = { price: [] as any[], turnover: [] as any[] };
    for (const [cFrom, cTo] of chunks) {
      const d = await this.req(`${NSE.base_url}/historical/indicesHistory`, {
        indexType: params.index.toUpperCase(),
        from: fmt(cFrom),
        to: fmt(cTo),
      });
      out.price.push(...(d.data.indexCloseOnlineRecords as any[]));
      out.turnover.push(...(d.data.indexTurnoverRecords as any[]));
    }
    return out;
  }

  async fetch_fno_underlying(): Promise<{ IndexList: any[]; UnderlyingList: any[] }> {
    const d = await this.req(`${NSE.base_url}/underlying-information`);
    return d.data;
  }

  async fetch_index_names(): Promise<Record<string, Array<[string, string]>>> {
    return await this.req(`${NSE.base_url}/index-names`);
  }

  async fetch_daily_reports_file_metadata(segment: "CM" | "INDEX" | "SLBS" | "SME" | "FO" | "COM" | "CD" | "NBF" | "WDM" | "CBM" | "TRI-PARTY" = "CM") {
    return await this.req(`${NSE.base_url}/daily-reports`, { key: segment });
  }
  // endregion
}
