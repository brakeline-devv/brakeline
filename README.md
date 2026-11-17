# Brakeline

**Every order checked first.** · [Website](https://brakeline.trade) · [npm](https://www.npmjs.com/package/brakeline) · [X](https://x.com/brakelinetrade)

Brakeline is a risk guardrail for AI trading agents: an MCP server that sits between
your agent (Claude, Cursor, any MCP client) and your broker, and checks every order against your rules before it can go through.

```
Claude / Cursor  →  Brakeline rules (+ your approval)  →  Broker (simulation or Robinhood)
```

A guardrail MCP server running *next to* a broker MCP can only advise: the agent can still call the broker's order tool
directly. Brakeline is a **proxy**. The agent connects only to Brakeline, and Brakeline holds the broker connection, so the
rules are enforced, not suggested.

## Features

- **Five risk rules and a kill switch** (below), with the numbers in every reply: today's loss, the position's share of equity, minutes left on a cooldown, the largest size allowed.
- **Selling is never blocked.** Rules only stop orders that add risk, so you can always get out.
- **The agent can't change the rules.** It has no tool for it. You change them in the dashboard.
- **Optional approval:** every order that passes the rules waits for your Approve / Reject click in the dashboard.
- **Local dashboard** with the kill switch, the loss budget, positions and a journal of every order and why it was allowed or stopped.
- **Simulation mode** with a $100,000 account that starts from real closing prices, so you can try it without a broker account.

## Quick start

Needs Node 20 or newer. Published on npm as [`brakeline`](https://www.npmjs.com/package/brakeline).

```
claude mcp add brakeline -- npx -y brakeline     # Claude Code
npx brakeline dashboard                          # dashboard on localhost:5900/app
```

From source:

```
git clone https://github.com/brakeline-devv/brakeline.git
cd brakeline
npm install
npm run demo      # scripted run through every rule
npm start         # website http://localhost:5900 and dashboard http://localhost:5900/app
```

Add the MCP server to your AI app:

**Claude Code**
```
claude mcp add brakeline -- npx -y brakeline
```
(from a clone: `claude mcp add brakeline -- node /path/to/brakeline/src/cli.js`)

**Claude Desktop / Cursor** (`mcpServers` in the config file)
```json
"brakeline": { "command": "npx", "args": ["-y", "brakeline"] }
```

Then ask your agent something like *"Buy 500 HOOD"* and watch it get stopped, or *"What's the most HOOD I can buy?"*

### Tools

| Tool | What it does |
|---|---|
| `guard_status` | Current rules, whether buys are allowed right now, which rules are tripped, remaining loss budget |
| `get_account` | Simulated cash, equity, today's P&L, positions |
| `get_quote` | Latest simulated price |
| `check_order` | Dry run: every check with its numbers, without placing anything |
| `place_order` | Checks the rules, waits for your approval if enabled, then places the order |
| `get_journal` | Recent orders with their verdict and reason |

## Rules

Edit them in the dashboard (or `data/rules.json`). They apply from the next order.

| Rule | Blocks a buy when… | Default |
|---|---|---|
| `kill_switch` | you pressed **Pause all buys** | off |
| `daily_loss_limit` | today's loss reached the limit | 3% of start-of-day equity |
| `position_size` | the position would exceed the cap after the buy | 5% of equity · 30% for broad funds (SPY, VOO, VTI, QQQ, DIA, IWM, BND, AGG, TLT, GLD…) |
| `revenge_trade` | you re-buy a stock soon after selling it at a loss | 15 minutes |
| `max_buys_per_day` | you hit the daily buy count | 10 |
| `loss_streak_cooldown` | your last exits were all losses | 3 losses → 60 min pause |

`approval`: `client` (the AI app's own permission prompt, default) or `dashboard` (each passing order waits for your click,
90 s timeout).

## Modes

### Simulation (default)

Simulated $100,000 account. Prices start from the latest real close (fetched once a day, built-in levels if offline) and
move between quotes. Symbols: AAPL, MSFT, NVDA, TSLA, AMZN, GOOGL, META, AMD, PLTR, COIN, HOOD and the funds SPY, QQQ, VTI, BND, GLD.
Market and limit orders (limit orders are immediate-or-cancel). `npm run reset` starts over.

### Robinhood (experimental)

Relays Robinhood's hosted trading MCP (`agent.robinhood.com/mcp/trading`).

```
npm run login                                   # Robinhood's own sign-in (OAuth + PKCE), once
BRAKELINE_MODE=robinhood BRAKELINE_EQUITY=25000 node src/cli.js
```

Brakeline sorts every Robinhood tool and **fails closed**:

| Kind | How it's recognised | What happens |
|---|---|---|
| read | declares `readOnlyHint`, or name starts with get / list / search / view… | passes through |
| cancel | name contains "cancel" | passes through (never adds risk) |
| order | name looks like an order, **or** its inputs have a symbol and a size | checked against the rules first |
| unknown | anything else | **refused**, never reaches Robinhood |

`guard_status` shows how each Robinhood tool was classified. To let a refused tool through, set
`BRAKELINE_ALLOW_TOOLS=name1,name2` (read-only) or `BRAKELINE_ORDER_TOOLS_LIST=name` (check it as an order).

P&L is estimated from the orders Brakeline forwarded (it assumes they filled at the price sent). Buys need a limit price or
a dollar amount, and orders it can't read are refused. The relay is tested against a fake broker MCP server
(`test/relay.test.js`) but **not yet against a live Robinhood account.**

## Commands

| | |
|---|---|
| `npx brakeline` | MCP server on stdio (what your AI app starts) |
| `npx brakeline dashboard` | Website + dashboard, when installed from npm |
| `npm start` | Website + dashboard on `localhost:5900` |
| `npm run login` | Connect Robinhood |
| `npm run demo` | Scripted run through every rule (puts your rules back afterwards) |
| `npm run reset` | Fresh simulated account, empty journal |
| `npm test` | Rule engine tests + Robinhood-mode relay tests against a fake broker |

## Project layout

```
src/rules.js            rule engine (pure functions)
src/classify.js         sorts broker tools into read / cancel / order / blocked
src/guard.js            checks, approvals, journal, Robinhood ledger
src/sim.js              simulated broker
src/mcp.js              MCP server
src/robinhood-auth.js   Robinhood OAuth
src/server.js           website, dashboard and local API
src/cli.js              command line entry
web/                    website (index.html, config.js) and dashboard (app.html, app.js)
data/rules.json         default rules
test/                   tests
```

## Where state lives

Rules, journal, simulated account and Robinhood login are kept in `./data` when you run from a clone, and in
`~/.brakeline` when installed from npm (so they survive updates). Set `BRAKELINE_HOME` to use another folder.

## Security notes

- The dashboard and its API listen on `127.0.0.1` only, and refuse requests sent from other websites.
- Robinhood tokens are stored in `robinhood-auth.json` in the state folder (git-ignored). Keep that file private.
- An agent with shell access (for example Claude Code) can still edit files on your computer, including the rules.
  For hard separation, run Brakeline with an AI app that has no shell, such as Claude Desktop.

## Disclaimer

Brakeline is an independent project, not affiliated with or endorsed by Robinhood. It is a risk tool, not investment
advice. Use it at your own risk.

## License

MIT
