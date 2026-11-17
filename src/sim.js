// Simulated brokerage for development and demos (no Robinhood account needed).
// Prices start from the last real close (Yahoo Finance, once a day; built-in levels if offline) and then
// random-walk between quotes. State lives in data/sim.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dataFile } from "./paths.js";

export const SIM_FILE = dataFile("sim.json");
const BASE = { AAPL: 228, MSFT: 415, NVDA: 182, TSLA: 248, AMZN: 201, GOOGL: 176, META: 590, AMD: 152, PLTR: 64, SPY: 590, QQQ: 510, COIN: 265, HOOD: 42, VTI: 330, BND: 73, GLD: 380 };
export const SYMBOLS = Object.keys(BASE);
const START_CASH = 100_000;
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

function fresh() {
  return { cash: START_CASH, positions: {}, fills: [], journal: [], prices: { ...BASE }, priceT: Date.now(), day: null };
}
export function load() {
  if (!existsSync(SIM_FILE)) return fresh();
  try { return { ...fresh(), ...JSON.parse(readFileSync(SIM_FILE, "utf8")) }; } catch { return fresh(); }
}
export function save(s) { writeFileSync(SIM_FILE, JSON.stringify(s, null, 2)); }
export function reset() { const s = fresh(); save(s); return s; }

// advance every price by a random walk proportional to elapsed time (~2% daily vol, capped per call)
export function tick(s, now = Date.now()) {
  const dt = Math.min((now - s.priceT) / 86_400_000, 0.05);
  if (dt > 0) for (const k of Object.keys(s.prices)) {
    const z = Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
    s.prices[k] = round(s.prices[k] * Math.exp(0.02 * Math.sqrt(dt) * z));
  }
  s.priceT = now;
  rollDay(s, now);
  return s;
}

export const equityOf = (s) => round(s.cash + Object.entries(s.positions).reduce((a, [k, p]) => a + p.qty * s.prices[k], 0));

function rollDay(s, now) {
  const d = new Date(now).toISOString().slice(0, 10);
  if (s.day?.date !== d) s.day = { date: d, startEquity: equityOf(s) };
}

export function quote(s, sym) {
  const k = sym.toUpperCase();
  if (!(k in s.prices)) throw new Error(`unknown symbol ${k}; simulated symbols: ${SYMBOLS.join(", ")}`);
  return s.prices[k];
}

// demo helper: move one symbol by pct (e.g. -6) to stage a loss
export function shock(s, sym, pctMove) { const k = sym.toUpperCase(); quote(s, k); s.prices[k] = round(s.prices[k] * (1 + pctMove / 100)); return s.prices[k]; }

// refresh base prices from real closes once per day; never throws, keeps the old prices on any failure
export async function seedPrices(timeoutMs = 4000) {
  const s = load(), today = new Date().toISOString().slice(0, 10);
  if (s.seeded === today) return { seeded: false, reason: "already today" };
  const got = {};
  await Promise.all(SYMBOLS.map(async (k) => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${k}?range=1d&interval=1d`, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "Mozilla/5.0" } });
      const px = (await r.json())?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (px > 0) got[k] = round(px);
    } catch { /* offline: keep current price */ }
  }));
  const fresh = load(); // re-read: another process may have traded meanwhile
  Object.assign(fresh.prices, got); fresh.seeded = today; fresh.priceT = Date.now();
  // re-base today's starting equity on the real prices unless trading already happened today
  if (!fresh.fills.some((f) => new Date(f.t).toISOString().slice(0, 10) === today)) fresh.day = null;
  save(fresh);
  return { seeded: true, symbols: Object.keys(got).length };
}

export function fill(s, { symbol, side, qty, limit }, now = Date.now()) {
  const k = symbol.toUpperCase(), price = quote(s, k), p = s.positions[k] ?? { qty: 0, avg: 0 };
  // limit orders are immediate-or-cancel in the simulator
  if (limit && side === "buy" && price > limit) throw new Error(`not filled: ${k} is ${price}, above your limit ${limit}`);
  if (limit && side === "sell" && price < limit) throw new Error(`not filled: ${k} is ${price}, below your limit ${limit}`);
  let pnl = 0;
  if (side === "buy") {
    if (qty * price > s.cash) throw new Error(`not enough cash: need ${round(qty * price)}, have ${round(s.cash)}`);
    p.avg = (p.avg * p.qty + price * qty) / (p.qty + qty); p.qty += qty; s.cash -= qty * price;
  } else {
    if (qty > p.qty) throw new Error(`only ${p.qty} ${k} held`);
    pnl = round((price - p.avg) * qty); p.qty -= qty; s.cash += qty * price;
  }
  p.avg = round(p.avg, 4);
  if (p.qty > 0) s.positions[k] = p; else delete s.positions[k];
  s.cash = round(s.cash);
  const f = { t: now, symbol: k, side, qty, price, pnl };
  s.fills.push(f);
  return f;
}

export function context(s, now = Date.now()) {
  return { now, equity: equityOf(s), startEquity: s.day.startEquity, positions: s.positions, fills: s.fills };
}
