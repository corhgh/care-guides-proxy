/**
 * Belgrave Orchids — Care Guides Proxy (v2)
 * - Express service on Render
 * - Shopify App Proxy endpoint: GET /care-guides
 * - Optional public access: via subdomain (no signature present)
 *
 * Env:
 *   SHOPIFY_API_SECRET
 *   SHOPIFY_ADMIN_ACCESS_TOKEN
 *   SHOPIFY_SHOP_DOMAIN
 */

import express from "express";
import crypto from "crypto";

const app = express();

const {
  SHOPIFY_API_SECRET,
  SHOPIFY_ADMIN_ACCESS_TOKEN,
  SHOPIFY_SHOP_DOMAIN,
  PORT,
  RENDER_GIT_COMMIT,
  NODE_ENV,
} = process.env;

const VERSION = "2.0.0";

// --- basic sanity checks (don’t crash, but warn loudly)
function envOk() {
  return Boolean(SHOPIFY_API_SECRET && SHOPIFY_ADMIN_ACCESS_TOKEN && SHOPIFY_SHOP_DOMAIN);
}

function nowIso() {
  return new Date().toISOString();
}

// Shopify proxy signature verification
// Docs concept: signature = HMAC-SHA256(secret, sorted_querystring_without_signature)
// NOTE: App Proxy signature is different to OAuth "hmac". This is the proxy "signature" parameter.
function verifyShopifyProxySignature(query, secret) {
  const { signature, ...rest } = query || {};
  if (!signature) return { ok: false, reason: "Missing signature" };

  // Shopify expects:
  // - all query params except signature
  // - sorted lexicographically by key
  // - encoded as key=value pairs joined by &
  // - then HMAC SHA256 using shared secret
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${Array.isArray(rest[key]) ? rest[key].join(",") : rest[key]}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  const safeEqual =
    digest.length === String(signature).length &&
    crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(signature)));

  return safeEqual
    ? { ok: true }
    : { ok: false, reason: "Invalid signature" };
}

function hasProxySignature(query) {
  return Boolean(query && query.signature);
}

// Simple allow-list for shop param (optional)
function isExpectedShop(queryShop) {
  if (!queryShop) return true; // some requests won’t include it
  const expected = SHOPIFY_SHOP_DOMAIN.replace(/^https?:\/\//, "").toLowerCase();
  const incoming = String(queryShop).replace(/^https?:\/\//, "").toLowerCase();
  return incoming === expected;
}

// Shopify Admin API call helper (GraphQL)
async function shopifyGraphQL(query, variables = {}) {
  const shop = SHOPIFY_SHOP_DOMAIN.replace(/^https?:\/\//, "");
  const url = `https://${shop}/admin/api/2025-01/graphql.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Shopify GraphQL non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}

// --- routes

app.get("/", (req, res) => {
  res
    .status(200)
    .type("text/plain")
    .send(
      [
        `Care Guides Proxy – Status OK`,
        `Version: ${VERSION}`,
        `Env OK: ${envOk() ? "yes" : "NO (missing env vars)"}`,
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

/**
 * Main App Proxy endpoint:
 * Shopify → /apps/care-guides → Render → GET /care-guides
 *
 * Dual mode:
 * - If signature present: must validate
 * - If no signature: allow (public subdomain / direct)
 */
app.get("/care-guides", async (req, res) => {
  try {
    // Optional hard guard: ensure env is present
    if (!envOk()) {
      return res.status(500).json({
        ok: false,
        error: "Server not configured",
        detail: "Missing required environment variables",
      });
    }

    // Optional sanity check: shop param if present
    if (!isExpectedShop(req.query.shop)) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized",
        detail: "Unexpected shop value",
      });
    }

    // Verify signature only if present
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

    // --- TODO: Replace this placeholder with your real logic
    // Inputs you may use later:
    // const { order, email } = req.query;
    //
    // For now, return a stable “proxy works” response:
    // (keeps your previous milestone behaviour)
    const payload = {
      ok: true,
      guides: [],
      meta: {
        signed: hasProxySignature(req.query),
        shop: req.query.shop || null,
        path_prefix: req.query.path_prefix || null,
        timestamp: req.query.timestamp || null,
      },
    };

    // OPTIONAL: If you want to prove Admin API access works, uncomment:
    /*
    const data = await shopifyGraphQL(`
      query ShopName {
        shop { name myshopifyDomain }
      }
    `);
    payload.meta.shopify = data.shop;
    */

    return res.status(200).json(payload);
  } catch (err) {
    console.error("[/care-guides] error:", err);
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: err?.message || String(err),
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

const port = Number(PORT) || 3000;
app.listen(port, () => {
  console.log(`[Care Guides Proxy] v${VERSION} listening on ${port}`);
});
