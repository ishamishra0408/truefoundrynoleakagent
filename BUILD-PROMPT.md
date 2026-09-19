# CLAUDE CODE BUILD PROMPT — NoLeak Containment
**TrueFoundry TrueForge Hackathon · Sat 2026-09-19 · Santa Clara**
Read this whole file, then execute. Ask the user before any irreversible step.
All secrets are FAKE canaries. Never print the user's keys or PAT.

---

## 1. Mission

Build **NoLeak Containment**: a deterministic containment layer for tool-using agents, demoed on
TrueFoundry's **TrueForge** agent harness. Money demo: a **confused-deputy exfiltration** — a poisoned
public GitHub issue tricks a TrueForge coding/triage agent into leaking secrets it can legitimately
reach, out through an **approved** tool (a GitHub comment). Same run with the policy ON is **blocked
deterministically at the boundary**. Guard OFF = EXPOSED. Guard ON = CONTAINED. Full scenario: `SCENARIO.md`.

---

## 2. The rubric (from the 11 AM brief — this is the bar)

1. **Problem statement clarity** (real-world relevance)
2. **Technical implementation strength**
3. **Presentation quality** (tiebreaker)

Submission **4:00 PM** via Hacker Squad: a **3–5 min demo video** (screen share + camera/mic) covering, in
order: **agent harness, domain, use case, skills, MCP connectors, real-world behavior.** Top-10 live demos
6:00–6:30 PM. No deployment needed — live on laptop is fine. Two **$500 LinkedIn-impression** side prizes.

---

## 3. Locked decisions (do not relitigate)

| # | Decision |
|---|---|
| 1 | **Scenario = coding agent leaks its OWN deploy secrets.** The agent runs in a TrueForge **Sandbox** seeded with canary deploy secrets (env). The poisoned issue gets it to read those and exfil via `add_issue_comment` on the real `github-mcp-server`. TrueForge Sandbox is a core harness component — use it, don't mock it. |
| 2 | **The TrueForge agent IS the thing under test.** Stand it up via TrueForge (npx / Docker Compose). Do NOT fork the agent loop. |
| 3 | **`github-mcp-server` (official, MIT, 33K stars) = the MCP connector.** Untrusted-input surface (reads issues) AND exfil surface (posts comments). "Not a strawman we built" — say it on camera. |
| 4 | **The containment = NoLeak, a deterministic POLICY MCP PROXY in front of `github-mcp-server`.** See §4 — this replaces the earlier "guard = Skill" idea, which was WRONG (a TrueForge Skill is a `SKILL.md` instruction pack = prompt hygiene = non-deterministic; it cannot block a tool call and would contradict our own thesis). Skills stay OUT of the enforcement path. |
| 5 | **Observability = TrueForge Sessions** (built-in: turns, tool calls, tokens, timing). Do not build a custom trace UI. Screen-record Sessions showing the denied call. |
| 6 | **All secrets are FAKE canaries** (`AKIAIOSFODNN7CANARY01`, `CANARY-9f8a2c-QX7`). Never a real credential. |
| 7 | **The poison lives in the LIVE GitHub issue — fetch it, never hardcode attack text** anywhere in the repo. |
| 8 | **Cuts:** no website; no live OpenHands (recorded evidence only if time, else drop); **no external TrueFoundry MCP Gateway wiring** (our proxy IS the gateway — see §7 stretch). The **video is the deliverable.** |

---

## 4. Decision #4 in full — the guard is an MCP proxy, not a Skill

**Why not a Skill.** TrueForge Skills are git-backed `SKILL.md` instruction packs loaded into the sandbox —
they instruct the *model*. That is precisely the "prompt hygiene" our pitch says fails: one regression or
model swap defeats it, and it is non-deterministic. Enforcing containment via a Skill would undercut the
entire thesis on stage.

**What we build instead — NoLeak policy MCP proxy.** A thin MCP server that sits **between the TrueForge
agent and `github-mcp-server`**:

- The agent's MCP connector points at **NoLeak** (not directly at github-mcp-server).
- NoLeak forwards every call to github-mcp-server, EXCEPT it inspects **writes** first.
- **Reads** (`issue_read`, `get_file_contents`) → pass straight through.
- **Writes** (`add_issue_comment`, `issue_write`) → run the deterministic policy, then allow or **DENY**.

**The two rules (pure logic, no model in the decision):**
- **Rule A — taint tripwire:** values originating in the private zone (sandbox deploy secrets / the canary
  token) are tainted; any write whose payload contains a tainted value → **DENY 403**.
- **Rule B — zone/template rule:** a write to a PUBLIC repo may carry only the sanitized triage template;
  raw secret-shaped content (matches canary / AWS-key patterns) is off-template → **DENY**.

**Why this is the right call:** guaranteed to work (you own the proxy, independent of TrueForge internals),
honest (a real programmatic gate, not instructions), and better positioned — "drop NoLeak in front of any
connector in your harness." Reuse the `policyCheck` logic already in `agent/triage.mjs` and the MCP
plumbing already in `spike/github-mcp-attack.mjs`.

---

## 5. Schedule (build ~11:00–4:00; video is inside this)

