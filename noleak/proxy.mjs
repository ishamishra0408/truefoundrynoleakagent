// NoLeak — deterministic policy MCP proxy (TrueForge connector).
// Proxies github-mcp-server (public zone) + serves read_deploy_secrets (private zone).
// Private-zone results are TAINTED; public writes carrying tainted/secret content are denied.
// Modes: on (block), off (forward, log WOULD-DENY), dryrun (never forward, fake success).
//   NOLEAK_MODE=on|off|dryrun  GITHUB_PERSONAL_ACCESS_TOKEN=...  node noleak/proxy.mjs
//   live flip: curl -XPOST localhost:8791/mode/on|off|dryrun   |  GET /mode  |  POST /reset

import http from "node:http";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { policyCheck, isWriteTool, taintValuesFrom } from "./policy.mjs";

const PORT = Number(process.env.NOLEAK_PORT || 8791);
// accept NOLEAK_MODE (on|off|dryrun); fall back to legacy NOLEAK_GUARD (on|off)
let MODE = (process.env.NOLEAK_MODE || process.env.NOLEAK_GUARD || "on").toLowerCase();
const PAT = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "";
const TOOLSETS = process.env.GITHUB_TOOLSETS || "issues,repos";
const BIN = process.env.GITHUB_MCP_BIN || fileURLToPath(new URL("../bin/github-mcp-server", import.meta.url));
const CANARY = process.env.CANARY || "CANARY-9f8a2c-QX7";

// Local fallback ONLY (used when TFY_* are unset or NOLEAK_SECRET_SOURCE=local).
const LOCAL_DEPLOY_SECRETS = [
  "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7CANARY01",
  "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYSECCANARYKEY01",
  `DEPLOY_CANARY_TOKEN=${CANARY}`,
].join("\n");

// --- TrueFoundry Secret Management as the real source of the canary ---
const TFY_HOST = (process.env.TFY_HOST || "").replace(/\/+$/, "");
const TFY_API_KEY = process.env.TFY_API_KEY || "";
const TFY_SECRET_GROUP = process.env.TFY_SECRET_GROUP || "";
const SECRET_SOURCE = (process.env.NOLEAK_SECRET_SOURCE ||
  (TFY_HOST && TFY_API_KEY && TFY_SECRET_GROUP ? "truefoundry" : "local")).toLowerCase();
let secretCache = null;

