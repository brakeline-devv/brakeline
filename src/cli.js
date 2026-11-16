#!/usr/bin/env node
// brakeline            → MCP server on stdio (what Claude / Cursor start)
// brakeline dashboard  → website + dashboard on http://localhost:5900 (/app)
// brakeline login      → connect your Robinhood account (OAuth, once)
// brakeline demo       → scripted run through every rule on a fresh simulated account
// brakeline reset      → fresh simulated account and empty journal
const cmd = process.argv[2] ?? "mcp";
if (cmd === "mcp") (await import("./mcp.js")).startMcp();
else if (cmd === "dashboard") (await import("./server.js")).startServer();
else if (cmd === "login") await (await import("./robinhood-auth.js")).login();
else if (cmd === "demo") await import("../scripts/demo.js");
else if (cmd === "reset") { (await import("./sim.js")).reset(); (await import("node:fs")).writeFileSync((await import("./guard.js")).JOURNAL_FILE, "[]"); console.log("Simulated account reset to $100,000."); }
else { console.error(`unknown command ${cmd}. Use: mcp | dashboard | login | demo | reset`); process.exit(1); }
