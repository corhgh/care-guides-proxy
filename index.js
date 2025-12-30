/**
 * Care Guides Proxy (v2.1.1-no-token)
 * - NO Admin token, NO Storefront token
 * - Shopify App Proxy signature verification when present (dual-mode)
 * - Works even if Shopify App Proxy target points to "/" (root fallback)
 *
 * Endpoints:
 *   GET /                 -> status page (unless guides params exist)
 *   GET /healthz          -> json health
 *   GET /care-guides      -> json response with guide URLs
 *
 * Input:
 *   /care-guides?guides=url1,url2
 *   /care-guides?guide=url1&guide=url2
 *
 * Root fallback:
 *   /?guides=... behaves the same as /care-guides?guides=...
 */

import express from "express";
import crypto from "crypto";

const app = express();

const VERSION = "2.1.1-no-token";

// Accept either env var name to avoid mismatch issues
const SHOPIFY_API_SECRET =
  process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_APP_PROXY_SECRET;

const { PORT, NODE_ENV, RENDER_GIT_COMMIT } = process.env;

function envOk() {
  return Boolean(SHOPIFY_API_SECRET);
}

function nowIso() {
  return new Date().toISOString();
}

function hasProxySignature(query) {
  return Boolean(query && query.signature);
}

// Shopify App Proxy signature verification (signature param)
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
  // supports:
  // - ?guides=url1,url2
  // - ?guide=url1&guide=url2
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

  // Clean + dedupe + only http(s)
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

  return out.slice(0, 50); // safety cap
}

function handleCareGuides(req, res) {
  if (!envOk()) {
    return res.status(500).json({
      ok: false,
      error: "Server not configured",
      detail: "Missing SHOPIFY_API_SECRET",
    });
  }

  // Verify signature only if present (dual-mode)
  if (hasProxySignature(req.query)) {
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

  return res.status(200).json({
    ok: true,
    guides,
    meta: {
      signed: hasProxySignature(req.query),
      count: guides.length,
    },
  });
}

// Root: show status OR (if guides params exist) behave like /care-guides
app.get("/", (req, res) => {
  // ✅ Root fallback: if Shopify proxy incorrectly targets "/", still work.
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

app.get("/healthz", (req, res) => {
  res.status(envOk() ? 200 : 500).json({
    ok: envOk(),
    version: VERSION,
    commit: RENDER_GIT_COMMIT || null,
    time: nowIso(),
  });
});

app.get("/care-guides", (req, res) => {
  return handleCareGuides(req, res);
});

app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));

const port = Number(PORT) || 3000;
app.listen(port, () => {
  console.log(`[Care Guides Proxy] ${VERSION} listening on ${port}`);
});
