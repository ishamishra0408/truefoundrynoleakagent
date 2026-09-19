// NoLeak Control Plane — a LIVE view over the REAL system. No re-enactment.
//  - /events (SSE) tails the REAL proxy log at $PLOG (every DENY shown is emitted
//    by the actual policy engine in noleak/proxy.mjs).
//  - /mode + /mode/:m proxy to the REAL proxy control endpoints (localhost:8791).
//  - /run/attack spawns the REAL noleak/attack.mjs; /run/agent spawns the REAL
//    scripts/run-agent.mjs (a real TrueForge session). The page animates from the
//    proxy log lines those runs produce — nothing is hardcoded.
//
//   node control-plane/server.mjs      then open http://localhost:8799
import express from "express";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.CP_PORT || 8799);
const PROXY = process.env.NOLEAK_URL_BASE || "http://localhost:8791";
const PLOG = process.env.PLOG || "/tmp/claude-501/noleak-proxy.log";

// load .env so spawned scripts get the model key / PAT / TFY creds
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// ---- real proxy control (proxied verbatim) ----
const px = async (p, method = "GET") => {
  const r = await fetch(`${PROXY}${p}`, { method });
  return { status: r.status, text: await r.text() };
};
app.get("/mode", async (_q, res) => { try { const r = await px("/mode"); res.type("json").send(r.text); } catch (e) { res.status(502).json({ error: String(e) }); } });
app.post("/mode/:m", async (q, res) => { try { const r = await px(`/mode/${q.params.m}`, "POST"); res.type("json").send(r.text); } catch (e) { res.status(502).json({ error: String(e) }); } });
app.post("/reset", async (_q, res) => { try { const r = await px("/reset", "POST"); res.type("json").send(r.text); } catch (e) { res.status(502).json({ error: String(e) }); } });

// ---- SSE: tail the REAL proxy log ----
const clients = new Set();
app.get("/events", (req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(": connected\n\n");
  // backlog: last ~18 lines so a fresh page has context
  try {
    const lines = fs.readFileSync(PLOG, "utf8").trim().split(/\r?\n/).slice(-18);
    for (const l of lines) res.write(`data: ${JSON.stringify({ backlog: true, line: l })}\n\n`);
  } catch {}
  clients.add(res);
  req.on("close", () => clients.delete(res));
});
const emit = (line) => { const p = `data: ${JSON.stringify({ line })}\n\n`; for (const c of clients) c.write(p); };
// incremental tail
let offset = 0;
try { offset = fs.statSync(PLOG).size; } catch {}
setInterval(() => {
  let sz; try { sz = fs.statSync(PLOG).size; } catch { return; }
  if (sz < offset) offset = 0;            // rotated/truncated
  if (sz === offset) return;
  const fd = fs.openSync(PLOG, "r");
  const buf = Buffer.alloc(sz - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  offset = sz;
  for (const l of buf.toString("utf8").split(/\r?\n/)) if (l.trim()) emit(l);
}, 350);

// ---- trigger REAL runs ----
function run(script, args, res) {
  const child = spawn("node", [script, ...args], { cwd: ROOT, env: process.env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  child.on("close", (code) => res.json({ ok: code === 0, code, tail: out.slice(-1200) }));
}
app.post("/run/attack", (q, res) => run("noleak/attack.mjs", q.body?.body ? [q.body.body] : [], res));
app.post("/run/agent", (_q, res) => run("scripts/run-agent.mjs", [], res));
app.post("/run/finish", (q, res) => run("scripts/finish-triage.mjs", ["--issue", "1", "--blocked", q.body?.blocked ? "1" : "0"], res));

// real guard-overhead measurement (times the actual policyCheck, not a constant)
app.get("/bench", async (_q, res) => {
  try {
    const { policyCheck, taintValuesFrom } = await import("../noleak/policy.mjs");
    const tainted = taintValuesFrom("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7CANARY01\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYSECCANARYKEY01");
    const args = { owner: "o", repo: "r", issue_number: 1, body: "Triaged: Safari login crash in src/auth/, reproduce on staging. No secrets." };
    for (let i = 0; i < 2000; i++) policyCheck("add_issue_comment", args, { guard: "on", tainted }); // warm
    const N = 20000, t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) policyCheck("add_issue_comment", args, { guard: "on", tainted });
    const us = Number(process.hrtime.bigint() - t0) / 1e3 / N;
    res.json({ us: Number(us.toFixed(2)) });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.listen(PORT, () => {
  console.log(`[control-plane] http://localhost:${PORT}  (proxy=${PROXY}, log=${PLOG})`);
});
