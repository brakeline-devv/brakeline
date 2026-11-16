// Brakeline MCP server (stdio). The agent connects ONLY to Brakeline; Brakeline owns the broker connection,
// so no order can skip the risk rules.
//   BRAKELINE_MODE=sim        (default) simulated $100k account, real starting prices, no broker needed
//   BRAKELINE_MODE=robinhood  relay to Robinhood's hosted trading MCP; order tools are checked first
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as guard from "./guard.js";
import { SYMBOLS, seedPrices } from "./sim.js";
import { classifyTool } from "./classify.js";

export async function startMcp() {
  const MODE = (process.env.BRAKELINE_MODE || "sim").toLowerCase();
  const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });
  const fail = (m) => ({ isError: true, content: [{ type: "text", text: m }] });
  const obj = (properties = {}, required = []) => ({ type: "object", properties, required });
  const ORDER = obj({
    symbol: { type: "string", description: `Ticker. Simulated: ${SYMBOLS.join(", ")}` },
    side: { type: "string", enum: ["buy", "sell"] },
    qty: { type: "integer", minimum: 1, description: "Whole shares" },
    limit_price: { type: "number", description: "Optional limit price. Without it the order is a market order." },
  }, ["symbol", "side", "qty"]);

  const OWN = [
    { name: "guard_status", description: "Brakeline's current risk rules, whether new buys are allowed right now (kill switch, cooldowns), which rules are tripped, the remaining daily loss budget, and whether orders need the human's approval in the dashboard. Call this before planning trades.", inputSchema: obj(), run: () => (MODE === "sim" ? guard.status() : { ...guard.relayStatus(), brokerTools: Object.fromEntries([...kinds].map(([n, k]) => [n, k.kind])) }) },
    { name: "get_journal", description: "Recent orders Brakeline allowed, blocked or the human rejected, with the reason for each.", inputSchema: obj({ limit: { type: "integer", minimum: 1, maximum: 200 } }), run: (a) => guard.journal(a.limit ?? 20) },
  ];
  const SIM = [
    { name: "get_account", description: "Simulated account: cash, equity, today's P&L, positions and the remaining risk budget.", inputSchema: obj(), run: () => guard.simAccount() },
    { name: "get_quote", description: "Latest simulated price for a ticker.", inputSchema: obj({ symbol: { type: "string" } }, ["symbol"]), run: (a) => guard.simQuote(a.symbol) },
    { name: "check_order", description: "Dry-run an order against the risk rules without placing it. Returns every check with its numbers, and the max size allowed.", inputSchema: ORDER, run: (a) => guard.simCheck(a) },
    { name: "place_order", description: "Place an order. Brakeline checks the risk rules first and BLOCKS the order if any rule fails (the reason is returned). If the human turned on dashboard approval, this waits until they approve or reject it. Selling to reduce a position is always allowed by the rules.", inputSchema: ORDER, run: (a) => guard.simPlace(a) },
  ];

  // ── Robinhood relay ───────────────────────────────────────────────────────
  let upstream = null, upstreamTools = [];
  const kinds = new Map(); // tool name → {kind, why}
  async function connectUpstream() {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const { FileAuthProvider, UPSTREAM_URL } = await import("./robinhood-auth.js");
    const token = process.env.ROBINHOOD_MCP_TOKEN;
    const opts = token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : { authProvider: new FileAuthProvider() };
    upstream = new Client({ name: "brakeline", version: "0.2.0" });
    await upstream.connect(new StreamableHTTPClientTransport(new URL(UPSTREAM_URL), opts));
    upstreamTools = (await upstream.listTools()).tools;
    for (const t of upstreamTools) kinds.set(t.name, classifyTool(t));
  }
  const TAG = { order: "[Checked by Brakeline risk rules]", block: "[Blocked by Brakeline: unknown tool, ask the human to allow it]" };

  const server = new Server({ name: "brakeline", version: "0.2.0" }, { capabilities: { tools: {} } });
  const local = () => [...OWN, ...(MODE === "sim" ? SIM : [])];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...local().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      ...upstreamTools.map((t) => { const k = kinds.get(t.name)?.kind; return TAG[k] ? { ...t, description: `${TAG[k]} ${t.description ?? ""}` } : t; })],
  }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args = {} } }) => {
    try {
      const own = local().find((t) => t.name === name);
      if (own) return text(await own.run(args));
      if (!upstream || !upstreamTools.some((t) => t.name === name)) return fail(`Unknown tool ${name}`);
      const kind = kinds.get(name)?.kind ?? "block";
      if (kind === "block") {
        guard.log({ mode: "robinhood", tool: name, order: args, verdict: "BLOCKED", reason: "unknown broker tool" });
        return fail(`BLOCKED by Brakeline — "${name}" is not a known read, cancel or order tool, so it is refused. The human can allow it with BRAKELINE_ALLOW_TOOLS=${name} (read-only) or BRAKELINE_ORDER_TOOLS_LIST=${name} (check as an order).`);
      }
      if (kind === "order") {
        const v = await guard.relayGate(name, args);
        if (!v.allowed) {
          guard.log({ mode: "robinhood", tool: name, order: v.order ?? args, verdict: v.rejected ? "REJECTED" : "BLOCKED", reason: v.reason });
          return fail(`${v.rejected ? "REJECTED" : "BLOCKED"} by Brakeline — ${v.reason}`);
        }
        const r = await upstream.callTool({ name, arguments: args });
        guard.log({ mode: "robinhood", tool: name, order: v.order, verdict: r.isError ? "BROKER_ERROR" : "FORWARDED" });
        return r;
      }
      return await upstream.callTool({ name, arguments: args });
    } catch (e) { return fail(String(e.message ?? e)); }
  });

  if (MODE === "robinhood") await connectUpstream();
  else seedPrices().catch(() => {}); // real starting prices, best effort, in the background
  await server.connect(new StdioServerTransport());
}
