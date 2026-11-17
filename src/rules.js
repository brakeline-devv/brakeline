// Brakeline rule engine. Pure functions: give it the order and the account state, get a verdict.
// Principle: a rule may only stop an order that ADDS risk (a buy). Selling down a position is never blocked.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dataFile } from "./paths.js";

export const RULES_FILE = dataFile("rules.json");

// Broad, diversified funds: a single ticker but hundreds of holdings, so the per-position cap is wider.
export const FUNDS = new Set(["SPY", "VOO", "IVV", "VTI", "QQQ", "DIA", "IWM", "BND", "AGG", "TLT", "SHY", "SGOV", "GLD", "IAU"]);

export const DEFAULT_RULES = {
  maxDailyLossPct: 3,                 // no new buys once today's loss reaches 3% of start-of-day equity
  maxPositionPct: 5,                  // a position may not exceed 5% of equity after the buy
  maxFundPositionPct: 30,             // broad index / bond / gold funds (they hold hundreds of names) get a wider cap
  revengeWindowMin: 15,               // no re-buy of a symbol within 15 min of closing it at a loss
  maxBuysPerDay: 10,                  // overtrading cap
  lossStreak: { losses: 3, cooldownMin: 60 }, // 3 losing sells in a row → no buys for 60 min
  killSwitch: false,                  // true = no buys at all until a human turns it off
  approval: "client",                 // "client": rely on the AI app's permission prompt; "dashboard": every passing order waits for a click in the dashboard
  approvalTimeoutSec: 90,
};

// validates a partial update from the dashboard and writes data/rules.json
export function saveRules(patch) {
  const r = { ...loadRules() };
  const num = (k, min, max) => { if (patch[k] != null) { const v = Number(patch[k]); if (!(v >= min && v <= max)) throw new Error(`${k} must be between ${min} and ${max}`); r[k] = v; } };
  num("maxDailyLossPct", 0.1, 100); num("maxPositionPct", 0.1, 100); num("maxFundPositionPct", 0.1, 100); num("revengeWindowMin", 0, 1440); num("maxBuysPerDay", 0, 1000); num("approvalTimeoutSec", 10, 600);
  if (patch.lossStreak) {
    const l = Number(patch.lossStreak.losses), c = Number(patch.lossStreak.cooldownMin);
    if (!(l >= 1 && l <= 20 && c >= 0 && c <= 1440)) throw new Error("lossStreak: losses 1-20, cooldownMin 0-1440");
    r.lossStreak = { losses: l, cooldownMin: c };
  }
  if (patch.killSwitch != null) r.killSwitch = !!patch.killSwitch;
  if (patch.approval != null) { if (!["client", "dashboard"].includes(patch.approval)) throw new Error("approval must be client or dashboard"); r.approval = patch.approval; }
  writeFileSync(RULES_FILE, JSON.stringify(r, null, 2));
  return r;
}

// Rules are read from disk on every check. The agent has no tool to change them: only the human edits data/rules.json.
export function loadRules() {
  if (!existsSync(RULES_FILE)) return { ...DEFAULT_RULES };
  try { return { ...DEFAULT_RULES, ...JSON.parse(readFileSync(RULES_FILE, "utf8")) }; }
  catch { return { ...DEFAULT_RULES }; }
}

const MIN = 60_000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const pct = (x) => Math.round(x * 100) / 100;

/**
 * @param order {symbol, side: "buy"|"sell", qty, price}
 * @param ctx   {now, equity, startEquity, positions: {SYM: {qty, avg}}, fills: [{t, symbol, side, qty, price, pnl}]}
 * @returns {allowed, reason, checks: [{rule, ok, detail}], budget}
 */
