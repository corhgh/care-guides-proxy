// index.js (ESM)
// Node 18+ has fetch built-in. Render is on Node 22, so this is fine.

import express from "express";

const app = express();
app.use(express.json());

// ---------- Config ----------
const SHOP = process.env.SHOPIFY_SHOP_DOMAIN; // e.g. "7a6d38-5.myshopify.com"
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN; // shpat_...
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

function requireEnv() {
  const missing = [];
  if (!SHOP) missing.push("SHOPIFY_SHOP_DOMAIN");
  if (!TOKEN) missing.push("SHOPIFY_ADMIN_API_TOKEN");
  if (missing.length) {
    throw new Error("Missing env vars: " + missing.join(", "));
  }
}

// ---------- CORS (for Shopify storefront fetch) ----------
app.use((req, res, next) => {
  // Allow your storefront + local testing.
  const origin = req.headers.origin;
  const allow = new Set([
    "https://belgraveorchids.com.au",
    "https://www.belgraveorchids.com.au",
  ]);

  if (origin && allow.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    // Fallback: allow no origin (direct browser hits), and you can loosen this later if needed
    // res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ---------- Shopify GraphQL helper ----------
async function shopifyGraphQL(query, variables) {
  requireEnv();

  const url = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`Shopify HTTP ${resp.status}: ${text}`);

  const json = JSON.parse(text);
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// ---------- GraphQL queries ----------
const FIND_ORDER = `
query FindOrder($q: String!) {
  orders(first: 1, query: $q, sortKey: PROCESSED_AT, reverse: true) {
    edges {
      node {
        id
        name
        lineItems(first: 100) {
          edges {
            node {
              product { id }
            }
          }
        }
      }
    }
  }
}
`;

const PRODUCT_METAFIELDS = `
query ProductMetafields($ids: [ID!]!, $namespace: String!, $key: String!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      metafield(namespace: $namespace, key: $key) { value }
    }
  }
}
`;

function dedupeUrls(list) {
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
  return out;
}

// ---------- Main endpoint ----------
app.get("/care-guides", async (req, res) => {
  try {
    // Phase 1 compatibility (guides=URL,URL)
    const rawGuides = (req.query.guides || "").toString().trim();
    const orderParam = (req.query.order || "").toString().trim();
    const mode = orderParam ? "order" : (rawGuides ? "guides" : "none");

    // If guides= is provided, just echo back normalized list (your existing mode)
    if (!orderParam && rawGuides) {
      const urls = dedupeUrls(rawGuides.split(","));
      return res.json({
        ok: true,
        guides: urls,
        meta: { mode, count: urls.length, phase: 1 },
      });
    }

    // If order= is missing, return Phase 1 empty
    if (!orderParam) {
      return res.json({
        ok: true,
        guides: [],
        meta: { mode, count: 0, phase: 1 },
      });
    }

    // ----- Phase 2: order -> line items -> product metafield custom.care_guide -----
    const orderNumber = orderParam.replace(/^#/, "");
    const q = `name:#${orderNumber}`;

    const found = await shopifyGraphQL(FIND_ORDER, { q });
    const edge = found?.orders?.edges?.[0];
    const orderName = edge?.node?.name || `#${orderNumber}`;

    const productIds = (edge?.node?.lineItems?.edges || [])
      .map(e => e?.node?.product?.id)
      .filter(Boolean);

    const uniqProductIds = [...new Set(productIds)];

    if (!uniqProductIds.length) {
      return res.json({
        ok: true,
        guides: [],
        meta: { mode: "order", order: orderNumber, shopify_order: orderName, count: 0, phase: 2 },
      });
    }

    const metaData = await shopifyGraphQL(PRODUCT_METAFIELDS, {
      ids: uniqProductIds,
      namespace: "custom",
      key: "care_guide",
    });

    const urls = dedupeUrls(
      (metaData?.nodes || [])
        .map(n => n?.metafield?.value)
        .filter(Boolean)
    );

    return res.json({
      ok: true,
      guides: urls,
      meta: { mode: "order", order: orderNumber, shopify_order: orderName, count: urls.length, phase: 2 },
    });
  } catch (err) {
    console.error("care-guides error:", err?.message || err);
    res.status(500).json({
      ok: false,
      error: "Care guides lookup failed",
      detail: err?.message || String(err),
    });
  }
});

// Optional health route (helps Render)
app.get("/", (req, res) => res.status(200).send("ok"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Care Guides Proxy listening on ${port}`));
