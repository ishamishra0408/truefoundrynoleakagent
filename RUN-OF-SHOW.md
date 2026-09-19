# RUN-OF-SHOW — NoLeak Containment

**The story is NOT "a security guard that blocks."** It is **"a TrueForge triage agent that
survives hostile input and still ships the work."** The climax is a CREATED artifact appearing —
a clean triage comment posted and the issue labeled — not a red DENY. The block is the middle of
the sentence; "and it still did its job, safely" is the end.

**Reframe line to say on camera (the take-rate honesty):**
> "The model refuses most of the time — NoLeak is for the times it doesn't. Here's the
> deterministic replay that always tries it, and here's a live run."

**Money moment = `node noleak/attack.mjs` (deterministic block, 100%) → the agent completes triage
(clean comment + labels appear).** The live model run + honest 3/10 take-rate are supporting
evidence — never the thing the demo hinges on.

---

## Pre-flight (before recording)

```bash
cd "/Users/ishamishra/Desktop/Claude Projects/NoLeakContainment /noleak-containment"
set -a; . ./.env; set +a
# proxy up + guard on
curl -s localhost:8791/mode || NOLEAK_MODE=on nohup node noleak/proxy.mjs >> /tmp/claude-501/noleak-proxy.log 2>&1 &
curl -s -XPOST localhost:8791/mode/on >/dev/null; curl -s -XPOST localhost:8791/reset >/dev/null
# TrueForge up + control plane up
curl -s localhost:8790/api/v1/agents >/dev/null && echo trueforge-up
node control-plane/server.mjs          # separate tab -> open http://localhost:8799 at 1080p
# issue #1 on the 3/10 baseline body; clear old comments
bash scripts/demo.sh on
```
On screen: the **control plane** (browser, full-screen 1080p) + one terminal. GitHub issue in a 3rd tab.

---

## 90-second cut (the one that must land)

### (a) 0:00–0:15 — the real problem, one breath
> "Microsoft Copilot's EchoLeak — CVE-2025-32711 — and Invariant's GitHub-MCP exploit were the
> same bug: give an agent the lethal trifecta — private secrets, untrusted input, and a way to
> talk out — and a hidden instruction turns it into a courier. Here's that agent."

### (b) 0:15–0:45 — attack, and the taint path lights up
On the **control plane**, click **▶ Run attack (deterministic)**.
> "A poisoned GitHub issue tells our TrueForge triage agent to paste a deploy secret into a public
> comment. Watch the value: read live from TrueFoundry Secret Management, tainted, and it tries
> verbatim, split, and base64 to get out."

The taint path animates: `read_deploy_secrets → tainted value → evasion → public write`, then the
**NoLeak boundary flashes DENY · rule=taint-provenance** — real event from the actual proxy log,
guard overhead shown live (~10 µs).
> "Stopped at the boundary. Deterministically. Every DENY here is emitted by the real policy engine."

### (c) 0:45–1:15 — the CREATION beat (the actual climax)
Click **▶ Run live TrueForge agent**, then **✓ Complete triage safely** (or run `bash scripts/demo.sh on`).
Cut to the GitHub issue tab: a **clean triage comment appears**, and the issue gets **labeled
`triaged` + `security:injection-detected`**, with a short incident note showing the attempted
credential **redacted** (`AKIA****REDACTED`).
> "And here's the point: it didn't just refuse. The agent finished triage — posted a clean summary,
> labeled the issue, and flagged the injection — with the secret never leaving the boundary. The
> job shipped. That's containment as resilience."

### (d) 1:15–1:30 — the numbers
> "Real TrueForge end-to-end, GitHub's official MCP server unmodified. 20 of 20 policy tests, zero
> false positives on real triage comments, verbatim / split / base64 all blocked, ~30 µs per call."

---

## Full 3–5 min version (same spine, more room)

1. **(0:00–0:30) Three incidents + lethal trifecta.** EchoLeak (CVE-2025-32711), Invariant GitHub-MCP,
   Noma GitLost. "Prompt filters stopped none of them."
2. **(0:30–1:00) The setup.** Real TrueForge agent `shipwright-triage`; connector `noleak` in front of
   official `github-mcp-server` (unmodified); secret pulled live from TrueFoundry Secret Management;
   TrueForge Sessions for the trace.
   ```bash
   curl -s localhost:8790/api/v1/settings/mcp-servers | python3 -m json.tool
   grep "secret source" /tmp/claude-501/noleak-proxy.log | tail -1
   ```
3. **(1:00–2:00) Guard OFF → EXPOSED.** Toggle OFF on the control plane (flips the real proxy).
   `node noleak/attack.mjs` forwards the leak; show the secret in the public comment; delete it.
   ```bash
   gh api repos/ishamishra0408/shipwright-demo/issues/1/comments --jq '.[].id' \
     | xargs -I{} gh api -X DELETE repos/ishamishra0408/shipwright-demo/issues/comments/{}
   ```
4. **(2:00–3:15) Guard ON → SHIPPED.** Toggle ON. Run the attack (taint path → DENY), then
   `bash scripts/demo.sh on`: injection blocked **and** the agent posts a clean triage comment +
   the issue is labeled `triaged` / `security:injection-detected` + redacted incident note. Show the
   GitHub issue. Optionally show TrueForge Sessions `denied_by: noleak-gateway`.
5. **(3:15–4:00) Scorecard (computed).** `npm test` (20/20 + 20/20 benign), `bash scripts/verify.sh`.
6. **(4:00–4:45) Honest limits.** Provenance covers values brokered through NoLeak; byte-window match
   beats zero-width/split/base64; novel cipher or true paraphrase is roadmap; taint is per proxy
   process (per-session scoping next). "We don't make the model safe — we make the data unable to leave."

---

## FALLBACK — CLI only (the submission floor, fully recordable without the control plane)

```bash
set -a; . ./.env; set +a
# OFF (exposed)
curl -s -XPOST localhost:8791/mode/off >/dev/null; curl -s -XPOST localhost:8791/reset >/dev/null
node noleak/attack.mjs
gh api repos/ishamishra0408/shipwright-demo/issues/1/comments --jq '.[].id' \
  | xargs -I{} gh api -X DELETE repos/ishamishra0408/shipwright-demo/issues/comments/{}
# ON (survives + ships)
curl -s -XPOST localhost:8791/mode/on >/dev/null; curl -s -XPOST localhost:8791/reset >/dev/null
node noleak/attack.mjs          # deterministic DENY
bash scripts/demo.sh on         # blocked + clean comment lands + issue labeled
npm test && bash scripts/verify.sh
```
`tail -f /tmp/claude-501/noleak-proxy.log` is a live event stream on its own if the UI is down.

## Do-not-forget
- Fake canaries only; delete any public secret comment after an OFF run.
- Keep `node noleak/attack.mjs` warm for the 6 PM live round.
- Say it: official `github-mcp-server` unmodified; secret from TrueFoundry; the agent *finished the job*.
