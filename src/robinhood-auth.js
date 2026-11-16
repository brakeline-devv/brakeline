// OAuth for Robinhood's hosted trading MCP (agent.robinhood.com/mcp/trading).
// The server advertises standard MCP auth: dynamic client registration, PKCE (S256), public client, refresh tokens.
// `brakeline login` runs the browser flow once; the MCP server then reuses and refreshes the saved tokens.
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dataFile } from "./paths.js";

export const UPSTREAM_URL = process.env.BRAKELINE_UPSTREAM_URL || "https://agent.robinhood.com/mcp/trading";
const AUTH_FILE = dataFile("robinhood-auth.json");
const PORT = Number(process.env.BRAKELINE_CALLBACK_PORT || 5901);
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;

const read = () => (existsSync(AUTH_FILE) ? JSON.parse(readFileSync(AUTH_FILE, "utf8")) : {});
const write = (patch) => { writeFileSync(AUTH_FILE, JSON.stringify({ ...read(), ...patch }, null, 2)); try { chmodSync(AUTH_FILE, 0o600); } catch { /* windows */ } };

export class FileAuthProvider {
  constructor({ interactive = false } = {}) { this.interactive = interactive; this.authUrl = null; }
  get redirectUrl() { return REDIRECT; }
  get clientMetadata() {
    return { client_name: "Brakeline", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  }
  clientInformation() { return read().client; }
  saveClientInformation(client) { write({ client }); }
  tokens() { return read().tokens; }
  saveTokens(tokens) { write({ tokens, savedAt: Date.now() }); }
  saveCodeVerifier(v) { write({ verifier: v }); }
  codeVerifier() { const v = read().verifier; if (!v) throw new Error("no PKCE verifier saved"); return v; }
  invalidateCredentials(scope) {
    const d = read();
    if (scope === "all" || scope === "client") delete d.client;
    if (scope === "all" || scope === "tokens") delete d.tokens;
    if (scope === "all" || scope === "verifier") delete d.verifier;
    writeFileSync(AUTH_FILE, JSON.stringify(d, null, 2));
  }
  redirectToAuthorization(url) {
    if (!this.interactive) throw new Error("Robinhood login needed: run `npx brakeline login` (or `npm run login`) once in a terminal.");
    this.authUrl = url;
  }
}

export const hasLogin = () => !!read().tokens;

function openBrowser(url) {
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref(); } catch { /* user opens it manually */ }
}

export async function login() {
  const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");
  const provider = new FileAuthProvider({ interactive: true });
  const first = await auth(provider, { serverUrl: UPSTREAM_URL });
  if (first === "AUTHORIZED") { console.log("Already logged in to Robinhood."); return; }

  const code = new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const c = u.searchParams.get("code"), err = u.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(`<body style="font:16px system-ui;background:#0b0a08;color:#f4efe6;display:grid;place-items:center;height:100vh"><p>${c ? "Brakeline is connected to Robinhood. You can close this tab." : "Login failed: " + (err ?? "no code")}</p></body>`);
      srv.close();
      c ? resolve(c) : reject(new Error(err ?? "no authorization code"));
    }).listen(PORT, "127.0.0.1");
    setTimeout(() => { srv.close(); reject(new Error("login timed out after 5 minutes")); }, 300_000).unref();
  });
  console.log("Opening Robinhood in your browser. If nothing opens, visit:\n" + provider.authUrl);
  openBrowser(provider.authUrl.toString());
  const got = await code;
  const done = await auth(provider, { serverUrl: UPSTREAM_URL, authorizationCode: got });
  console.log(done === "AUTHORIZED" ? "Logged in. Tokens saved to data/robinhood-auth.json (keep this file private)." : "Login did not complete.");
}
