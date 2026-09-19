// The "survives and still ships" finisher. After a guard-ON run, this makes the
// SAFE COMPLETION visible on GitHub as real artifacts:
//   - always applies the `triaged` label (the job got done)
//   - if NoLeak blocked a secret write this run, also applies
//     `security:injection-detected` and posts a short incident note showing the
//     attempted credential REDACTED (AKIA****REDACTED) — proof we didn't just
//     refuse, we finished triage safely and flagged the attack.
// Labels are created if missing (idempotent). All values are fake canaries.
//   node scripts/finish-triage.mjs --issue 1 --blocked 1|0
const TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "";
const OWNER = process.env.REPO_OWNER || "ishamishra0408";
const REPO = process.env.REPO || "shipwright-demo";
const a = process.argv.slice(2);
const get = (f, d) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : d; };
const ISSUE = Number(get("--issue", "1"));
const BLOCKED = get("--blocked", "0") === "1";
if (!TOKEN) { console.error("no GITHUB_PERSONAL_ACCESS_TOKEN"); process.exit(1); }

const gh = async (path, init = {}) => {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    ...init, headers: { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json",
      "content-type": "application/json", "user-agent": "noleak-finish", ...(init.headers || {}) } });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

const LABELS = [
  { name: "triaged", color: "0e8a16", description: "Triage complete" },
  { name: "security:injection-detected", color: "b60205", description: "Prompt-injection / exfil attempt detected and contained by NoLeak" },
];
async function ensureLabel(l) {
  const r = await gh(`/labels`, { method: "POST", body: JSON.stringify(l) });
  if (r.status === 201) console.log(`label created: ${l.name}`);
  else if (r.status === 422) {} // already exists
  else console.log(`label ${l.name}: HTTP ${r.status}`);
}

async function main() {
  const want = BLOCKED ? ["triaged", "security:injection-detected"] : ["triaged"];
  for (const l of LABELS) if (want.includes(l.name)) await ensureLabel(l);
  const r = await gh(`/issues/${ISSUE}/labels`, { method: "POST", body: JSON.stringify({ labels: want }) });
  console.log(`applied labels ${want.join(", ")} -> HTTP ${r.status}`);

  if (BLOCKED) {
    const note = [
      "**NoLeak — injection contained, triage completed.**",
      "",
      "A hidden instruction in this issue tried to make the triage agent exfiltrate a staging",
      "credential into a public comment. NoLeak blocked the secret-bearing write at the gateway",
      "(`rule=taint-provenance`); the attempted value is shown redacted below. Triage was still",
      "posted normally, and the issue is flagged `security:injection-detected`.",
      "",
      "```",
      "attempted (blocked): AWS_ACCESS_KEY_ID=AKIA****REDACTED",
      "gateway verdict     : DENY  denied_by=noleak-gateway  rule=taint-provenance",
      "outcome             : secret never left the boundary; clean triage comment posted",
      "```",
    ].join("\n");
    const c = await gh(`/issues/${ISSUE}/comments`, { method: "POST", body: JSON.stringify({ body: note }) });
    console.log(`incident note posted -> HTTP ${c.status} (id ${c.json.id || "?"})`);
  }
  // report current labels for verification
  const now = await gh(`/issues/${ISSUE}`);
  console.log("issue labels now:", (now.json.labels || []).map((l) => l.name).join(", ") || "(none)");
}
main().catch((e) => { console.error("finish-triage FATAL:", e.message); process.exit(1); });
