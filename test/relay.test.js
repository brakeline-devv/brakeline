// Robinhood-mode relay against a fake broker MCP server (same transport as agent.robinhood.com/mcp/trading).
// Checks: read tools pass, order tools are checked, unknown tools are refused, cancels pass, dollar orders are sized.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { classifyTool } from "../src/classify.js";

// ── classification ──────────────────────────────────────────────────────────
test("tool classification fails closed", () => {
  const k = (name, props = [], annotations) => classifyTool({ name, annotations, inputSchema: { properties: Object.fromEntries(props.map((p) => [p, {}])) } }, {}).kind;
  assert.equal(k("get_portfolio"), "read");
  assert.equal(k("list_orders"), "read");
  assert.equal(k("place_equity_order", ["symbol", "quantity"]), "order");
  assert.equal(k("submit_order"), "order");
  assert.equal(k("buy"), "order");
  assert.equal(k("cancel_order"), "cancel");
  assert.equal(k("cancel_and_replace_order"), "order");
  assert.equal(k("transfer_funds", ["amount"]), "block");
  assert.equal(k("do_thing"), "block");
  assert.equal(k("market_snapshot", [], { readOnlyHint: true }), "read");
  assert.equal(k("innocent_helper", ["ticker", "shares"], { readOnlyHint: true }), "order"); // order-shaped beats the hint
  assert.equal(classifyTool({ name: "do_thing" }, { BRAKELINE_ALLOW_TOOLS: "do_thing" }).kind, "read");
});

// ── relay end to end ────────────────────────────────────────────────────────
let http, client, home, upstreamCalls = [];
const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { err: !!r.isError, text: r.content[0].text }; };

before(async () => {
  http = createServer(async (req, res) => {
    const s = new McpServer({ name: "fake-broker", version: "1" });
    const ok = (name) => async (a) => { upstreamCalls.push({ name, a }); return { content: [{ type: "text", text: `${name} ok` }] }; };
    s.tool("get_portfolio", "Portfolio", {}, ok("get_portfolio"));
    s.tool("place_equity_order", "Place an order", { symbol: z.string(), side: z.string(), quantity: z.number().optional(), limit_price: z.number().optional(), dollar_amount: z.number().optional() }, ok("place_equity_order"));
    s.tool("cancel_order", "Cancel", { order_id: z.string() }, ok("cancel_order"));
    s.tool("transfer_funds", "Move money", { amount: z.number() }, ok("transfer_funds"));
    const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { t.close(); s.close(); });
    await s.connect(t);
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => t.handleRequest(req, res, body ? JSON.parse(body) : undefined));
  }).listen(0, "127.0.0.1");
  await new Promise((r) => http.once("listening", r));
  home = mkdtempSync(join(tmpdir(), "brakeline-test-"));
  client = new Client({ name: "test", version: "1" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL("../src/cli.js", import.meta.url))],
    env: { ...process.env, BRAKELINE_HOME: home, BRAKELINE_MODE: "robinhood", BRAKELINE_UPSTREAM_URL: `http://127.0.0.1:${http.address().port}/mcp`, ROBINHOOD_MCP_TOKEN: "test", BRAKELINE_EQUITY: "10000" },
  }));
});
after(async () => { await client?.close(); http?.close(); rmSync(home, { recursive: true, force: true }); });

test("relay lists the broker's tools with Brakeline tags", async () => {
  const tools = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t.description]));
  assert.ok(tools.guard_status && tools.get_journal);
  assert.match(tools.place_equity_order, /Checked by Brakeline/);
  assert.match(tools.transfer_funds, /Blocked by Brakeline/);
});

test("read tools pass through", async () => {
  assert.equal((await call("get_portfolio")).text, "get_portfolio ok");
});

test("unknown tools are refused and never reach the broker", async () => {
  const n = upstreamCalls.length, r = await call("transfer_funds", { amount: 5000 });
  assert.ok(r.err); assert.match(r.text, /BLOCKED/); assert.equal(upstreamCalls.length, n);
});

test("orders are checked: too big blocked, in-limit forwarded, market buy without price refused", async () => {
  const big = await call("place_equity_order", { symbol: "NVDA", side: "buy", quantity: 10, limit_price: 180 }); // $1,800 = 18%
  assert.ok(big.err); assert.match(big.text, /position_size/);
  const okBuy = await call("place_equity_order", { symbol: "NVDA", side: "buy", quantity: 2, limit_price: 180 }); // $360 = 3.6%
  assert.equal(okBuy.text, "place_equity_order ok");
  const market = await call("place_equity_order", { symbol: "NVDA", side: "buy", quantity: 1 });
  assert.ok(market.err); assert.match(market.text, /limit price/);
});

test("dollar orders are sized by the dollar amount", async () => {
  const r = await call("place_equity_order", { symbol: "AAPL", side: "buy", dollar_amount: 2000 }); // 20%
  assert.ok(r.err); assert.match(r.text, /position_size/);
});

test("revenge rule works from the forwarded-order ledger", async () => {
  assert.equal((await call("place_equity_order", { symbol: "TSLA", side: "buy", quantity: 1, limit_price: 300 })).err, false);
  assert.equal((await call("place_equity_order", { symbol: "TSLA", side: "sell", quantity: 1, limit_price: 280 })).err, false); // -20 loss
  const again = await call("place_equity_order", { symbol: "TSLA", side: "buy", quantity: 1, limit_price: 280 });
  assert.ok(again.err); assert.match(again.text, /revenge_trade/);
});

test("cancels pass through", async () => {
  assert.equal((await call("cancel_order", { order_id: "x" })).text, "cancel_order ok");
});

test("guard_status reports how each broker tool is handled", async () => {
  const s = JSON.parse((await call("guard_status")).text);
  assert.deepEqual(s.brokerTools, { get_portfolio: "read", place_equity_order: "order", cancel_order: "cancel", transfer_funds: "block" });
});
