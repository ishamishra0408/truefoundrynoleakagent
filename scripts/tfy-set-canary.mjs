// Sets DEPLOY_CANARY_TOKEN in the TrueFoundry secret group to the canary the
// policy expects (env CANARY, default from noleak/policy.mjs). Never prints the API key.
//   set -a; . ./.env; set +a; node scripts/tfy-set-canary.mjs
import { CANARY_TOKEN } from "../noleak/policy.mjs";
const H = (process.env.TFY_HOST || "").replace(/\/+$/, ""), K = process.env.TFY_API_KEY || "", G = process.env.TFY_SECRET_GROUP || "";
if (!H || !K || !G) { console.error("TFY_HOST / TFY_API_KEY / TFY_SECRET_GROUP missing"); process.exit(1); }
const tfy = async (p, init = {}) => {
  const r = await fetch(`${H}/api/svc${p}`, { ...init, headers: { Authorization: `Bearer ${K}`, "Content-Type": "application/json" } });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { _raw: t }; }
  return { ok: r.ok, status: r.status, j };
};
const groups = (await tfy(`/v1/secret-groups?search=${encodeURIComponent(G)}&limit=20`)).j.data || [];
const grp = groups.find((g) => g.fqn?.endsWith(`:${G}`)) || groups[0];
if (!grp) { console.error("group not found"); process.exit(1); }
const cur = (await tfy(`/v1/secrets`, { method: "POST", body: JSON.stringify({ secretGroupId: grp.id, withValue: true, limit: 100 }) })).j.data || [];
const byName = Object.fromEntries(cur.map((s) => [s.name, s]));
const want = { ...Object.fromEntries(cur.map((s) => [s.name, s.value])), DEPLOY_CANARY_TOKEN: CANARY_TOKEN };
console.log(`group ${grp.fqn}: current DEPLOY_CANARY_TOKEN ${byName.DEPLOY_CANARY_TOKEN?.value === CANARY_TOKEN ? "already" : "!="} ${CANARY_TOKEN}`);
if (byName.DEPLOY_CANARY_TOKEN?.value === CANARY_TOKEN) process.exit(0);

// Try 1: apply-API manifest PUT (docs: apply-api-secret-management).
const manifest = { type: "secret-group", name: grp.name, integration_fqn: grp.manifest?.integration_fqn,
  secrets: Object.entries(want).map(([key, value]) => ({ key, value })) };
if (!manifest.integration_fqn) delete manifest.integration_fqn;
const readBack = async () => ((await tfy(`/v1/secrets`, { method: "POST", body: JSON.stringify({ secretGroupId: grp.id, withValue: true, limit: 100 }) })).j.data || []).find((s) => s.name === "DEPLOY_CANARY_TOKEN")?.value;
const secretsList = Object.entries(want).map(([key, value]) => ({ key, value }));
const attempts = [
  ["PUT /v1/secret-groups (manifest)", () => tfy(`/v1/secret-groups`, { method: "PUT", body: JSON.stringify({ manifest, ...(manifest.integration_fqn ? {} : { integrationId: grp.integrationId }) }) })],
  ["PUT /v1/secret-groups/{id}", () => tfy(`/v1/secret-groups/${grp.id}`, { method: "PUT", body: JSON.stringify({ name: grp.name, integrationId: grp.integrationId, secrets: secretsList }) })],
  ["PATCH /v1/secret-groups/{id}", () => tfy(`/v1/secret-groups/${grp.id}`, { method: "PATCH", body: JSON.stringify({ secrets: secretsList }) })],
  ["PUT /v1/secrets/{id}", () => tfy(`/v1/secrets/${byName.DEPLOY_CANARY_TOKEN?.id}`, { method: "PUT", body: JSON.stringify({ value: CANARY_TOKEN }) })],
  ["PATCH /v1/secrets/{id}", () => tfy(`/v1/secrets/${byName.DEPLOY_CANARY_TOKEN?.id}`, { method: "PATCH", body: JSON.stringify({ value: CANARY_TOKEN }) })],
  ["POST /v1/secrets/{id}/versions", () => tfy(`/v1/secrets/${byName.DEPLOY_CANARY_TOKEN?.id}/versions`, { method: "POST", body: JSON.stringify({ value: CANARY_TOKEN }) })],
  ["PUT /v1/secrets (name+group)", () => tfy(`/v1/secrets`, { method: "PUT", body: JSON.stringify({ secretGroupId: grp.id, name: "DEPLOY_CANARY_TOKEN", value: CANARY_TOKEN }) })],
];
let now;
for (const [label, fn] of attempts) {
  const r = await fn();
  now = await readBack();
  console.log(`${label} -> ${r.status}${r.ok ? "" : " " + JSON.stringify(r.j).slice(0, 160)} | read-back ${now === CANARY_TOKEN ? "UPDATED" : "unchanged"}`);
  if (now === CANARY_TOKEN) break;
}
console.log(now === CANARY_TOKEN ? `VERIFIED: DEPLOY_CANARY_TOKEN = ${CANARY_TOKEN}` : `NOT UPDATED (read-back: ${now ? "old value" : "null"}) — set it by hand in TrueFoundry UI: Secrets > ${G} > DEPLOY_CANARY_TOKEN = ${CANARY_TOKEN}`);
process.exit(now === CANARY_TOKEN ? 0 : 1);
