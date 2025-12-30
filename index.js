/**
 * Care Guides Proxy (v2.2.1)
 * - Smart landing page (HTML) by default
 * - JSON available via ?format=json
 * - Root fallback if Shopify App Proxy points to "/"
 * - Dual-mode Shopify proxy signature verification
 * - NO Admin API token
 * - NO Storefront token
 */

import express from "express";
import crypto from "crypto";

const app = express();
const VERSION = "2.2.1";

// Accept either env var name (never break again)
const SHOPIFY_API_SECRET =
  process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_APP_PROXY_SECRET;

const { PORT, NODE_ENV, RENDER_GIT_COMMIT } = process.env;

/* -------------------- helpers -------------------- */

function envOk() {
  return Boolean(SHOPIFY_API_SECRET);
}

function nowIso() {
  return new Date().toISOString();
}

function hasProxySignature(query) {
  return Boolean(query && query.signature);
}

function verifyShopifyProxySignature(query, secret) {
  const { signature, ...rest } = query || {};
  if (!signature) return { ok: false, reason: "Missing signature" };

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${Array.isArray(rest[key]) ? rest[key].join(",") : rest[key]}`)
    .join("&");

  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const sig = String(signature);

  const safeEqual =
    digest.length === sig.length &&
    crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(sig));

  return safeEqual ? { ok: true } : { ok: false, reason: "Invalid signature" };
}

function parseGuides(req) {
  const list = [];

  if (req.query.guides) {
    String(req.query.guides)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((u) => list.push(u));
  }

  const g = req.query.guide;
  if (g) {
    if (Array.isArray(g)) g.forEach((u) => list.push(String(u).trim()));
    else list.push(String(g).trim());
  }

  const seen = new Set();
  const out = [];

  for (const u of list) {
    const url = String(u || "").trim();
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }

  return out.slice(0, 50);
}

function wantsJson(req) {
  const f = String(req.query.format || "").toLowerCase();
  if (f === "json") return true;
  if (f === "html") return false;

  const accept = String(req.headers.accept || "").toLowerCase();
  return accept.includes("application/json") && !accept.includes("text/html");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function titleFromUrl(url) {
  try {
    const u = new URL(url);
    const slug = u.pathname.split("/").filter(Boolean).pop();
    if (!slug) return url;
    const t = slug.replaceAll("-", " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  } catch {
    return url;
  }
}

function renderHtml({ guides, signed }) {
  const items = guides
    .map((url) => {
      const title = titleFromUrl(url);
      return `
        <li>
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener">
            ${escapeHtml(title)}
          </a>
          <div class="url">${escapeHtml(url)}</div>
        </li>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Care Guides — Belgrave Orchids</title>
<meta name="robots" content="noindex,nofollow">
<style>
  body {
    margin:0;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    background:#fafafa;
    color:#111;
  }
  .wrap {
    max-width:860px;
    margin:0 auto;
    padding:32px 16px 56px;
  }
  .card {
    background:#fff;
    border:1px solid #e6e6e6;
    border-radius:14px;
    padding:20px;
  }
  h1 {
    margin:0 0 10px;
    font-size:22px;
  }
  p {
    margin:0 0 16px;
    color:#555;
  }
  ul {
    list-style:none;
    padding:0;
    margin:0;
  }
  li {
    padding:12px 0;
    border-top:1px solid #eee;
  }
  li:first-child { border-top:0; }
  a {
    font-weight:600;
    color:#111;
    text-decoration:none;
  }
  a:hover { text-decoration:underline; }
  .url {
    margin-top:6px;
    font-size:12px;
    color:#777;
    word-break:break-all;
  }
  .meta {
    margin-top:16px;
    font-size:12px;
    color:#777;
    display:flex;
    justify-content:space-between;
    flex-wrap:wrap;
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>Your care guides</h1>
    <p>These guides are matched to the plants in your order. Save this page for reference.</p>

    ${guides.length ? `<ul>${items}</ul>` : `<p>No care guides were found for this order.</p>`}

    <div class="meta">
      <div>Belgrave Orchids</div>
      <div>${signed ? "Verified via Shopify" : "Public link"}</div>
    </div>
  </div>
</div>
</body>
</html>`;
}

/* -------------------- core handler -------------------- */

function handleCareGuides(req, res) {
  if (!envOk()) {
    return res.status(500).json({
      ok: false,
      error: "Server not configured",
      detail: "Missing SHOPIFY_API_SECRET",
    });
  }

  let signed = false;
  if (hasProxySignature(req.query)) {
    signed = true;
    const verified = verifyShopifyProxySignature(req.query, SHOPIFY_API_SECRET);
    if (!verified.ok) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized",
        detail: verified.reason,
      });
    }
  }

  const guides = parseGuides(req);

  if (wantsJson(req)) {
    return res.status(200).json({
      ok: true,
      guides,
      meta: { signed, count: guides.length },
    });
  }

  return res.status(200).type("text/html").send(renderHtml({ guides, signed }));
}

/* -------------------- routes -------------------- */

app.get("/", (req, res) => {
  // Root fallback: if Shopify proxy points here, still serve guides
  if (req.query.guides || req.query.guide) {
    return handleCareGuides(req, res);
  }

  res.status(200).type("text/plain").send(
    [
      "Care Guides Proxy – Status OK",
      `Version: ${VERSION}`,
      `Env OK: ${envOk() ? "yes" : "NO (missing SHOPIFY_API_SECRET)"}`,
      `Time: ${nowIso()}`,
      `Node env: ${NODE_ENV || "unknown"}`,
    ].join("\n")
  );
});

app.get("/care-guides", handleCareGuides);

app.get("/healthz", (req, res) => {
  res.status(envOk() ? 200 : 500).json({
    ok: envOk(),
    version: VERSION,
    commit: RENDER_GIT_COMMIT || null,
    time: nowIso(),
  });
});

app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));

const port = Number(PORT) || 3000;
app.listen(port, () => {
  console.log(`[Care Guides Proxy] ${VERSION} listening on ${port}`);
});
