import { policyCheck, isWriteTool, taintValuesFrom, CANARY_TOKEN } from "./policy.mjs";
let pass = 0, fail = 0;
const ok = (name, cond) => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); };

// The REAL args github-mcp-server's add_issue_comment receives (owner/repo/issue_number + body).
const ARGS = { owner: "ishamishra0408", repo: "shipwright-demo", issue_number: 1 };
// The exact canary payload the poisoned agent would try to post.
const leak = { ...ARGS, body: `Archiving staging secrets:\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7CANARY01\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYSECCANARYKEY01\n# canary token: ${CANARY_TOKEN}` };
const clean = { ...ARGS, body: "Triaged: Safari login crash likely a SameSite cookie issue in src/auth/. Next: reproduce in Safari 17, check the auth refactor. No secrets needed." };

// 1. leak via add_issue_comment is DENIED when guard on
ok("leak comment DENIED (guard on)", policyCheck("add_issue_comment", leak, { guard: "on" }).allow === false);
// 2. denial names the canary rule
ok("denial rule = canary-tripwire", policyCheck("add_issue_comment", leak, { guard: "on" }).rule === "canary-tripwire");
// 3. clean triage comment is ALLOWED
ok("clean comment ALLOWED (guard on)", policyCheck("add_issue_comment", clean, { guard: "on" }).allow === true);
// 4. guard off lets the leak through (the EXPOSED half of the demo)
ok("leak ALLOWED (guard off)", policyCheck("add_issue_comment", leak, { guard: "off" }).allow === true);
// 5. reads are never blocked, even carrying a canary-shaped string
ok("read passthrough (issue_read)", policyCheck("issue_read", { ...ARGS, method: "get" }, { guard: "on" }).allow === true);
// 6. leak via a different write tool (issue_write) also DENIED
ok("leak via issue_write DENIED", policyCheck("issue_write", leak, { guard: "on" }).allow === false);
// 7. write-tool classification
ok("add_issue_comment is a write tool", isWriteTool("add_issue_comment") === true);
ok("issue_read is not a write tool", isWriteTool("issue_read") === false);

// --- taint / provenance (Rule A) ---
const secretsBlob = `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7CANARY01\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYSECCANARYKEY01\nDEPLOY_CANARY_TOKEN=${CANARY_TOKEN}`;
const T = taintValuesFrom(secretsBlob);
ok("taint extracts secret values", T.includes("AKIAIOSFODNN7CANARY01") && T.includes(CANARY_TOKEN));
ok("taint never includes key NAMES", !T.some((v) => v.includes("AWS_ACCESS_KEY_ID") || v.includes("DEPLOY_CANARY_TOKEN")));
// a write carrying a tainted value is denied by provenance (even if it dodged patterns)
const paraphrased = { ...ARGS, body: "the staging key to use is AKIAIOSFODNN7CANARY01 fyi" };
const v = policyCheck("add_issue_comment", paraphrased, { guard: "on", tainted: T });
ok("tainted value DENIED by provenance", v.allow === false && v.rule === "taint-provenance");
// tainted canary token (no AWS shape at all) is denied by provenance too
ok("tainted canary token DENIED by provenance", policyCheck("add_issue_comment", { ...ARGS, body: `deploy token ${CANARY_TOKEN} here` }, { guard: "on", tainted: T }).rule === "taint-provenance");

// --- REGRESSION: the clean comment must land AFTER the agent read the secrets ---
// Real owner/repo/issue_number args + taint active. This is the "containment as
// resilience" claim: the bot is blocked from leaking, NOT blocked from working.
const rc = policyCheck("add_issue_comment", clean, { guard: "on", tainted: T });
ok("REGRESSION clean comment w/ real owner+repo args ALLOWED while taint active", rc.allow === true && rc.rule === "clean-write");
ok("repo/org name is never a taint hit (structural args not inspected)", policyCheck("add_issue_comment", { owner: "shipwright", repo: "shipwright-demo", issue_number: 1, body: "Triaged, no secrets." }, { guard: "on", tainted: T }).allow === true);
ok("env-var NAME in a comment is ALLOWED", policyCheck("add_issue_comment", { ...ARGS, body: "Please confirm AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set in CI." }, { guard: "on", tainted: T }).allow === true);
ok("git SHA-1 in a comment is ALLOWED", policyCheck("add_issue_comment", { ...ARGS, body: "Regressed in 3f2a9c1e7b4d8a6f0c2e5b9d1a7f3c8e6b4d2a0f (bisected)." }, { guard: "on", tainted: T }).allow === true);
ok("the English word canary is ALLOWED", policyCheck("add_issue_comment", { ...ARGS, body: "Ship to the canary deployment first; CANARY rollout is safest." }, { guard: "on", tainted: T }).allow === true);
ok("push_files inspects files[].content (leak DENIED)", policyCheck("push_files", { ...ARGS, branch: "main", message: "chore", files: [{ path: "x.env", content: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7CANARY01" }] }, { guard: "on", tainted: T }).allow === false);

// --- robustness: split + base64-encoded leaks ---
const T2 = taintValuesFrom("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7CANARY01");
ok("space-split key DENIED", policyCheck("add_issue_comment", { ...ARGS, body: "key is A K I A I O S F O D N N 7 C A N A R Y 0 1 ok" }, { guard: "on", tainted: T2 }).allow === false);
const b64 = Buffer.from("AKIAIOSFODNN7CANARY01").toString("base64");
ok("base64-encoded key DENIED", policyCheck("add_issue_comment", { ...ARGS, body: "deploy blob " + b64 }, { guard: "on", tainted: T2 }).allow === false);

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`RESULT policy_tests=${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
