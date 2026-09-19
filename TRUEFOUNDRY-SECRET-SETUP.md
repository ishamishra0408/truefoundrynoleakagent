# TrueFoundry-sourced canary secret for NoLeak — feasibility + runbook

Date: 2026-09-19. Scope: replace the hardcoded `DEPLOY_SECRETS` constant in
`noleak/proxy.mjs` (lines 26-30) with a canary that NoLeak fetches at runtime from
TrueFoundry cloud Secret Management. Canary values only; nothing real is stored.

---

## 1. Feasibility verdict: **YES** (runtime value read-back is a documented API)

TrueFoundry's control-plane API returns secret **values**, not just keys, to an
authenticated caller with sufficient role. Three documented paths:

| Path | Method | Returns value? | Doc |
|---|---|---|---|
| List secrets (filter by group id or FQNs) | `POST {host}/api/svc/v1/secrets` body `{"secretGroupId": "...", "withValue": true}` | Yes, `data[].value` when `withValue=true` | https://www.truefoundry.com/docs/api-reference/secrets/list-secrets |
| Get one secret by id | `GET {host}/api/svc/v1/secrets/{id}` | Yes, `data.value` | https://www.truefoundry.com/docs/api-reference/secrets/get-a-secret |
| Python SDK | `client.secrets.get(id=...)` / `client.secrets.list(with_value=True)` | Yes | https://www.truefoundry.com/docs/truefoundry_sdk/secrets |

