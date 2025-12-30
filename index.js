/**
 * Belgrave Orchids — Care Guides Proxy (v2.1)
 * Storefront-token based (NO shpat required)
 *
 * Endpoints:
 *   GET /                 -> status
 *   GET /healthz          -> json health
 *   GET /care-guides      -> returns care guide URLs for product handles or ids
 *
 * Query params supported:
 *   handles=handle-a,handle-b
 *   ids=gid://shopify/Product/123,gid://shopify/Product/456
 *
 * Dual-mode access:
 *   - If Shopify proxy signature is present -> verify
 *   - If no signature -> allow (subdomain access)
 */

import express from "express";
import crypto from "crypto";

const app = express();

const {
  SHOPIFY_API_SECRET, // Dev Dashboard app secret (for proxy signature verification)
  SHOPIFY_SHOP_DOMAIN, // belgraveorchids.com.au (or belgraveorchids.myshopify.com)
  SHOPIFY_STOREFRONT_ACCESS_TOKEN, // Storefront API token
  SHOPIFY_STOREFRONT_API_VERSION, // optional override (default below)
  PORT,
  NODE_ENV,
  RENDER_GIT_COMMIT,
} = process.env;

const VERSION = "2.1.0";
const STOREFRONT_VERSION = SHOPIFY_STOREFRONT_API_VERSION || "2025-01";

function envOk() {
  return Boolean(SHOPIFY_API_SECRET && SHOPIFY_SHOP_DOMAIN && SHOPIFY_STOREFRONT_ACCESS_TOKEN);
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
    digest.length === sig.length && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(sig));

  return safeEqual ? { ok: true } : { ok: false, reason: "Invalid signature" };
}

function normaliseShopDomain(domain) {
  // Storefront endpoint expects the myshopify domain.
  // If you pass belgraveorchids.com.au, we can’t safely derive myshopify automatically.
  // So: prefer setting SHOPIFY_SHOP_DOMAIN to belgraveorchids.myshopify.com
  return String(domain || "").replace(/^https?:\/\//, "").trim();
}

async function storefrontGraphQL(query, variables = {}) {
  const shop = normaliseShopDomain(SHOPIFY_SHOP_DOMAIN);

  // IMPORTANT:
  // Storefront API endpoint uses the shop's *myshopify* domain.
  // If SHOPIFY_SHOP_DOMAIN is belgraveorchids.com.au, this will fail.
  const url = `https://${shop}/api/${STOREFRONT_VERSION}/graphql.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Storefront non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(`Storefront HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  if (json.errors?.length) {
    throw new Error(`Storefront errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}

function parseCsvParam(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- Routes

app.get("/", (req, res) => {
  res.status(200).type("text/plain").send(
    [
      `Care Guides Proxy – Status OK`,
      `Version: ${VERSION}`,
      `Env OK: ${envOk() ? "yes" : "NO (missing env vars)"}`,
      `Time: ${nowIso()}`,
      `Node env: ${NODE_ENV || "unknown"}`,
      `Storefront API: ${STOREFRONT_VERSION}`,
    ].join("\n")
  );
});

app.get("/healthz", (req, res) => {
  res.status(envOk() ? 200 : 500).json({
    ok: envOk(),
    version: VERSION,
    storefrontApiVersion: STOREFRONT_VERSION,
    commit: RENDER_GIT_COMMIT || null,
    time: nowIso(),
  });
});

/**
 * GET /care-guides
 * Supports:
 *   ?handles=a,b,c
 *   ?ids=gid://shopify/Product/...,gid://shopify/Product/...
 *
 * Returns:
 *   {
 *     ok: true,
 *     guides: [{ handle, title, care_guide_url }],
 *     unique_urls: [...]
 *   }
 */
app.get("/care-guides", async (req, res) => {
  try {
    if (!envOk()) {
      return res.status(500).json({
        ok: false,
        error: "Server not configured",
        detail: "Missing SHOPIFY_API_SECRET / SHOPIFY_SHOP_DOMAIN / SHOPIFY_STOREFRONT_ACCESS_TOKEN",
      });
    }

    // Verify signature only if present (dual-mode)
    if (hasProxySignature(req.query)) {
      const verified = verifyShopifyProxySignature(req.query, SHOPIFY_API_SECRET);
      if (!verified.ok) {
        return res.status(401).json({ ok: false, error: "Unauthorized", detail: verified.reason });
      }
    }

    const handles = parseCsvParam(req.query.handles);
    const ids = parseCsvParam(req.query.ids);

    if (handles.length === 0 && ids.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Missing input",
        detail: "Provide ?handles=handle-a,handle-b OR ?ids=gid://shopify/Product/...",
        example: "/care-guides?handles=dracula-vampira,masdevallia-xyz",
      });
    }

    // Storefront: easiest is by handle (productByHandle).
    // For ids, use nodes(ids: [...]).

    const results = [];

    if (handles.length) {
      // Fetch sequentially to keep it simple + stable (handles list will be small).
      for (const handle of handles.slice(0, 25)) {
        const data = await storefrontGraphQL(
          `
          query ProductCareGuideByHandle($handle: String!) {
            productByHandle(handle: $handle) {
              id
              title
              handle
              metafield(namespace: "custom", key: "care_guide") { value }
            }
          }
        `,
          { handle }
        );

        const p = data?.productByHandle;
        if (!p) continue;

        results.push({
          id: p.id,
          handle: p.handle,
          title: p.title,
          care_guide_url: p.metafield?.value || null,
        });
      }
    }

    if (ids.length) {
      const data = await storefrontGraphQL(
        `
        query ProductsCareGuideByIds($ids: [ID!]!) {
          nodes(ids: $ids) {
            __typename
            ... on Product {
              id
              title
              handle
              metafield(namespace: "custom", key: "care_guide") { value }
            }
          }
        }
      `,
        { ids: ids.slice(0, 50) }
      );

      const nodes = data?.nodes || [];
      for (const n of nodes) {
        if (!n || n.__typename !== "Product") continue;
        results.push({
          id: n.id,
          handle: n.handle,
          title: n.title,
          care_guide_url: n.metafield?.value || null,
        });
      }
    }

    // Dedupe + clean URLs
    const unique = [];
    const seen = new Set();
    for (const r of results) {
      const url = r.care_guide_url ? String(r.care_guide_url).trim() : null;
      if (url && !seen.has(url)) {
        seen.add(url);
        unique.push(url);
      }
      r.care_guide_url = url;
    }

    return res.status(200).json({
      ok: true,
      guides: results,
      unique_urls: unique,
      meta: {
        signed: hasProxySignature(req.query),
        handles_count: handles.length,
        ids_count: ids.length,
      },
    });
  } catch (err) {
    console.error("[/care-guides] error:", err);
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: err?.message || String(err),
      hint:
        "If Storefront endpoint fails, ensure SHOPIFY_SHOP_DOMAIN is your *.myshopify.com domain for Storefront API.",
    });
  }
});

app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));

const port = Number(PORT) || 3000;
app.listen(port, () => console.log(`[Care Guides Proxy] v${VERSION} listening on ${port}`));