export function evaluate(order, ctx, rules = loadRules()) {
  const { now, equity, startEquity, positions, fills } = ctx;
  const sym = order.symbol.toUpperCase();
  const checks = [];
  const add = (rule, ok, detail) => checks.push({ rule, ok, detail });

  const held = positions[sym]?.qty ?? 0;
  if (order.side === "sell") {
    add("reduce_only", order.qty <= held, order.qty <= held ? `selling ${order.qty} of ${held} held — reducing risk is always allowed` : `only ${held} ${sym} held`);
    return finish(checks, budgetOf(ctx, rules));
  }

  // 0. kill switch
  add("kill_switch", !rules.killSwitch, rules.killSwitch ? "the kill switch is ON — a human has paused all buys" : "off");

  // 1. daily loss limit
  const dayPnl = equity - startEquity;
  const dayLossPct = startEquity > 0 ? (-dayPnl / startEquity) * 100 : 0;
  add("daily_loss_limit", dayLossPct < rules.maxDailyLossPct,
    `today ${dayPnl >= 0 ? "+" : ""}${pct(dayPnl)} (${pct(-dayLossPct)}%), limit -${rules.maxDailyLossPct}%`);

  // 2. position size
  const fund = FUNDS.has(sym), cap = fund ? (rules.maxFundPositionPct ?? rules.maxPositionPct) : rules.maxPositionPct;
  const after = (held + order.qty) * order.price;
  const afterPct = equity > 0 ? (after / equity) * 100 : 100;
  const maxQty = Math.max(0, Math.floor(((cap / 100) * equity) / order.price - held));
  add("position_size", afterPct <= cap,
    `${sym} would be ${pct(afterPct)}% of equity, cap ${cap}%${fund ? " (broad fund)" : ""} (max buy now: ${maxQty})`);

  // 3. revenge trade: same symbol closed at a loss within the window
  const lastLoss = [...fills].reverse().find((f) => f.symbol === sym && f.side === "sell" && f.pnl < 0);
  const since = lastLoss ? (now - lastLoss.t) / MIN : Infinity;
  const calm = since >= rules.revengeWindowMin;
  add("revenge_trade", calm,
    !lastLoss ? `no recent losing exit on ${sym}`
      : calm ? `last losing exit on ${sym} was ${Math.floor(since)} min ago`
        : `${sym} was sold at a ${pct(lastLoss.pnl)} loss ${Math.floor(since)} min ago, wait ${rules.revengeWindowMin} min (${Math.ceil(rules.revengeWindowMin - since)} left)`);

  // 4. overtrading
  const buysToday = fills.filter((f) => f.side === "buy" && dayKey(f.t) === dayKey(now)).length;
  add("max_buys_per_day", buysToday < rules.maxBuysPerDay, `${buysToday} of ${rules.maxBuysPerDay} buys used today`);

  // 5. loss streak cooldown
  const sells = fills.filter((f) => f.side === "sell");
  const tail = sells.slice(-rules.lossStreak.losses);
  const streak = tail.length === rules.lossStreak.losses && tail.every((f) => f.pnl < 0);
  const coolLeft = streak ? rules.lossStreak.cooldownMin - (now - tail.at(-1).t) / MIN : 0;
  add("loss_streak_cooldown", coolLeft <= 0,
    coolLeft > 0 ? `${rules.lossStreak.losses} losing exits in a row, cooling down (${Math.ceil(coolLeft)} min left)` : "no losing streak");

  return finish(checks, budgetOf(ctx, rules));
}

function finish(checks, budget) {
  const failed = checks.filter((c) => !c.ok);
  return { allowed: failed.length === 0, reason: failed.length ? failed.map((c) => `${c.rule}: ${c.detail}`).join("; ") : "all checks passed", checks, budget };
}

export function budgetOf({ equity, startEquity }, rules) {
  const lossLeft = startEquity * (rules.maxDailyLossPct / 100) + (equity - startEquity);
  return { dailyLossBudgetLeft: pct(Math.max(0, lossLeft)), dailyLossBudget: pct(startEquity * (rules.maxDailyLossPct / 100)), maxPositionValue: pct((rules.maxPositionPct / 100) * equity) };
}
