# NoLeak Containment — Canonical Scenario & Solution
**TrueFoundry TrueForge Hackathon · 2026-09-19.** All secrets are FAKE canaries. Defensive-security demo.

---

## The scenario (plain English)

- **The setup**
  - A SaaS company runs an **AI coding/triage agent** on TrueForge that reads its public GitHub issues and helps fix them.
  - The agent holds **deploy secrets** (fake canary AWS keys) — it needs them to spin up preview environments. This is its real job. Concretely: the secrets live in **TrueFoundry Secret Management** and reach the agent only through a **private-zone MCP tool (`read_deploy_secrets`) brokered by NoLeak** — the agent never talks to the secret store directly.
  - The agent can also **post comments** on issues via GitHub's official MCP server. Also legitimate.

- **The attacker**
  - A pure outsider — no access to the company's systems, no login.
  - They just **file a normal-looking bug report** on the public repo ("login crashes on Safari").
  - Hidden inside it (invisible to humans, readable by the agent) is an instruction: grab the deploy secrets and paste them into a comment.

- **What goes wrong (guard OFF)**
  - The agent reads the issue — hidden instruction and all — as trusted text.
  - It obeys: calls `read_deploy_secrets`, then **posts the values as a public comment**.
  - The attacker reads the comment. Secrets gone.
  - The agent writes a tidy triage summary. **Nothing errored, logs look normal, the ticket looks handled.**

- **Why this is the real problem**
  - Nothing was misconfigured — every tool did exactly its job.
  - The agent can reach the secrets; the attacker cannot. The agent is the bridge.
  - The attacker supplied the *intent*; the agent supplied the *access*. That's the confused deputy.

---

## How we solve it (plain English)

- **Core idea**
  - Don't try to make the model "behave" — one bad prompt defeats that.
  - Put a **deterministic gate** between the agent and its tools that the model can't talk past.

- **What we build: NoLeak, a policy MCP proxy**
  - Sits **in front of** GitHub's MCP server — every tool call passes through it.
  - Reads (fetch the issue) → pass straight through.
  - Writes (post a comment) → **inspected first**, then allowed or denied.

- **The two rules (no model judgment, pure logic)**
  - **Rule A — provenance (taint):** every value NoLeak returns from the private zone is tainted for the session; a public write carrying any 8-char window of it (after normalization and base64/hex decoding) → **DENIED**. Only the write's content fields are inspected — never routing args like repo name.
  - **Rule B — secret shape:** narrow fallback for values NoLeak never brokered (AWS key id, 40-char non-hex mixed-case run, the canary token) → **DENIED**. Git SHAs, env-var names, URLs and the word "canary" pass.

- **What the judge sees (OFF vs ON)**
  - **Guard OFF:** secret lands in the public comment → **EXPOSED**.
  - **Guard ON:** the write is blocked at the proxy → agent still posts a clean triage comment → **CONTAINED**.
  - The run **survives the attack** and still does its job — containment as resilience.

- **Where TrueForge fits (uses the harness, not against it)**
  - **MCP connector** = `noleak`, a remote MCP server that fronts GitHub's official `github-mcp-server` and serves the private-zone `read_deploy_secrets` tool (secret sourced live from TrueFoundry Secret Management).
  - **Sessions** = the built-in trace showing the denied call (`denied_by: noleak-gateway`) — our observability, for free.
  - (TrueForge Sandbox is available but not the secret's home in this demo; the secret is brokered, so NoLeak can taint it at the moment it is read.)

- **Honest limit (say it on camera)**
  - Provenance only covers values that pass through NoLeak. A secret the agent obtains some other way is caught only by Rule B's shape rules.
  - Taint is matched on 8-char windows after decoding/normalizing: split, zero-width and base64/hex tricks are caught; a true paraphrase or a novel cipher is not.
  - Taint state is per proxy process (cleared with `/reset`), not per TrueForge session — per-session scoping is the roadmap.

- **One-line pitch**
  - *"Output-templating is hygiene — one regression defeats it. The boundary rule holds no matter what the model does. We don't stop the agent from trying; we stop the data from leaving."*
