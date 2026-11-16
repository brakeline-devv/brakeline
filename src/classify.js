// Sorts the broker's MCP tools into what Brakeline does with them. Fail closed: anything it can't classify is blocked.
//   read   → passes through (tool says readOnlyHint, or its name starts with get/list/search/…)
//   cancel → passes through (cancelling an order never adds risk)
//   order  → checked against the rules first (name looks like an order, OR its inputs look like one)
//   block  → refused until the human allows it with BRAKELINE_ALLOW_TOOLS
const READ_NAME = /^(get|list|search|view|fetch|read|lookup|find|describe|show|check|history|quote|quotes)([_\-.]|$)/i;
const CANCEL_NAME = /cancel/i;
const ORDER_NAME = /(place|submit|create|send|new|execute|open)[_\-.]?.*order|^(buy|sell|trade)([_\-.]|$)|order[_\-.]?(place|submit|create)/i;
const ORDER_FIELDS = { symbol: ["symbol", "ticker", "instrument", "instrument_id", "asset", "security"], size: ["quantity", "qty", "shares", "notional", "amount", "dollar_amount", "dollars"] };

const list = (env) => (env || "").split(",").map((s) => s.trim()).filter(Boolean);

export function classifyTool(tool, env = process.env) {
  const name = tool.name ?? "";
  if (list(env.BRAKELINE_ALLOW_TOOLS).includes(name)) return { kind: "read", why: "allowed by BRAKELINE_ALLOW_TOOLS" };
  if (list(env.BRAKELINE_ORDER_TOOLS_LIST).includes(name)) return { kind: "order", why: "listed in BRAKELINE_ORDER_TOOLS_LIST" };
  const props = Object.keys(tool.inputSchema?.properties ?? {}).map((p) => p.toLowerCase());
  const looksLikeOrder = ORDER_FIELDS.symbol.some((f) => props.includes(f)) && ORDER_FIELDS.size.some((f) => props.includes(f));
  if (CANCEL_NAME.test(name) && !/replace|modify|amend/i.test(name)) return { kind: "cancel", why: "cancelling never adds risk" };
  if (ORDER_NAME.test(name) || /replace|modify|amend/i.test(name)) return { kind: "order", why: "name looks like an order tool" };
  // an order-shaped tool is checked even if it calls itself read-only or has an innocent name
  if (looksLikeOrder) return { kind: "order", why: "inputs look like an order (symbol + size)" };
  if (tool.annotations?.readOnlyHint === true) return { kind: "read", why: "tool declares readOnlyHint" };
  if (READ_NAME.test(name)) return { kind: "read", why: "name looks read-only" };
  return { kind: "block", why: "unknown tool: blocked until you allow it (BRAKELINE_ALLOW_TOOLS)" };
}
