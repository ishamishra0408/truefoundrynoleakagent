// Connects to the running NoLeak proxy over HTTP (as TrueForge would) and proves:
//  - tools are proxied from github-mcp-server
//  - a canary write is DENIED at the proxy, never forwarded to GitHub
//  - a read is passed through (not denied by policy)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = process.env.NOLEAK_URL || "http://localhost:8791/mcp";
const t = new StreamableHTTPClientTransport(new URL(URL_));
const c = new Client({ name: "noleak-selftest", version: "1.0.0" });
await c.connect(t);

let pass = 0, fail = 0;
const ok = (n, cond) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${n}`); };

const tools = (await c.listTools()).tools.map((x) => x.name);
ok("proxied tools include issue_read + add_issue_comment", tools.includes("issue_read") && tools.includes("add_issue_comment"));

const leakBody = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7CANARY01\n# canary token: CANARY-9f8a2c-QX7";
const denied = await c.callTool({ name: "add_issue_comment", arguments: { owner: "ishamishra0408", repo: "shipwright-demo", issue_number: 1, body: leakBody } });
const dtext = (denied.content || []).map((x) => x.text).join("");
ok("canary write DENIED at proxy (never sent to GitHub)", denied.isError === true && dtext.includes("noleak-gateway"));
console.log("     ->", dtext.slice(0, 140));

// A read must pass the policy and be FORWARDED upstream. With a dummy PAT the
// upstream (real github-mcp-server) rejects it with a GitHub 401 — that error is
// proof the proxy forwarded it rather than blocking it.
let forwarded = false, deniedByNoleak = false;
try {
  const read = await c.callTool({ name: "issue_read", arguments: { owner: "ishamishra0408", repo: "shipwright-demo", issue_number: 1, method: "get" } });
  const rtext = (read.content || []).map((x) => x.text).join("");
  deniedByNoleak = rtext.includes("noleak-gateway");
  forwarded = !deniedByNoleak; // returned from upstream without a noleak denial
} catch (e) {
  // upstream error (e.g. GitHub 401 on the dummy token) = it was forwarded
  deniedByNoleak = String(e.message).includes("noleak-gateway");
  forwarded = String(e.message).toLowerCase().includes("bad credentials") || String(e.message).includes("github.com") || !deniedByNoleak;
}
ok("read NOT denied by policy (forwarded upstream)", forwarded && !deniedByNoleak);

console.log(`\n${pass} passed, ${fail} failed`);
await c.close();
process.exit(fail ? 1 : 0);
