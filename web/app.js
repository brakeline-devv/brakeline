// Brakeline dashboard: polls /api/state, lets the human pause buys, approve orders and edit rules.
const $ = (id) => document.getElementById(id);
const money = (x) => (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (x) => (x > 0 ? "+" : "") + money(x).replace("$-", "-$");
const time = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const post = async (path, body) => {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j;
};

let last = null, formDirty = false;

function render(s) {
  last = s;
  const st = s.status, rules = st.rules, b = st.budget;
  $("mode").textContent = s.mode === "sim" ? "Simulation" : "Robinhood";
  $("mode").classList.toggle("rh", s.mode !== "sim");

  // buying state + kill switch
  $("stateCard").classList.toggle("paused", !st.buysAllowed);
  $("stateText").textContent = rules.killSwitch ? "Paused by you" : st.buysAllowed ? "Allowed" : "Paused by rules";
  $("tripped").innerHTML = st.tripped.filter((t) => !t.startsWith("kill_switch")).map((t) => `<div>${esc(t)}</div>`).join("");
  $("kill").textContent = rules.killSwitch ? "Resume buying" : "Pause all buys";
  $("kill").classList.toggle("resume", rules.killSwitch);

  // daily loss budget
  const used = Math.max(0, b.dailyLossBudget - b.dailyLossBudgetLeft), frac = b.dailyLossBudget ? used / b.dailyLossBudget : 0;
  $("budgetLeft").textContent = money(b.dailyLossBudgetLeft);
  $("budgetSub").textContent = `left of ${money(b.dailyLossBudget)} (${rules.maxDailyLossPct}% limit) · max position ${money(b.maxPositionValue)}`;
  $("budgetBar").firstElementChild.style.width = `${Math.min(100, frac * 100)}%`;
  $("budgetBar").classList.toggle("hot", frac >= 0.75);

  // account
  if (s.account) {
    const a = s.account;
    $("equity").textContent = money(a.equity);
    $("pnl").innerHTML = `<span class="${a.todayPnl >= 0 ? "pos" : "neg"}">${signed(a.todayPnl)}</span> today · cash ${money(a.cash)}`;
    $("acctMode").textContent = "simulated";
    $("positions").innerHTML = a.positions.map((p) => `<tr><td class="mono">${esc(p.symbol)}</td><td class="num">${p.qty}</td><td class="num">${p.avg.toFixed(2)}</td><td class="num">${p.price.toFixed(2)}</td><td class="num ${p.unrealized >= 0 ? "pos" : "neg"}">${signed(p.unrealized)}</td><td class="num">${((p.value / a.equity) * 100).toFixed(1)}%</td></tr>`).join("");
    $("pEmpty").hidden = a.positions.length > 0;
  } else {
    $("equity").textContent = "Robinhood"; $("pnl").textContent = st.note ?? ""; $("acctMode").textContent = "relay";
    $("positions").innerHTML = ""; $("pEmpty").hidden = false; $("pEmpty").textContent = "Positions live in your Robinhood account.";
  }

  // pending approvals
  $("pendingCard").hidden = s.pending.length === 0;
  $("pendCount").textContent = s.pending.length ? `${s.pending.length}` : "";
  $("pendList").innerHTML = s.pending.map((p) => {
    const o = p.order, left = Math.max(0, Math.round((p.expires - Date.now()) / 1000));
    return `<div class="pend"><div class="what">${esc(o.side.toUpperCase())} ${o.qty} ${esc(o.symbol)}<small>${o.limit ? `limit ${o.limit} · ` : ""}at ~${o.price} · passed all rules · ${left}s left</small></div>
      <button class="btn no" data-id="${p.id}" data-d="reject">Reject</button><button class="btn ok" data-id="${p.id}" data-d="approve">Approve</button></div>`;
  }).join("");

  // journal
  $("journal").innerHTML = s.journal.map((j) => {
    const o = j.order || {};
    const what = `${esc((o.side || "").toUpperCase())} ${o.qty ?? ""} ${esc(o.symbol || "")}${j.fill ? ` @ ${j.fill.price}${j.fill.pnl ? ` · <span class="${j.fill.pnl >= 0 ? "pos" : "neg"}">${signed(j.fill.pnl)}</span>` : ""}` : ""}`;
    return `<tr><td class="mono">${time(j.t)}</td><td><span class="v ${esc(j.verdict)}">${esc(j.verdict.replace("_", " "))}</span></td><td>${what}${j.reason ? `<div class="reason">${esc(j.reason)}</div>` : ""}</td></tr>`;
  }).join("");
  $("jEmpty").hidden = s.journal.length > 0;
  $("jCount").textContent = s.journal.length ? `${s.journal.length} latest` : "";

  // rules form (don't overwrite what the human is typing)
  if (!formDirty) {
    const f = $("rules").elements;
    for (const k of ["maxDailyLossPct", "maxPositionPct", "revengeWindowMin", "maxBuysPerDay", "approval", "approvalTimeoutSec"]) f[k].value = rules[k];
    f.losses.value = rules.lossStreak.losses; f.cooldownMin.value = rules.lossStreak.cooldownMin;
  }
}

async function tick() {
  try { render(await (await fetch("/api/state", { cache: "no-store" })).json()); $("live").classList.remove("off"); }
  catch { $("live").classList.add("off"); }
}
tick(); setInterval(tick, 1500);

$("kill").onclick = async () => { await post("/api/kill", { on: !last?.status.rules.killSwitch }); tick(); };
$("pendList").onclick = async (e) => {
  const b = e.target.closest("button[data-id]"); if (!b) return;
  b.disabled = true; try { await post("/api/decide", { id: b.dataset.id, decision: b.dataset.d }); } catch (err) { alert(err.message); } tick();
};
$("rules").oninput = () => { formDirty = true; $("msg").textContent = "Unsaved changes"; $("msg").className = "msg"; };
$("save").onclick = async () => {
  const f = $("rules").elements;
  try {
    await post("/api/rules", { maxDailyLossPct: f.maxDailyLossPct.value, maxPositionPct: f.maxPositionPct.value, revengeWindowMin: f.revengeWindowMin.value, maxBuysPerDay: f.maxBuysPerDay.value, approval: f.approval.value, approvalTimeoutSec: f.approvalTimeoutSec.value, lossStreak: { losses: f.losses.value, cooldownMin: f.cooldownMin.value } });
    formDirty = false; $("msg").textContent = "Saved. Brakeline uses the new rules on the next order."; $("msg").className = "msg"; tick();
  } catch (err) { $("msg").textContent = err.message; $("msg").className = "msg err"; }
};
$("reset").onclick = async () => { if (confirm("Reset the simulated account to $100,000 and clear the journal?")) { await post("/api/reset", {}); tick(); } };
