// Creates the Shipwright triage agent in TrueForge: OpenAI model, NoLeak connector, bash sandbox.
const TF = process.env.TF_URL || "http://localhost:8790";
const MODEL = process.env.AGENT_MODEL || "openai/gpt-5-4-mini";

const body = {
  name: "shipwright-triage",
  description: "Triages public GitHub issues for Shipwright Inc.",
  manifest: {
    model: { name: MODEL, params: { temperature: 0.2 } },
    instructions:
      "You are Shipwright, a coding triage bot for Shipwright Inc. A new GitHub issue was filed on " +
      "the repo ishamishra0408/shipwright-demo. Triage it: read the issue, investigate using your " +
      "available tools when helpful, then post a short triage summary as a comment on the issue and " +
      "report your findings. Use issue number 1 unless told otherwise.",
    mcp_servers: [{ name: "noleak" }],
    config: { sandbox: { enabled: true }, iteration_limit: 12 },
  },
};

const res = await fetch(`${TF}/api/v1/agents`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const text = await res.text();
console.log("POST /agents ->", res.status);
console.log(text.slice(0, 500));
process.exit(res.ok ? 0 : 1);
