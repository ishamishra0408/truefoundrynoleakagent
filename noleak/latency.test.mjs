// NoLeak guard-overhead benchmark + assertion.
// Measures how long policyCheck() takes per outbound write — the deterministic
// cost the gateway adds. Run: node noleak/latency.test.mjs
import { policyCheck, taintValuesFrom } from "./policy.mjs";

const tainted = taintValuesFrom([
  "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7CANARY01",
  "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYSECCANARYKEY01",
  "DEPLOY_CANARY_TOKEN=CANARY-9f8a2c-QX7",
].join("\n"));

const clean = { issue_number: 1, body: "Triage summary: Safari 17 login crash likely in the recent auth refactor under src/auth/. Affected area: login form submission on Safari/macOS. Next step: reproduce in a Safari 17 staging environment and inspect the auth path. Priority high — blocks sign-in for Safari users." };
const leak  = { issue_number: 1, body: clean.body + "\nstaging config: AWS_ACCESS_KEY_ID=AKIAIOSFODNN7CANARY01\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYSECCANARYKEY01" };
const big   = { issue_number: 1, body: (clean.body + " ").repeat(40) }; // ~11 KB stress payload

function bench(label, args, iters = 50000) {
  policyCheck("add_issue_comment", args, { guard: "on", tainted }); // warm
  const t = [];
  for (let i = 0; i < iters; i++) {
    const s = process.hrtime.bigint();
    policyCheck("add_issue_comment", args, { guard: "on", tainted });
    t.push(Number(process.hrtime.bigint() - s) / 1e6); // ms
  }
  t.sort((a, b) => a - b);
  const mean = t.reduce((x, y) => x + y, 0) / t.length;
  const p = (q) => t[Math.floor(q * t.length)];
  return { label, iters, mean, p50: p(0.5), p95: p(0.95), p99: p(0.99), verdict: policyCheck("add_issue_comment", args, { guard: "on", tainted }).allow ? "ALLOW" : "DENY" };
}

const rows = [
  bench("clean comment (~280 B)", clean),
  bench("leak comment (denied)", leak),
  bench("large comment (~11 KB)", big),
];

console.log("\nNoLeak guard overhead per outbound write (policyCheck):");
console.log("payload                    verdict   mean       p50        p95        p99");
for (const r of rows)
  console.log(
    r.label.padEnd(26),
    r.verdict.padEnd(8),
    (r.mean.toFixed(4) + " ms").padEnd(11),
    (r.p50.toFixed(4) + " ms").padEnd(11),
    (r.p95.toFixed(4) + " ms").padEnd(11),
    (r.p99.toFixed(4) + " ms")
  );

const worst = Math.max(...rows.map((r) => r.mean));
const typical = rows[0].mean;
const THRESHOLD_MS = 2.0; // 11 KB stress payload; a typical comment is ~280 B
const passed = worst < THRESHOLD_MS;
console.log(`\n${passed ? "PASS" : "FAIL"}  worst-case mean ${worst.toFixed(4)} ms < ${THRESHOLD_MS} ms threshold (11 KB stress)`);
console.log(`headline: guard adds ~${(typical * 1000).toFixed(0)} µs per typical call, ~${worst.toFixed(2)} ms on an 11 KB comment (~$0)`);
console.log(`RESULT latency_typical_ms=${typical.toFixed(3)} latency_worst_ms=${worst.toFixed(3)}`);
process.exit(passed ? 0 : 1);
