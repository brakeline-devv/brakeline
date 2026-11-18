// Brakeline core: every order goes through the rules before it can reach a broker, optionally waits for a human
// click in the dashboard, and every verdict is journaled. The MCP server and the dashboard are separate processes,
// so they share state through small JSON files in data/.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dataFile } from "./paths.js";
import { randomUUID } from "node:crypto";
import { evaluate, loadRules, budgetOf } from "./rules.js";
import * as sim from "./sim.js";

const file = (n) => dataFile(n);
export const JOURNAL_FILE = file("journal.json"), PENDING_FILE = file("pending.json");
const readJson = (f, d) => { if (!existsSync(f)) return d; try { return JSON.parse(readFileSync(f, "utf8")); } catch { return d; } };
const round = (x) => Math.round(x * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── journal ──────────────────────────────────────────────────────────────────
export function journal(limit = 50) { return readJson(JOURNAL_FILE, []).slice(-limit); }
export function log(entry) {
  const all = readJson(JOURNAL_FILE, []);
  all.push({ t: Date.now(), ...entry });
  writeFileSync(JOURNAL_FILE, JSON.stringify(all.slice(-1000), null, 2));
}

// ── human approval (rules.approval = "dashboard") ───────────────────────────
export function pending() { return readJson(PENDING_FILE, []); }
const writePending = (p) => writeFileSync(PENDING_FILE, JSON.stringify(p, null, 2));
export function decide(id, decision) {
  const p = pending(), item = p.find((x) => x.id === id);
  if (!item || item.decision) throw new Error("no such pending order");
  item.decision = decision === "approve" ? "approve" : "reject"; item.decidedAt = Date.now();
  writePending(p);
  return item;
}
// resolves "approve" | "reject" | "timeout"
async function waitForHuman(order, rules) {
  const id = randomUUID().slice(0, 8), until = Date.now() + rules.approvalTimeoutSec * 1000;
  writePending([...pending().filter((x) => !x.decision && x.expires > Date.now()), { id, order, created: Date.now(), expires: until }]);
  while (Date.now() < until) {
    const it = pending().find((x) => x.id === id);
    if (it?.decision) { writePending(pending().filter((x) => x.id !== id)); return it.decision; }
    await sleep(500);
  }
  writePending(pending().filter((x) => x.id !== id));
  return "timeout";
}
async function humanGate(order, rules) {
  if (rules.approval !== "dashboard") return null;
  const d = await waitForHuman(order, rules);
  if (d === "approve") return null;
  return d === "reject" ? "rejected by you in the Brakeline dashboard" : `no approval in the dashboard within ${rules.approvalTimeoutSec}s`;
}

function normOrder({ symbol, side, qty, limit_price }) {
  const o = { symbol: String(symbol ?? "").toUpperCase(), side: String(side ?? "").toLowerCase(), qty: Number(qty) };
  if (limit_price != null) o.limit = Number(limit_price);
  if (!o.symbol) throw new Error("symbol is required");
  if (!["buy", "sell"].includes(o.side)) throw new Error("side must be buy or sell");
  if (!Number.isInteger(o.qty) || o.qty <= 0) throw new Error("qty must be a positive whole number of shares");
  if (o.limit != null && !(o.limit > 0)) throw new Error("limit_price must be positive");
  return o;
}

// ── simulated broker ─────────────────────────────────────────────────────────
const simState = () => { const s = sim.tick(sim.load()); sim.save(s); return s; };

export function simAccount() {
  const s = simState(), equity = sim.equityOf(s);
  return {
    mode: "simulation", cash: s.cash, equity, startOfDayEquity: s.day.startEquity, todayPnl: round(equity - s.day.startEquity),
    positions: Object.entries(s.positions).map(([symbol, p]) => ({ symbol, qty: p.qty, avg: p.avg, price: s.prices[symbol], value: round(p.qty * s.prices[symbol]), unrealized: round((s.prices[symbol] - p.avg) * p.qty) })),
    budget: budgetOf(sim.context(s), loadRules()),
  };
}
export async function simQuote(symbol) { await sim.addSymbol(symbol); const s = simState(); return { symbol: symbol.toUpperCase(), price: sim.quote(s, symbol), simulated: true }; }

export async function simCheck(raw) {
  const o = normOrder(raw);
  await sim.addSymbol(o.symbol);
  const s = simState();
  const price = sim.quote(s, o.symbol);
  // size the order at the worse of market and limit, so a high limit can't sneak past the size cap
  const sizing = o.side === "buy" && o.limit ? Math.max(price, o.limit) : price;
  return { order: { ...o, price }, ...evaluate({ ...o, price: sizing }, sim.context(s)) };
}

export async function simPlace(raw) {
  const v = await simCheck(raw);
  if (!v.allowed) { log({ mode: "sim", order: v.order, verdict: "BLOCKED", reason: v.reason }); return { status: "BLOCKED", ...v }; }
  const stop = await humanGate(v.order, loadRules());
  if (stop) { log({ mode: "sim", order: v.order, verdict: "REJECTED", reason: stop }); return { status: "REJECTED", reason: stop, order: v.order }; }
  const s = simState();
  try {
    const f = sim.fill(s, v.order); sim.save(s);
    log({ mode: "sim", order: v.order, verdict: "FILLED", fill: f });
    return { status: "FILLED", fill: f, checks: v.checks, budget: budgetOf(sim.context(s), loadRules()) };
  } catch (e) {
    log({ mode: "sim", order: v.order, verdict: "NOT_FILLED", reason: e.message });
    return { status: "NOT_FILLED", reason: e.message, order: v.order };
  }
}

export function status() {
  const s = simState(), rules = loadRules();
  return statusFrom(sim.context(s), rules);
}
function statusFrom(ctx, rules) {
  // a 1-share probe buy shows which buy-side rules are tripped right now
  const probe = evaluate({ symbol: "__PROBE__", side: "buy", qty: 1, price: 0 }, ctx, rules);
  const tripped = probe.checks.filter((c) => !c.ok && c.rule !== "position_size").map((c) => `${c.rule}: ${c.detail}`);
  return { rules, buysAllowed: tripped.length === 0, tripped, budget: probe.budget, approval: rules.approval, editRulesAt: "Brakeline dashboard or data/rules.json (human only — the agent has no tool to change rules)" };
}

// ── Robinhood relay ──────────────────────────────────────────────────────────
// Brakeline can't read Robinhood P&L directly yet, so it keeps its own ledger of the orders it forwarded and
// estimates P&L from their prices (limit price, or the price field the agent sent). Equity = BRAKELINE_EQUITY + realized P&L today.
export function relayContext(now = Date.now()) {
  const base = Number(process.env.BRAKELINE_EQUITY);
  const fwd = journal(1000).filter((j) => j.mode === "robinhood" && j.verdict === "FORWARDED" && j.order?.price > 0);
  const positions = {}, fills = [];
  for (const j of fwd) {
    const o = j.order, p = positions[o.symbol] ?? { qty: 0, avg: 0 };
    let pnl = 0;
    if (o.side === "buy") { p.avg = (p.avg * p.qty + o.price * o.qty) / (p.qty + o.qty); p.qty += o.qty; }
    else { const q = Math.min(o.qty, p.qty); pnl = round((o.price - p.avg) * q); p.qty -= q; }
    if (p.qty > 0) positions[o.symbol] = p; else delete positions[o.symbol];
    fills.push({ t: j.t, symbol: o.symbol, side: o.side, qty: o.qty, price: o.price, pnl });
  }
  const today = new Date(now).toISOString().slice(0, 10);
  const realizedToday = fills.filter((f) => new Date(f.t).toISOString().slice(0, 10) === today).reduce((a, f) => a + f.pnl, 0);
  return { now, equity: base + realizedToday, startEquity: base, positions, fills, estimated: true };
}
export function relayStatus() { return { ...statusFrom(relayContext(), loadRules()), note: "P&L is estimated from orders Brakeline forwarded (assumes they filled at the sent price)." }; }

// returns {allowed, reason, order} for an upstream order tool call
export async function relayGate(toolName, a) {
  const side = String(a.side ?? a.action ?? a.direction ?? (/sell/i.test(toolName) ? "sell" : /buy/i.test(toolName) ? "buy" : "")).toLowerCase();
  const o = { symbol: String(a.symbol ?? a.ticker ?? a.instrument ?? a.asset ?? "").toUpperCase(), side, qty: Number(a.quantity ?? a.qty ?? a.shares), price: Number(a.limit_price ?? a.limitPrice ?? a.price) };
  // dollar-based orders ("buy $500 of NVDA"): size them by the dollar amount
  const notional = Number(a.notional ?? a.amount ?? a.dollar_amount ?? a.dollars);
  if (!(o.qty > 0) && notional > 0) { if (o.price > 0) o.qty = notional / o.price; else { o.qty = 1; o.price = notional; } o.notional = notional; }
  if (!o.symbol || !["buy", "sell"].includes(o.side) || !(o.qty > 0)) return { allowed: false, reason: "Brakeline could not read symbol/side/size from this order, so it fails closed." };
  if (o.side === "buy" && !(o.price > 0)) return { allowed: false, order: o, reason: "Brakeline needs a limit price (or a dollar amount) on buys in Robinhood mode so it can size the order." };
  if (!(Number(process.env.BRAKELINE_EQUITY) > 0)) return { allowed: false, order: o, reason: "Set BRAKELINE_EQUITY (your account value) for Robinhood mode." };
  const v = evaluate(o, relayContext());
  if (!v.allowed) return { ...v, order: o };
  const stop = await humanGate(o, loadRules());
  return stop ? { allowed: false, order: o, reason: stop, rejected: true } : { ...v, order: o };
}
