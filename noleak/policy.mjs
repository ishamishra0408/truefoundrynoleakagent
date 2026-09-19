// NoLeak deterministic egress policy. No model in the decision loop.
// Applied to OUTBOUND GitHub WRITE calls only (add_issue_comment, issue_write).
// Rule A (provenance): values returned by NoLeak's private-zone tool are
// tainted for the session; any public write carrying an 8-char window of one
// (after zero-width stripping, normalization and base64/hex decoding) is denied.
// Rule B (shape): narrow fallback for secrets NoLeak never brokered.
// Reads pass straight through, never inspected.

// Known canary token (fake). Chosen so it shares NO 8-char window with the
// repo/org name — an earlier "CANARY-SHIPWRIGHT-..." token made every write to
// shipwright-demo look tainted. Override with env CANARY.
export const CANARY_TOKEN = process.env.CANARY || "CANARY-9f8a2c-QX7";

// Rule B — secret SHAPES (fallback for values NoLeak never brokered).
// Deliberately narrow: a triage bot must be able to quote git SHAs, env-var
// NAMES, URLs and the English word "canary" without being silenced.
const HEX40 = /^[0-9a-f]{40}$/i;
const SECRET_PATTERNS = [
  { name: "aws-access-key-id", test: (s) => /\bAKIA[0-9A-Z]{16,}\b/.test(s) },
  // exactly-40-char base64-ish run that is NOT a git SHA (pure hex), has mixed
  // case + a digit, and is not a URL path segment run (no '/').
  { name: "aws-secret-access-key", test: (s) => {
      for (const m of s.match(/(?<![A-Za-z0-9+=])[A-Za-z0-9+=]{40}(?![A-Za-z0-9+=])/g) ?? []) {
        if (HEX40.test(m)) continue;
        if (/[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m)) return true;
      }
      return false;
    } },
  { name: "canary-token", test: (s) => s.includes(CANARY_TOKEN) },
];

// GitHub write tools this policy guards. Reads are not listed → always allowed.
const WRITE_TOOLS = new Set(["add_issue_comment", "issue_write", "create_or_update_file", "push_files", "update_issue_comment"]);

export function isWriteTool(name) {
  return WRITE_TOOLS.has(name);
}

// Only CONTENT-bearing fields are the outbound payload. Structural args
// (owner, repo, issue_number, path, branch, sha ...) are routing, not data,
// and are never inspected — inspecting them caused false denials.
const CONTENT_FIELDS = new Set(["body", "content", "title", "message"]);
export function payloadText(args = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(args)) {
    if (CONTENT_FIELDS.has(k) && typeof v === "string") parts.push(v);
    else if (k === "files" && Array.isArray(v))
      for (const f of v) if (f && typeof f.content === "string") parts.push(f.content);
  }
  return parts.join("\n");
}

// Pull the secret VALUES out of a `KEY=value` secrets blob so we can taint them.
// Only the value to the right of `=` is tainted — never the key name — so a
// comment that merely says "check AWS_ACCESS_KEY_ID is set" stays allowed.
export function taintValuesFrom(text = "") {
  const out = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0) { const v = line.slice(eq + 1).trim(); if (v.length >= 8) out.add(v); }
  }
  return [...out];
}

const MIN_WINDOW = 8;
// strip zero-width chars, keep only alphanumerics, lowercase — defeats whitespace/zero-width splitting.
const ZW = /[\u200b-\u200f\u2060\ufeff]/g;
export const norm = (s = "") => String(s).replace(ZW, "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();

// add decoded forms of base64/hex-looking runs so an encoded secret is inspected too.
export function expand(body = "") {
  const parts = [body];
  for (const m of String(body).match(/[A-Za-z0-9+/=_-]{16,}/g) ?? []) {
    try { const b64 = Buffer.from(m.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      if (b64.length >= 8 && /^[\x20-\x7e\s]+$/.test(b64)) parts.push(b64); } catch {}
    if (/^[0-9a-fA-F]+$/.test(m) && m.length % 2 === 0) {
      try { const hex = Buffer.from(m, "hex").toString("utf8"); if (/^[\x20-\x7e\s]+$/.test(hex)) parts.push(hex); } catch {}
    }
  }
  return parts.join("\n");
}

// taint match: any MIN_WINDOW-char slice of any tainted value appears in the normalized body.
// Precompute the body's n-grams once (O(body) + O(taint)) so it stays sub-ms on large bodies.
function taintHit(bodyNorm, tainted) {
  if (bodyNorm.length < MIN_WINDOW) return null;
  const grams = new Set();
  for (let i = 0; i + MIN_WINDOW <= bodyNorm.length; i++) grams.add(bodyNorm.slice(i, i + MIN_WINDOW));
  for (const t of tainted) {
    const tn = norm(t);
    for (let i = 0; i + MIN_WINDOW <= tn.length; i++) {
      const g = tn.slice(i, i + MIN_WINDOW);
      if (grams.has(g)) return g.slice(0, 4);
    }
  }
  return null;
}

export function policyCheck(toolName, args, opts = {}) {
  const guard = opts.guard ?? "on";
  const tainted = opts.tainted || [];
  if (guard === "off") return { allow: true, rule: "guard-off" };
  if (!isWriteTool(toolName)) return { allow: true, rule: "read-passthrough" };

  const raw = payloadText(args);
  const expanded = expand(raw);

  // Rule A — taint / provenance (sliding window over normalized, decode-expanded body).
  const frag = taintHit(norm(expanded), tainted);
  if (frag) {
    return { allow: false, rule: "taint-provenance",
      reason: `outbound ${toolName} carries a value read from the private zone this session (fragment "${frag}...")`,
      match: "tainted-value" };
  }

  // Rule B — secret-shape / canary tripwire (fallback for values we never brokered).
  for (const p of SECRET_PATTERNS) {
    if (p.test(expanded)) {
      return { allow: false, rule: "canary-tripwire",
        reason: `outbound ${toolName} payload matched secret shape "${p.name}"`, match: p.name };
    }
  }
  return { allow: true, rule: "clean-write" };
}
