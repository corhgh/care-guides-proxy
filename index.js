import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const SHOP = process.env.SHOPIFY_SHOP_DOMAIN;          // e.g. "7a6d38-5.myshopify.com"
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;     // shpat_...
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

app.use(express.json());

// Simple CORS so the Shopify page can fetch this endpoint
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allow = new Set([
    "https://belgraveorchids.com.au",
    "https://www.belgraveorchids.com.au",
  ]);

  if (origin && allow.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

function requireEnv() {
  const missing = [];
  if (!SHOP) missing.push("SHOPIFY_SHOP_DOMAIN");
  if (!TOKEN) missing.push("SHOPIFY_ADMIN_API_TOKEN");
  if (missing.length) throw new Error("Missing env vars: " + missing.join(", "));
}

async function shopifyGraphQL(query, variables = {}) {
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
    console.error("Shopify GraphQL errors:", JSON.stringify(json.errors, null, 2));
    throw new Error("Shopify GraphQL error");
  }
  return json.data;
}

/* -------------------------
   GraphQL queries
-------------------------- */

const FIND_ORDER_QUERY = `
  query FindOrder($q: String!) {
    orders(first: 1, query: $q, sortKey: PROCESSED_AT, reverse: true) {
      edges {
        node {
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

// IMPORTANT: your Care Guide metafield is a "Blog post" reference.
// For Article, the field is "url" (NOT onlineStoreUrl).
const PRODUCT_METAFIELDS_QUERY = `
  query ProductMetafields($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        metafield(namespace: "custom", key: "care_guide") {
          reference {
            ... on Article {
              url
              title
            }
          }
        }
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

/* -------------------------
   Routes
-------------------------- */

// health check (prevents "Cannot GET /" confusion)
app.get("/", (req, res) => res.status(200).send("ok"));

app.get("/care-guides", async (req, res) => {
  try {
    const orderParam = (req.query.order || "").toString().trim();
    const rawGuides = (req.query.guides || "").toString().trim();

    // Keep your older mode working: ?guides=url,url
    if (!orderParam && rawGuides) {
      const urls = dedupeUrls(rawGuides.split(","));
      return res.json({
        ok: true,
        guides: urls,
        meta: { mode: "guides", count: urls.length, phase: 1 },
      });
    }

    if (!orderParam) {
      return res.json({
        ok: true,
        guides: [],
        meta: { mode: "none", count: 0, phase: 1 },
      });
    }

    // Build Shopify search query (Shopify order names include #)
    const orderNumber = orderParam.replace(/^#/, "");
    const q = `name:#${orderNumber}`;

    // 1) Find order, extract product IDs from line items
    const orderData = await shopifyGraphQL(FIND_ORDER_QUERY, { q });
    const edge = orderData?.orders?.edges?.[0];

    const shopifyOrderName = edge?.node?.name || `#${orderNumber}`;

    const productIds = (edge?.node?.lineItems?.edges || [])
      .map((e) => e?.node?.product?.id)
      .filter(Boolean);

    const uniqueProductIds = [...new Set(productIds)];

    if (!uniqueProductIds.length) {
      return res.json({
        ok: true,
        guides: [],
        meta: {
          mode: "order",
          order: orderNumber,
          shopify_order: shopifyOrderName,
          count: 0,
          phase: 2,
        },
      });
    }

    // 2) Fetch metafield references (Article.url) for those products
    const productData = await shopifyGraphQL(PRODUCT_METAFIELDS_QUERY, {
      ids: uniqueProductIds,
    });

    const urls = dedupeUrls(
      (productData?.nodes || [])
        .map((n) => n?.metafield?.reference?.url)   // <-- FIXED HERE
        .filter(Boolean)
    );

    return res.json({
      ok: true,
      guides: urls,
      meta: {
        mode: "order",
        order: orderNumber,
        shopify_order: shopifyOrderName,
        count: urls.length,
        phase: 2,
      },
    });
  } catch (err) {
    console.error("care-guides error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: "Care guides lookup failed",
      detail: err?.message || String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Care Guides Proxy listening on port ${PORT}`);
});
