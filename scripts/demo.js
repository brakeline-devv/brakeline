// Scripted run through every rule on a fresh simulated account: `npm run demo`
// Uses the default rules for the run and puts your own rules back afterwards.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import * as guard from "../src/guard.js";
import * as sim from "../src/sim.js";
import { RULES_FILE, DEFAULT_RULES, saveRules } from "../src/rules.js";

const mine = existsSync(RULES_FILE) ? readFileSync(RULES_FILE, "utf8") : null;
writeFileSync(RULES_FILE, JSON.stringify(DEFAULT_RULES, null, 2));
sim.reset(); writeFileSync(guard.JOURNAL_FILE, "[]");

const shock = (syms, p) => { const s = sim.load(); for (const k of syms) sim.shock(s, k, p); sim.save(s); console.log(`   (market) ${syms.join(", ")} ${p > 0 ? "+" : ""}${p}%`); };
const go = async (label, o) => {
  const r = await guard.simPlace(o);
  const mark = r.status === "FILLED" ? "✔ FILLED " : "✖ " + r.status.padEnd(8);
  console.log(`${mark} ${label.padEnd(40)} ${r.status === "FILLED" ? `@ ${r.fill.price}${r.fill.pnl ? `  pnl ${r.fill.pnl}` : ""}` : r.reason}`);
};

try {
  console.log("Brakeline demo — $100k simulated account, default rules\n");
  await go("buy 20 AAPL (~4.5% of equity)", { symbol: "AAPL", side: "buy", qty: 20 });
  await go("buy 40 NVDA (~7% — too big)", { symbol: "NVDA", side: "buy", qty: 40 });
  await go("buy 25 NVDA (inside the 5% cap)", { symbol: "NVDA", side: "buy", qty: 25 });
  shock(["AAPL"], -6);
  await go("sell 20 AAPL (cut loss — always allowed)", { symbol: "AAPL", side: "sell", qty: 20 });
  await go("buy 10 AAPL right back (revenge trade)", { symbol: "AAPL", side: "buy", qty: 10 });
  saveRules({ killSwitch: true }); console.log("   (you) kill switch ON");
  await go("buy 5 MSFT", { symbol: "MSFT", side: "buy", qty: 5 });
  await go("sell 25 NVDA (selling still works)", { symbol: "NVDA", side: "sell", qty: 25 });
  saveRules({ killSwitch: false }); console.log("   (you) kill switch OFF");
  for (const [s, q] of [["TSLA", 18], ["AMD", 30], ["META", 8], ["GOOGL", 25]]) await go(`buy ${q} ${s}`, { symbol: s, side: "buy", qty: q });
  shock(["TSLA", "AMD", "META", "GOOGL"], -20);
  await go("buy 5 MSFT (after a -3.9% day)", { symbol: "MSFT", side: "buy", qty: 5 });
  const a = guard.simAccount();
  console.log(`\nequity ${a.equity} · today ${a.todayPnl} · loss budget left ${a.budget.dailyLossBudgetLeft}`);
} finally {
  if (mine) writeFileSync(RULES_FILE, mine);
}