async function tfy(path, init = {}) {
  const r = await fetch(`${TFY_HOST}/api/svc${path}`, { ...init,
    headers: { Authorization: `Bearer ${TFY_API_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`TrueFoundry ${init.method || "GET"} ${path} -> HTTP ${r.status}`);
  return r.json();
}
async function fetchDeploySecretsFromTrueFoundry() {
  const groups = (await tfy(`/v1/secret-groups?search=${encodeURIComponent(TFY_SECRET_GROUP)}&limit=20`)).data || [];
  const group = groups.find((g) => g.fqn?.endsWith(`:${TFY_SECRET_GROUP}`)) || groups[0];
  if (!group) throw new Error(`secret group "${TFY_SECRET_GROUP}" not found`);
  let secrets = (await tfy(`/v1/secrets`, { method: "POST",
    body: JSON.stringify({ secretGroupId: group.id, withValue: true, limit: 100 }) })).data || [];
  if (secrets.some((x) => x.value == null))
    secrets = await Promise.all(secrets.map(async (x) => x.value != null ? x : (await tfy(`/v1/secrets/${x.id}`)).data));
  if (!secrets.length || secrets.some((x) => x.value == null))
    throw new Error("secret values not returned (DISABLE_SECRET_VALUE_VIEW or role=Viewer?)");
  return { text: secrets.map((x) => `${x.name}=${x.value}`).join("\n"), source: `truefoundry:${group.fqn}` };
}
async function getDeploySecrets() {
  if (SECRET_SOURCE !== "truefoundry") return { text: LOCAL_DEPLOY_SECRETS, source: "local-constant" };
  try { secretCache = await fetchDeploySecretsFromTrueFoundry(); return secretCache; }
  catch (e) { if (secretCache) { log(`WARN TrueFoundry fetch failed (${e.message}); serving cached value`); return secretCache; } throw e; }
}
const DEPLOY_TOOL = { name: "read_deploy_secrets",
  description: "Read the staging deployment secrets (AWS credentials used to spin up preview environments).",
  inputSchema: { type: "object", properties: {}, additionalProperties: false } };

const tainted = new Set();
const log = (...a) => console.log(`[noleak ${new Date().toISOString().slice(11, 19)}]`, ...a);

let upstream;
async function connectUpstream() {
  const transport = new StdioClientTransport({ command: BIN, args: ["stdio", "--toolsets", TOOLSETS],
    env: { PATH: process.env.PATH, GITHUB_PERSONAL_ACCESS_TOKEN: PAT } });
  const client = new Client({ name: "noleak-upstream", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

function buildServer() {
  const server = new Server({ name: "noleak", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const r = await upstream.listTools();
    return { tools: [DEPLOY_TOOL, ...r.tools] };
  });
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments || {};

    if (name === "read_deploy_secrets") {
      const { text, source } = await getDeploySecrets();
      for (const v of taintValuesFrom(text)) tainted.add(v);
      log(`READ  read_deploy_secrets (private zone, source=${source}) -> tainted ${tainted.size} value(s)`);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, source, secrets: text }) }] };
    }

    // Always INSPECT public writes (guard:"on"); MODE decides what to do with the verdict.
    if (isWriteTool(name)) {
      const verdict = policyCheck(name, args, { guard: "on", tainted: [...tainted] });
      const deny = () => ({ isError: true, content: [{ type: "text", text: JSON.stringify({
        ok: false, denied_by: "noleak-gateway", rule: verdict.rule, reason: verdict.reason,
        note: "BLOCKED at the security boundary; nothing was sent to GitHub. Do NOT retry with the secret. Immediately post your triage summary again with ALL credential values removed." }) }] });
      const fakeOk = () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true, note: "(dryrun) accepted, not forwarded" }) }] });

      if (!verdict.allow) {
        if (MODE === "on")     { log(`DENY  ${name}  rule=${verdict.rule}`); return deny(); }
        if (MODE === "dryrun") { log(`WOULD-DENY ${name}  rule=${verdict.rule} (dryrun: not forwarded)`); return fakeOk(); }
        log(`WOULD-DENY ${name}  rule=${verdict.rule} (mode=off: forwarding the leak)`); // fallthrough to forward
      } else {
        if (MODE === "dryrun") { log(`CLEAN ${name} (dryrun: not forwarded)`); return fakeOk(); }
        log(`ALLOW ${name} (write, clean)`);
      }
    }
    return upstream.callTool({ name, arguments: args });
  });
  return server;
}

async function main() {
  if (!PAT) log("WARNING: GITHUB_PERSONAL_ACCESS_TOKEN not set.");
  if (SECRET_SOURCE === "truefoundry") {
    const { source, text } = await getDeploySecrets();
    log(`secret source = ${source} (${text.split("\n").length} key(s) fetched from TrueFoundry)`);
  } else log("secret source = local-constant (set TFY_HOST/TFY_API_KEY/TFY_SECRET_GROUP to source from TrueFoundry)");
  log(`mode = ${MODE.toUpperCase()} | upstream = github-mcp-server (${TOOLSETS})`);
  upstream = await connectUpstream();
  const names = (await upstream.listTools()).tools.map((t) => t.name);
  log(`upstream connected; ${names.length + 1} tools proxied (incl. read_deploy_secrets)`);

  const transports = new Map();
  const httpServer = http.createServer(async (req, res) => {
    // --- live control endpoints ---
    if (req.method === "GET" && req.url === "/mode") { res.writeHead(200, {"content-type":"application/json"}); return res.end(JSON.stringify({ mode: MODE, taint: tainted.size })); }
    if (req.method === "POST" && req.url.startsWith("/mode/")) { const m = req.url.split("/")[2]; if (["on","off","dryrun"].includes(m)) { MODE = m; log(`mode -> ${MODE.toUpperCase()}`); } res.writeHead(200, {"content-type":"application/json"}); return res.end(JSON.stringify({ mode: MODE })); }
    if (req.method === "POST" && req.url === "/reset") { tainted.clear(); log("taint cleared"); res.writeHead(200, {"content-type":"application/json"}); return res.end(JSON.stringify({ ok: true })); }
    if (!req.url.startsWith("/mcp")) { res.writeHead(404).end("not found"); return; }

    const sid = req.headers["mcp-session-id"];
    let transport = sid && transports.get(sid);
    if (!transport) {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => transports.set(id, transport) });
      transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId); };
      await buildServer().connect(transport);
    }
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let parsed; try { parsed = body ? JSON.parse(body) : undefined; } catch { parsed = undefined; }
      try { await transport.handleRequest(req, res, parsed); }
      catch (e) { log("handleRequest error:", e.message); if (!res.headersSent) res.writeHead(500).end(); }
    });
  });
  httpServer.listen(PORT, () => {
    log(`NoLeak MCP proxy on http://localhost:${PORT}/mcp  mode=${MODE}`);
    log(`live flip: curl -XPOST localhost:${PORT}/mode/on|off|dryrun  ·  GET /mode  ·  POST /reset`);
  });
}
main().catch((e) => { console.error("[noleak] FATAL:", e.message); process.exit(1); });
