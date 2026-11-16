// node --test : every rule, both directions
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, DEFAULT_RULES } from "../src/rules.js";

const NOW = Date.parse("2026-11-16T15:00:00Z"), MIN = 60_000;
const ctx = (over = {}) => ({ now: NOW, equity: 100_000, startEquity: 100_000, positions: {}, fills: [], ...over });
const buy = (qty = 10, price = 100, symbol = "AAPL") => ({ symbol, side: "buy", qty, price });
const failed = (v) => v.checks.filter((c) => !c.ok).map((c) => c.rule);
const R = { ...DEFAULT_RULES };

test("a small buy on a clean account passes", () => { assert.equal(evaluate(buy(), ctx(), R).allowed, true); });

test("kill switch blocks every buy", () => { assert.deepEqual(failed(evaluate(buy(), ctx(), { ...R, killSwitch: true })), ["kill_switch"]); });

test("daily loss limit trips at 3%", () => {
  assert.equal(evaluate(buy(), ctx({ equity: 97_100 }), R).allowed, true);
  assert.deepEqual(failed(evaluate(buy(), ctx({ equity: 97_000 }), R)), ["daily_loss_limit"]);
});

test("position size counts what is already held and reports the max buy", () => {
  assert.equal(evaluate(buy(50), ctx(), R).allowed, true); // 5,000 = 5%
  const v = evaluate(buy(10), ctx({ positions: { AAPL: { qty: 45, avg: 100 } } }), R);
  assert.deepEqual(failed(v), ["position_size"]);
  assert.match(v.checks.find((c) => c.rule === "position_size").detail, /max buy now: 5\b/);
});

test("revenge trade: blocked inside the window, allowed after it, other symbols unaffected", () => {
  const fills = [{ t: NOW - 5 * MIN, symbol: "AAPL", side: "sell", qty: 10, price: 90, pnl: -100 }];
  assert.deepEqual(failed(evaluate(buy(), ctx({ fills }), R)), ["revenge_trade"]);
  assert.equal(evaluate(buy(10, 100, "MSFT"), ctx({ fills }), R).allowed, true);
  assert.equal(evaluate(buy(), ctx({ fills, now: NOW + 11 * MIN }), R).allowed, true);
});

test("a profitable exit is not a revenge trigger", () => {
  const fills = [{ t: NOW - MIN, symbol: "AAPL", side: "sell", qty: 10, price: 110, pnl: 100 }];
  assert.equal(evaluate(buy(), ctx({ fills }), R).allowed, true);
});

test("max buys per day only counts today", () => {
  const mk = (t) => Array.from({ length: 10 }, (_, i) => ({ t, symbol: "S" + i, side: "buy", qty: 1, price: 1, pnl: 0 }));
  assert.deepEqual(failed(evaluate(buy(), ctx({ fills: mk(NOW - MIN) }), R)), ["max_buys_per_day"]);
  assert.equal(evaluate(buy(), ctx({ fills: mk(NOW - 24 * 60 * MIN) }), R).allowed, true);
});

test("loss streak cooldown after 3 losing exits, cleared by a winner or by time", () => {
  const loss = (m, s) => ({ t: NOW - m * MIN, symbol: s, side: "sell", qty: 1, price: 1, pnl: -10 });
  const three = [loss(50, "X"), loss(40, "Y"), loss(30, "Z")];
  assert.deepEqual(failed(evaluate(buy(), ctx({ fills: three }), R)), ["loss_streak_cooldown"]);
  assert.equal(evaluate(buy(), ctx({ fills: [...three, { ...loss(20, "W"), pnl: 5 }] }), R).allowed, true);
  assert.equal(evaluate(buy(), ctx({ fills: three, now: NOW + 31 * MIN }), R).allowed, true);
});

test("sells that reduce a position always pass, even with every brake on", () => {
  const v = evaluate({ symbol: "AAPL", side: "sell", qty: 5, price: 50 }, ctx({ equity: 50_000, positions: { AAPL: { qty: 10, avg: 100 } } }), { ...R, killSwitch: true });
  assert.equal(v.allowed, true);
});

test("selling more than held is refused", () => {
  assert.equal(evaluate({ symbol: "AAPL", side: "sell", qty: 5, price: 50 }, ctx(), R).allowed, false);
});