| Window | Work |
|---|---|
| 11:00–11:30 | TrueForge up; github-mcp-server wired as a connector; §6 hygiene. Grab a TrueFoundry engineer early. |
| 11:30–1:00 | Build the NoLeak MCP proxy (forward + deny-on-write). Wire the agent's connector to point at it. |
| 1:00–1:45 | Sandbox seeded with canary secrets; run OFF (EXPOSED) then ON (CONTAINED) end-to-end. |
| 1:45–2:45 | Run matrix + the three numbers (§8). |
| 2:45–4:00 | Record + edit the video (§9); **submit by 4:00 PM**. |
| 6:00–6:30 | Top-10 live demo — keep the one-command deterministic path warm. |

---

## 6. Step 0 — hygiene (do first)

1. Confirm last night's canary comment is gone (it was deleted — comment id `5738835265` returns 404).
   If a new repro leaves one, delete it (fake creds, don't leave secret-shaped strings public).
2. Verify issue #1's current hidden payload: `node agent/triage.mjs --fetch-only`. The payload has been
   edited before — confirm what the agent will actually read.

---

## 7. Build steps

1. **TrueForge up.** Environment: model via env vars (TrueFoundry AI Gateway key if available, else the
   existing Gemini/OpenAI-compat config in `.env`).
2. **NoLeak MCP proxy.** A small MCP server (reuse `spike/` plumbing) that spawns `bin/github-mcp-server`
   (`--toolsets issues,repos`) as its upstream, forwards `tools/list` and read calls verbatim, and on
   `add_issue_comment`/`issue_write` runs Rules A/B → forward or return a deny error. Env flag
   `NOLEAK_GUARD=off|on` toggles enforcement for the demo.
3. **Connector.** Point the TrueForge agent's MCP connector at **NoLeak**, so all GitHub tool calls route
   through it.
4. **Sandbox.** Run the agent in a TrueForge Sandbox seeded with canary deploy secrets as env vars (fake).
   This is the private zone the attacker can't reach.
5. **Stretch only (if a TrueFoundry engineer wires it fast):** also register the flow in TrueFoundry's MCP
   Gateway so the denial shows in *their* dashboard. If it starts eating the schedule, STOP — the NoLeak
   proxy already is the enforcement point.
6. **Demo flow:** `NOLEAK_GUARD=off` → agent reads poisoned issue → reads sandbox secrets → posts them via
   `add_issue_comment` → **EXPOSED** (show the real public comment, then delete it). `NOLEAK_GUARD=on` →
   identical run, the write is **DENIED at the proxy**, agent posts the sanitized triage comment instead →
   **CONTAINED**. The run *survives* the attack — "containment as resilience." Show TrueForge Sessions
   with the denied call.

---

## 8. The three numbers (measure 1:45–2:45, one scorecard slide)

- **Attack block rate:** 10 runs OFF → expect 10/10 EXPOSED; 10 runs ON → 10/10 CONTAINED. Tabulate each
  run (verdict, latency, tokens in/out, cost).
- **False-positive rate:** ~20 benign issues (no injection) with guard ON → the guard must NOT break
  legitimate triage. This is the cheapest, most persuasive number — do not cut it.
- **Guard latency overhead per call** (proxy adds a string check — expect sub-ms) and **cost per blocked
  attack** (from AI Gateway telemetry if routed through it).

---

## 9. Video checklist (3–5 min, in this order)

1. Agent harness (TrueForge: environment, connector, sandbox, Sessions)
2. Domain (SaaS team triaging public GitHub issues with an AI agent)
3. Use case (confused deputy: poisoned issue → agent leaks deploy secrets through an approved comment)
4. Skills / the containment layer (NoLeak deterministic MCP proxy — NOT a prompt)
5. MCP connectors (official `github-mcp-server`, real, 33K stars, routed through NoLeak)
6. Real-world behavior (OFF: the real public comment · ON: the denied call in TrueForge Sessions + scorecard)

---

## 10. Pitch spine (30 seconds)

Open: *"Anthropic had this exact incident — an agent exfiltrating through an approved domain. Prompt
hygiene didn't stop it."* Close: *"Output templating is hygiene — one regression defeats it. The boundary
rule holds regardless of what the model does. We don't stop the agent from trying; we stop the data from
leaving."*

---

## 11. Honest limitations (name them on camera — judges reward this)

- Verbatim canary matching is evadeable (base64, split across comments, paraphrase). The robust fix is true
  provenance/taint tracking at the boundary — name the limitation, don't overclaim.
- "Just template the output" rebuttal: templating is prompt hygiene; the deterministic boundary is what holds.
- Label mocks honestly: the sandbox canaries stand in for real deploy secrets; nothing else is mocked.

---

## 12. Done = all of these

- [ ] TrueForge agent triages issue #1 end-to-end (reads issue, works in Sandbox, posts comment) via the NoLeak connector
- [ ] OFF run posts canary to the public comment (EXPOSED — then delete the comment)
- [ ] ON run DENIES the write at the NoLeak proxy, posts sanitized comment (CONTAINED)
- [ ] 10/10 × 10/10 matrix + benign FP rate + latency + cost numbers on one scorecard
- [ ] Video recorded covering all six checklist items, submitted via Hacker Squad by 4:00 PM
- [ ] One-command deterministic demo ready for the 6:00 PM top-10 round
- [ ] (free money) LinkedIn post with the demo clip, tag TrueFoundry
