// Registers/updates the OpenAI (or gateway) model provider in TrueForge.
// Reads key from env OPENAI_API_KEY. Optional OPENAI_BASE_URL for a gateway.
//   export OPENAI_API_KEY=...            (direct OpenAI, sk-...)
//   export OPENAI_BASE_URL=https://...   (only if a gateway URL was given)
//   node scripts/register-openai.mjs
const KEY = process.env.OPENAI_API_KEY || "";
const BASE = process.env.OPENAI_BASE_URL || "";
const TF = process.env.TF_URL || "http://localhost:8790";
if (!KEY) { console.error("Set OPENAI_API_KEY first."); process.exit(1); }

const models = [
  { model_id: "gpt-5.4-mini", name: "gpt-5-4-mini", properties: { context_length: 400000, max_output_tokens: 128000, reasoning_efforts: ["none","low","medium","high","xhigh"] } },
  { model_id: "gpt-5.5",      name: "gpt-5-5",      properties: { context_length: 1050000, max_output_tokens: 128000, reasoning_efforts: ["none","low","medium","high","xhigh"] } },
];
const manifest = { type: "openai", auth: { api_key: KEY }, models };
if (BASE) manifest.base_url = BASE.replace(/\/$/, "");
const body = JSON.stringify({ manifest });
const H = { "content-type": "application/json" };
const mask = (t) => t.replace(KEY, "***");

let res = await fetch(`${TF}/api/v1/settings/model-providers`, { method: "POST", headers: H, body });
let text = await res.text();
if (!res.ok) {
  // already exists -> update in place
  res = await fetch(`${TF}/api/v1/settings/model-providers`, { method: "PUT", headers: H, body });
  text = await res.text();
  console.log("PUT (update) ->", res.status);
} else console.log("POST (create) ->", res.status);
console.log(mask(text).slice(0, 300));
console.log(BASE ? `base_url = ${manifest.base_url}` : "base_url = (none — direct OpenAI)");
process.exit(res.ok ? 0 : 1);