The SDK reference for `secret_groups.create` states explicitly: "A separate API call
to `/v1/secrets/{id}` should be made to fetch the associated secret value"
(https://www.truefoundry.com/docs/truefoundry_sdk/secret_groups). So read-back is the
intended consumption path for programmatic clients, not a loophole.

Conditions under which value read-back is refused (both documented):

- Control plane has `DISABLE_SECRET_VALUE_VIEW` set → `403 "Secret value viewing is
  disabled on this control plane"` (list-secrets doc) / `value: null` (get-secret doc).
  Hosted trial tenants are not documented as setting this; verify with the one-line
  curl in section 3.3 before writing any code.
- Caller's role on the secret group is **Secret Group Viewer** (keys only). Use
  **Editor** or **Admin**, or a PAT of the tenant admin (PAT inherits the user's
  permissions). Roles: https://www.truefoundry.com/docs/manage-secrets

Auth for every call: `Authorization: Bearer <TFY_API_KEY>` where the key is a Personal
Access Token or a Virtual Account token
(https://www.truefoundry.com/docs/generating-truefoundry-api-keys).

Not needed / not used: `tfy-secret://` references and env-var injection. Those are for
TrueFoundry-*deployed* workloads; NoLeak runs on the laptop, so the API is the right
mechanism. (The fallback in section 6 covers the injection-only case anyway.)

### The single biggest blocker: a secret-store integration must exist

A secret group is created against an `integrationId` (POST) / `integration_fqn` (PUT).
TrueFoundry stores only references; values live in a backing store.

- The API doc shows the default `integration_fqn` =
  `internal:aws:aws-1:secret-store:internal-secret-store`
  (https://www.truefoundry.com/docs/apply-api-secret-management), which strongly
  implies TrueFoundry-hosted control planes ship a built-in store.
- The UI doc for connecting a store lists only AWS SSM / GCP Secret Manager /
  HashiCorp Vault and does not mention a default
  (https://www.truefoundry.com/docs/integrations-secret-store).

So: **check step 3.1 first.** If the "Create Secret Group" dialog offers a store (or
`GET /api/svc/v1/integrations`-style listing shows one), the whole thing is ~45 min.
If the tenant has no store and demands AWS/GCP/Vault credentials, that is cloud
onboarding under deadline pressure → NO-GO, use the local-vault fallback (section 6).

---

## 2. What the user must provide (and where each plugs in)

| Item | Example / format | Where it goes |
|---|---|---|
| Control-plane URL (`TFY_HOST`) | `https://<org>.truefoundry.cloud` (no trailing slash, no `/api/svc`) | `.env` → read by `noleak/proxy.mjs` |
| API key (`TFY_API_KEY`) | PAT from Access > Personal Access Tokens (or a Virtual Account token) | `.env` only. Never printed, never committed (`.env` is gitignored). |
| Secret group name (`TFY_SECRET_GROUP`) | `shipwright-staging-deploy` | `.env` → proxy resolves it to the group id via the search API |

That is the full list. No secret FQN needs to be hand-copied: the proxy resolves
group name → group id → secret values, so the user never has to guess the FQN
format (docs show two different formats, `tenant:group/name` and
`tfy-secret://user:group:name`; avoiding the FQN sidesteps that ambiguity).

---

## 3. Runbook — USER side (TrueFoundry UI / account)

Estimated 20-30 min if a secret store already exists.

### 3.1 Confirm a secret store exists (decides go/no-go)

1. Log in to `https://<org>.truefoundry.cloud`.
2. Left sidebar → **Integrations** → **Secret Store** tab.
3. If at least one store is listed (any name; on hosted tenants expect something
   like `internal-secret-store`), continue. Note its name.
4. If the tab is empty and the only option is **Connect Secret Store** with
   AWS / GCP / Vault forms → stop, see section 6 (no-go for the cloud path).

### 3.2 Create the secret group with the canary values

Via UI (preferred, no token needed yet):

1. Sidebar → **Secrets** (the Secret Management page; docs:
   https://www.truefoundry.com/docs/manage-secrets).
2. **New Secret Group** → Name: `shipwright-staging-deploy`. Select the secret store
   from 3.1 if asked.
3. Add three secrets (Key / Value) — these MUST match the values already used by the
   tests and scenario, otherwise `selftest.mjs`, `attack.mjs`, `policy.test.mjs` and
   `scripts/demo.sh` (which greps `AKIA|CANARY`) stop agreeing with the proxy:

   | Key | Value (canary, fake) |
   |---|---|
   | `AWS_ACCESS_KEY_ID` | `AKIAIOSFODNN7CANARY01` |
   | `AWS_SECRET_ACCESS_KEY` | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYSECCANARYKEY01` |
   | `DEPLOY_CANARY_TOKEN` | `CANARY-9f8a2c-QX7` |

4. Save.

Via API instead (if the UI is slow), after 3.3 gives you a token — first find the
integration id, then create the group:

```bash
# 1. integration id of the secret store (look for the store from 3.1 in the output)
curl -s "$TFY_HOST/api/svc/v1/secret-groups?limit=1" -H "Authorization: Bearer $TFY_API_KEY" | head -c 400
# (any existing group's "integrationId" is the store id; if there are no groups, copy the
#  id from Integrations > Secret Store > the store's detail/URL)

# 2. create the group with the canaries (doc: api-reference/secret-groups/create-a-secret-group)
curl -s -X POST "$TFY_HOST/api/svc/v1/secret-groups" \
  -H "Authorization: Bearer $TFY_API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"shipwright-staging-deploy","integrationId":"<INTEGRATION_ID>","secrets":[
    {"key":"AWS_ACCESS_KEY_ID","value":"AKIAIOSFODNN7CANARY01"},
    {"key":"AWS_SECRET_ACCESS_KEY","value":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYSECCANARYKEY01"},
    {"key":"DEPLOY_CANARY_TOKEN","value":"CANARY-9f8a2c-QX7"}]}'
```

### 3.3 Create the API token and verify value read-back (the make-or-break check)

1. Sidebar → **Access** → **Personal Access Tokens** → **New Personal Access Token**.
   Name `noleak-demo`, expiry ≥ tomorrow, no team needed. Copy the token once; the UI
   will not show it again (doc: generating-truefoundry-api-keys).
   (Alternative with least privilege: **Access > Virtual Accounts** → new account →
   Manage Permissions → grant the secret group with role Secret Group Editor →
   Get Token. Viewer is NOT enough — it hides values.)
2. Put it in `.env` (never on the command line history, never in chat):
   ```
   TFY_HOST=https://<org>.truefoundry.cloud
   TFY_API_KEY=<paste>
   TFY_SECRET_GROUP=shipwright-staging-deploy
   ```
3. Verify — this one command decides YES vs fallback. It prints only key names and
   whether a value came back, never the token:
   ```bash
   set -a; . ./.env; set +a
   GID=$(curl -s "$TFY_HOST/api/svc/v1/secret-groups?search=shipwright-staging-deploy&limit=5" \
        -H "Authorization: Bearer $TFY_API_KEY" | node -e '
        let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const g=JSON.parse(s).data
        .find(x=>x.fqn.endsWith(":shipwright-staging-deploy"))||JSON.parse(s).data[0];console.log(g.id)})')
   curl -s -X POST "$TFY_HOST/api/svc/v1/secrets" \
     -H "Authorization: Bearer $TFY_API_KEY" -H "Content-Type: application/json" \
     -d "{\"secretGroupId\":\"$GID\",\"withValue\":true,\"limit\":100}" | node -e '
     let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
     if(!j.data){console.log("ERROR:",s.slice(0,200));process.exit(1)}
     for(const x of j.data)console.log(x.name, x.value?"value=OK("+x.value.length+" chars)":"value=NULL")})'
   ```
   Expected: three lines, each `value=OK(...)`. If you see `value=NULL` or a 403
   "Secret value viewing is disabled", the tenant blocks read-back → section 6.

---

## 4. Runbook — CODE side (`noleak/proxy.mjs`)

Estimated 15 min to apply + 10 min to test. Do not apply until 3.3 passes.

Design:
- New env: `TFY_HOST`, `TFY_API_KEY`, `TFY_SECRET_GROUP`. All three present → source
  is TrueFoundry. Any missing → fall back to the local constant with a loud WARNING
  (the demo never dies because of a missing cloud var). `NOLEAK_SECRET_SOURCE=local`
  forces the old behaviour even if the vars exist.
- Fetch happens **inside the `read_deploy_secrets` handler** every call (live
  provenance: the log line shows the value came from TrueFoundry at that moment).
  After the first success the result is cached so a mid-demo network blip cannot
  break the pitch; a preflight fetch at startup fails fast if creds are wrong.
- Output format is unchanged (`KEY=value\n...`), so `taintValuesFrom` in
  `policy.mjs` taints exactly the same values and every existing test/scenario is
  untouched. The only visible addition is a `source` field in the tool result
  (e.g. `"truefoundry:<tenant>:shipwright-staging-deploy"`), which is a nice
  narrative beat and is not sensitive.
- The API key is used only in the `Authorization` header and is never logged.

### 4.1 Diff for `noleak/proxy.mjs`

```diff
@@ line 24
 const CANARY = process.env.CANARY || "CANARY-9f8a2c-QX7";

-const DEPLOY_SECRETS = [
+// Local fallback ONLY (used when TFY_* are unset or NOLEAK_SECRET_SOURCE=local).
+const LOCAL_DEPLOY_SECRETS = [
   "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7CANARY01",
   "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYSECCANARYKEY01",
   `DEPLOY_CANARY_TOKEN=${CANARY}`,
 ].join("\n");
+
+// --- TrueFoundry Secret Management as the real source of the canary ---------
+// Docs: api-reference/secret-groups/list-secret-groups (GET ?search=),
+//       api-reference/secrets/list-secrets (POST {secretGroupId, withValue:true}),
+//       api-reference/secrets/get-a-secret (GET /secrets/{id}) as per-secret fallback.
+const TFY_HOST = (process.env.TFY_HOST || "").replace(/\/+$/, "");
+const TFY_API_KEY = process.env.TFY_API_KEY || "";
+const TFY_SECRET_GROUP = process.env.TFY_SECRET_GROUP || "";
+const SECRET_SOURCE = (process.env.NOLEAK_SECRET_SOURCE ||
+  (TFY_HOST && TFY_API_KEY && TFY_SECRET_GROUP ? "truefoundry" : "local")).toLowerCase();
+let secretCache = null; // { text, source } after first successful fetch
+
+async function tfy(path, init = {}) {
+  const r = await fetch(`${TFY_HOST}/api/svc${path}`, { ...init,
+    headers: { Authorization: `Bearer ${TFY_API_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
+  if (!r.ok) throw new Error(`TrueFoundry ${init.method || "GET"} ${path} -> HTTP ${r.status}`);
+  return r.json();
+}
+
+async function fetchDeploySecretsFromTrueFoundry() {
+  const groups = (await tfy(`/v1/secret-groups?search=${encodeURIComponent(TFY_SECRET_GROUP)}&limit=20`)).data || [];
+  const group = groups.find((g) => g.fqn?.endsWith(`:${TFY_SECRET_GROUP}`)) || groups[0];
+  if (!group) throw new Error(`secret group "${TFY_SECRET_GROUP}" not found`);
+  let secrets = (await tfy(`/v1/secrets`, { method: "POST",
+    body: JSON.stringify({ secretGroupId: group.id, withValue: true, limit: 100 }) })).data || [];
+  if (secrets.some((s) => s.value == null)) {              // per-id fallback (get-a-secret)
+    secrets = await Promise.all(secrets.map(async (s) => s.value != null ? s : (await tfy(`/v1/secrets/${s.id}`)).data));
+  }
+  if (!secrets.length || secrets.some((s) => s.value == null))
+    throw new Error("secret values not returned (DISABLE_SECRET_VALUE_VIEW or role=Viewer?)");
+  return { text: secrets.map((s) => `${s.name}=${s.value}`).join("\n"), source: `truefoundry:${group.fqn}` };
+}
+
+async function getDeploySecrets() {
+  if (SECRET_SOURCE !== "truefoundry") return { text: LOCAL_DEPLOY_SECRETS, source: "local-constant" };
+  try { secretCache = await fetchDeploySecretsFromTrueFoundry(); return secretCache; }
+  catch (e) {
+    if (secretCache) { log(`WARN TrueFoundry fetch failed (${e.message}); serving cached value`); return secretCache; }
+    throw e;
+  }
+}
+
@@ in CallToolRequestSchema handler
     if (name === "read_deploy_secrets") {
-      for (const v of taintValuesFrom(DEPLOY_SECRETS)) tainted.add(v);
-      log(`READ  read_deploy_secrets (private zone) -> tainted ${tainted.size} value(s)`);
-      return { content: [{ type: "text", text: JSON.stringify({ ok: true, secrets: DEPLOY_SECRETS }) }] };
+      const { text, source } = await getDeploySecrets();
+      for (const v of taintValuesFrom(text)) tainted.add(v);
+      log(`READ  read_deploy_secrets (private zone, source=${source}) -> tainted ${tainted.size} value(s)`);
+      return { content: [{ type: "text", text: JSON.stringify({ ok: true, source, secrets: text }) }] };
     }
+
@@ in main(), after the PAT warning
   if (!PAT) log("WARNING: GITHUB_PERSONAL_ACCESS_TOKEN not set.");
+  if (SECRET_SOURCE === "truefoundry") {
+    const { source, text } = await getDeploySecrets();   // fail fast on bad creds
+    log(`secret source = ${source} (${text.split("\n").length} key(s) fetched from TrueFoundry)`);
+  } else {
+    log("WARNING: secret source = local-constant (set TFY_HOST/TFY_API_KEY/TFY_SECRET_GROUP to source from TrueFoundry)");
+  }
```

Node ≥ 18 has global `fetch`, so no new dependency. `.env` is already loaded by
`scripts/demo.sh` and `scripts/verify.sh` (`set -a; . ./.env; set +a`), so the three
new vars flow into the proxy with no script change.

### 4.2 Add to `.env.example` (no values)

```
# TrueFoundry Secret Management — source of the canary deploy secret (values are canaries)
TFY_HOST=https://<org>.truefoundry.cloud
TFY_API_KEY=PASTE_YOUR_TRUEFOUNDRY_PAT_HERE
TFY_SECRET_GROUP=shipwright-staging-deploy
```

### 4.3 Test sequence (~10 min)

```bash
set -a; . ./.env; set +a
NOLEAK_MODE=on node noleak/proxy.mjs          # expect: "secret source = truefoundry:<tenant>:shipwright-staging-deploy (3 key(s) ...)"
npm test                                       # policy + latency: unchanged, must stay green
npm run selftest                               # canary write DENIED
curl -XPOST localhost:8791/reset               # clear taint, then run the full demo
bash scripts/demo.sh                           # proxy log now shows source=truefoundry on the READ line
NOLEAK_SECRET_SOURCE=local node noleak/proxy.mjs   # proves fallback still works
```

Taint/provenance guarantee: intact. The value still enters the agent only through
NoLeak's `read_deploy_secrets`, is tainted at that moment, and any outbound
`add_issue_comment` carrying it is denied (guard on) or forwarded (guard off).
Nothing in this design lets the agent reach TrueFoundry directly — the TFY token
lives only in NoLeak's process, which is the point: NoLeak is the sole broker.

---

## 5. Time estimate and go/no-go

| Step | Time |
|---|---|
| 3.1 check store exists | 3 min |
| 3.2 create group + 3 canaries (UI) | 10 min |
| 3.3 PAT + verification curl | 10 min |
| 4.1-4.2 apply diff + env example | 15 min |
| 4.3 test + re-run demo | 10-15 min |
| **Total** | **~50-55 min** on the happy path |

**Recommendation: GO, gated on step 3.1 + 3.3, with a hard 30-minute time box on the
user side.** The API for value read-back is clearly documented, the code change is
small and additive (fallback preserved), and the demo narrative gets materially
stronger ("the secret the agent leaks is pulled live from TrueFoundry Secret
Management, and NoLeak is the only thing standing between it and a public GitHub
comment").

**NO-GO triggers** (switch to section 6 immediately, do not debug):
- 3.1: no secret store on the tenant and the only option is connecting AWS/GCP/Vault.
- 3.3: values come back `null` / 403 "viewing is disabled", and the role is already
  Editor/Admin.
- 30 minutes elapsed on the user side without 3.3 passing.

---

## 6. Fallbacks

### 6a. Injection-only fallback (if 3.3 fails but a store exists)

TrueFoundry cannot push env vars into a laptop process; injection only targets
TrueFoundry-deployed workloads (`tfy-secret://user:group:name` in the deployment
spec, doc: environment-variables-and-secrets). Deploying NoLeak to TrueFoundry
compute just to receive the injection is out of budget for tonight. So there is no
practical "YES-with-injection" for a locally running proxy; treat 3.3 failure as NO.

### 6b. Local real-vault fallback (recommended NO-GO path)

Keep the same diff shape but point `getDeploySecrets()` at a local secret manager
that IS a real vault (HashiCorp Vault dev server, `vault server -dev`, KV v2, read
via `GET http://127.0.0.1:8200/v1/secret/data/shipwright-staging-deploy` with
`X-Vault-Token`). Same taint path, same tests, ~25 min, zero cloud dependency, and
the narrative "secret sourced from a real secrets manager, not a JS constant" still
holds. If even that is at risk of the deadline, ship the current hardcoded version:
it already proves the containment claim; the source of the canary is a
nice-to-have, not the thesis.

---

## Doc citations used

- Secret Management overview, roles (Admin/Editor/Viewer), FQN formats:
  https://www.truefoundry.com/docs/manage-secrets
- Secret store integrations (AWS SSM / GCP / Vault):
  https://www.truefoundry.com/docs/integrations-secret-store
- Secret Management API (PUT manifest, `integration_fqn` default
  `internal:aws:aws-1:secret-store:internal-secret-store`, `TRUEFOUNDRY_API_SERVER_URL=<cp>/api/svc`):
  https://www.truefoundry.com/docs/apply-api-secret-management
- List secrets (`POST /api/svc/v1/secrets`, `withValue`, 403 when viewing disabled):
  https://www.truefoundry.com/docs/api-reference/secrets/list-secrets
- Get a secret (`GET /api/svc/v1/secrets/{id}`, `value` null if viewing disabled):
  https://www.truefoundry.com/docs/api-reference/secrets/get-a-secret
- Create a secret group (`POST /api/svc/v1/secret-groups`, `integrationId`, values not echoed):
  https://www.truefoundry.com/docs/api-reference/secret-groups/create-a-secret-group
- List secret groups (`GET /api/svc/v1/secret-groups?search=|fqn=`, `associatedSecrets[].id`):
  https://www.truefoundry.com/docs/api-reference/secret-groups/list-secret-groups
- SDK secrets (`with_value`, `DISABLE_SECRET_VALUE_VIEW` note):
  https://www.truefoundry.com/docs/truefoundry_sdk/secrets
- SDK secret groups ("separate call to /v1/secrets/{id} to fetch the value"):
  https://www.truefoundry.com/docs/truefoundry_sdk/secret_groups
- API keys (PAT: Access > Personal Access Tokens; Virtual Accounts; `Authorization: Bearer`):
  https://www.truefoundry.com/docs/generating-truefoundry-api-keys
- CLI/env (`TFY_HOST`, `TFY_API_KEY`, host e.g. `https://myorg.truefoundry.cloud`):
  https://www.truefoundry.com/docs/setup-cli
- Env var injection / `tfy-secret://user:group:name` (deployed workloads only):
  https://www.truefoundry.com/docs/environment-variables-and-secrets
