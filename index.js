import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const SHOP = process.env.SHOPIFY_SHOP_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const STOREFRONT_BASE = process.env.STOREFRONT_BASE || "https://belgraveorchids.com.au";

app.use(express.json());

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

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Shopify returned non-JSON: HTTP ${resp.status} ${text.slice(0, 500)}`);
  }

  if (!resp.ok) {
    const detail = json?.errors || json;
    throw Object.assign(new Error(`Shopify HTTP ${resp.status}`), { shopify: detail });
  }

  if (json.errors?.length) {
    throw Object.assign(new Error("Shopify GraphQL error"), { shopify: json.errors });
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

// Fetch product care guide metafield — returns article GID as value
const PRODUCT_CARE_GUIDE_REFERENCE_QUERY = `
  query ProductCareGuideRefs($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        metafield(namespace: "custom", key: "care_guide") {
          reference {
            ... on Article {
              handle
              blog { handle }
              title
              image {
                url
                altText
              }
            }
          }
        }
      }
    }
  }
`;

function dedupe(list) {
  return [...new Set(list.filter(Boolean))];
}

function buildArticleUrl(articleRef) {
  const aHandle = articleRef?.handle;
  const bHandle = articleRef?.blog?.handle;
  if (!aHandle || !bHandle) return null;
  return `${STOREFRONT_BASE}/blogs/${bHandle}/${aHandle}`;
}

function buildGuideObject(articleRef) {
  const url = buildArticleUrl(articleRef);
  if (!url) return null;
  return {
    url,
    title: articleRef.title || null,
    image: articleRef.image?.url || null,
    imageAlt: articleRef.image?.altText || articleRef.title || null,
  };
}

/* -------------------------
   Routes
-------------------------- */

app.get("/", (req, res) => res.status(200).send("ok"));

app.get("/care-guides", async (req, res) => {
  try {
    const orderParam = (req.query.order || "").toString().trim();
    const rawGuides = (req.query.guides || "").toString().trim();

    // Keep Phase 1 mode working: ?guides=url,url
    if (!orderParam && rawGuides) {
      const urls = dedupe(rawGuides.split(",").map(s => s.trim()).filter(Boolean));
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

    const orderNumber = orderParam.replace(/^#/, "");
    const q = `name:#${orderNumber}`;

    // 1) Find order -> product IDs
    const orderData = await shopifyGraphQL(FIND_ORDER_QUERY, { q });
    const edge = orderData?.orders?.edges?.[0];
    const shopifyOrderName = edge?.node?.name || `#${orderNumber}`;

    const productIds = (edge?.node?.lineItems?.edges || [])
      .map(e => e?.node?.product?.id)
      .filter(Boolean);

    const uniqueProductIds = dedupe(productIds);

    if (!uniqueProductIds.length) {
      return res.json({
        ok: true,
        guides: [],
        meta: { mode: "order", order: orderNumber, shopify_order: shopifyOrderName, count: 0, phase: 2 },
      });
    }

    // 2) Fetch care guide references with full article data
    const prodData = await shopifyGraphQL(PRODUCT_CARE_GUIDE_REFERENCE_QUERY, {
      ids: uniqueProductIds,
    });

    // Dedupe by URL
    const seen = new Set();
    const guides = (prodData?.nodes || [])
      .map(n => buildGuideObject(n?.metafield?.reference))
      .filter(Boolean)
      .filter(g => {
        if (seen.has(g.url)) return false;
        seen.add(g.url);
        return true;
      });

    // Also return plain URL array for backwards compatibility
    const guideUrls = guides.map(g => g.url);

    return res.json({
      ok: true,
      guides: guideUrls,
      guideDetails: guides,
      meta: { mode: "order", order: orderNumber, shopify_order: shopifyOrderName, count: guides.length, phase: 2 },
    });
  } catch (err) {
    console.error("care-guides error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: "Care guides lookup failed",
      detail: {
        message: err?.message || String(err),
        shopify_errors: err?.shopify || null,
      },
    });
  }
});

app.listen(PORT, () => {
  console.log(`Care Guides Proxy listening on port ${PORT}`);
});
