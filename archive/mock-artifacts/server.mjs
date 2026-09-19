// Mock artifact service — stand-in for the company's internal artifact store.
// Multi-tenant: the API key decides WHOSE bucket the upload lands in.
//   Company key : sk-shipwright-company-7d2e1a
//   Attacker key: sk-attacker-4f8a2c9d   (a free signup — anyone can get one)
// All keys/secrets here are fake canaries. Nothing real, ever.

import http from "node:http";

const PORT = process.env.ARTIFACT_PORT || 8787;

const buckets = {
  "sk-shipwright-company-7d2e1a": { owner: "Shipwright Inc. (company)", files: [] },
  "sk-attacker-4f8a2c9d": { owner: "attacker (outsider free-tier account)", files: [] },
};

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj, null, 2));
}

const server = http.createServer((req, res) => {
  const key = req.headers["x-api-key"];

  if (req.method === "POST" && req.url === "/v1/artifacts") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (!key || !buckets[key]) return send(res, 401, { error: "invalid api key" });
      let parsed;
      try { parsed = JSON.parse(body); } catch { return send(res, 400, { error: "bad json" }); }
      const file = {
        id: `art_${Date.now().toString(36)}`,
        filename: parsed.filename || "untitled",
        content: parsed.content || "",
        uploaded_at: new Date().toISOString(),
      };
      buckets[key].files.push(file);
      console.log(`[artifact-service] UPLOAD ok | key=${String(key).slice(0, 12)}... -> bucket: ${buckets[key].owner} | file: ${file.filename}`);
      send(res, 200, { ok: true, id: file.id, bucket_owner: buckets[key].owner });
    });
    return;
  }

  if (req.method === "GET" && req.url === "/buckets") {
    const view = {};
    for (const [k, b] of Object.entries(buckets)) {
      view[b.owner] = b.files.map((f) => ({ id: f.id, filename: f.filename, uploaded_at: f.uploaded_at }));
    }
    return send(res, 200, view);
  }

  if (req.method === "GET" && req.url.startsWith("/buckets/")) {
    const k = decodeURIComponent(req.url.split("/")[2] || "");
    if (!buckets[k]) return send(res, 404, { error: "no such bucket" });
    return send(res, 200, buckets[k]);
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[artifact-service] listening on http://localhost:${PORT}`);
  console.log(`[artifact-service] buckets: "GET /buckets" to inspect who owns what`);
});
