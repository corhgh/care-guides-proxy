// Care Guides Proxy (Railway)
//
// Powers belgraveorchids.com.au/pages/your-care-guides (short link belgrv.au/care).
//   GET /care-guides?order=2287  ->  the care guides for the products in that order
//   GET /health                  ->  checks the Shopify connection (for monitoring)
//
// Each product's guide comes from the product metafield custom.care_guide (an Article
// reference). Products without one fall back to the genus care guide, matched by
// product title / type against the care-guides blog.
//
// Environment (Railway → care-guides-proxy → Variables):
//   SHOPIFY_SHOP_DOMAIN       e.g. 7a6d38-5.myshopify.com
//   SHOPIFY_ADMIN_API_TOKEN   Admin API token. Needs only read_orders, read_products, read_content
//   SHOPIFY_API_VERSION       optional (default below)
//   STOREFRONT_BASE           optional (default https://belgraveorchids.com.au)

import express from "express";

const PORT = process.env.PORT || 3000;
const SHOP = process.env.SHOPIFY_SHOP_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";
const STOREFRONT_BASE = (process.env.STOREFRONT_BASE || "https://belgraveorchids.com.au").replace(/\/$/, "");

const ALLOWED_ORIGINS = new Set([
  "https://belgraveorchids.com.au",
  "https://www.belgraveorchids.com.au",
]);
const CACHE_MS = 60 * 60 * 1000;    // cache each order's guides (and the guide list) for an hour
const RATE_LIMIT = 30;              // lookups per IP per minute
const ORDER_RE = /^#?(\d{1,10})$/;  // order numbers only — nothing else reaches Shopify search

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true); // Railway sits behind a proxy; req.ip = real client IP

// ── CORS ──────────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ── Small helpers ───────────────────────────────────────────────────────────────
const stripHtml = (html) => (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
function truncate(str, n) {
  if (!str) return "";
  str = str.trim();
  return str.length > n ? str.slice(0, n).replace(/\s+\S*$/, "") + "…" : str;
}

const cache = new Map(); // key -> { at, value }
function cacheGet(key) {
  const e = cache.get(key);
  if (!e || Date.now() - e.at > CACHE_MS) { cache.delete(key); return null; }
  return e.value;
}
function cacheSet(key, value) {
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

const hits = new Map(); // ip -> { start, n }
function rateLimited(ip) {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now - e.start > 60000) { hits.set(ip, { start: now, n: 1 }); return false; }
  e.n++;
  return e.n > RATE_LIMIT;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of hits) if (now - e.start > 120000) hits.delete(ip);
}, 5 * 60 * 1000).unref();

// ── Shopify ─────────────────────────────────────────────────────────────────────────
async function shopifyGraphQL(query, variables = {}) {
  if (!SHOP || !TOKEN) throw new Error("Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_API_TOKEN");
  const resp = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8000),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Shopify non-JSON HTTP ${resp.status}: ${text.slice(0, 200)}`); }
  if (!resp.ok) throw new Error(`Shopify HTTP ${resp.status}: ${JSON.stringify(data.errors || data).slice(0, 300)}`);
  if (data.errors?.length) throw new Error(`Shopify GraphQL: ${JSON.stringify(data.errors).slice(0, 300)}`);
  return data.data;
}

const ORDER_QUERY = `
  query OrderGuides($q: String!) {
    orders(first: 1, query: $q) {
      edges { node {
        name
        lineItems(first: 100) { edges { node {
          product {
            id title productType
            metafield(namespace: "custom", key: "care_guide") {
              reference { ... on Article { handle title summary blog { handle } image { url altText } } }
            }
          }
        } } }
      } }
    }
  }`;

const BLOG_QUERY = `
  query CareGuides {
    blogs(first: 1, query: "handle:care-guides") {
      edges { node { articles(first: 100) { edges { node {
        handle title summary blog { handle } image { url altText }
      } } } } }
    }
  }`;

function guideFromArticle(a) {
  if (!a?.handle || !a?.blog?.handle) return null;
  return {
    url: `${STOREFRONT_BASE}/blogs/${a.blog.handle}/${a.handle}`,
    title: a.title || null,
    summary: truncate(stripHtml(a.summary), 160) || null,
    image: a.image?.url || null,
    imageAlt: a.image?.altText || a.title || null,
  };
}

// Genus fallback for products without a care_guide metafield (most specific first).
const GENERA = ["dracuvallia", "porrovallia", "dracula", "masdevallia", "sarcochilus", "cymbidium",
  "dockrillia", "cuthbertsonii", "monophyllum", "speciosum", "kingianum"];
function genusFallback(product, articles) {
  const text = `${product.title || ""} ${product.productType || ""}`.toLowerCase();
  for (const g of GENERA) {
    if (!text.includes(g)) continue;
    const hit = articles.find(a => a.handle.includes(g));
    if (hit) return hit;
  }
  return null;
}

async function careGuideArticles() {
  const cached = cacheGet("articles");
  if (cached) return cached;
  const data = await shopifyGraphQL(BLOG_QUERY);
  const articles = (data?.blogs?.edges?.[0]?.node?.articles?.edges || []).map(e => e.node);
  cacheSet("articles", articles);
  return articles;
}

async function guidesForOrder(orderNumber) {
  const data = await shopifyGraphQL(ORDER_QUERY, { q: `name:#${orderNumber}` });
  const order = data?.orders?.edges?.[0]?.node;
  // Shopify search can be loose — only accept an exact order-name match.
  if (!order || order.name.replace(/^#/, "") !== orderNumber) return { found: false, guides: [] };

  const products = (order.lineItems?.edges || []).map(e => e.node?.product).filter(Boolean);
  let articles = null;
  const seen = new Set();
  const guides = [];
  for (const p of products) {
    let article = p.metafield?.reference || null;
    if (!article) {
      articles = articles || await careGuideArticles().catch(() => []);
      article = genusFallback(p, articles);
    }
    const g = guideFromArticle(article);
    if (g && !seen.has(g.url)) { seen.add(g.url); guides.push(g); }
  }
  return { found: true, guides };
}

// ── Routes ──────────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.status(200).send("ok"));

app.get("/health", async (req, res) => {
  try {
    await shopifyGraphQL("{ shop { name } }");
    res.json({ ok: true, shopify: "connected", apiVersion: API_VERSION });
  } catch (err) {
    console.error("health check failed:", err.message);
    res.status(503).json({ ok: false, shopify: "error" });
  }
});

app.get("/care-guides", async (req, res) => {
  const raw = String(req.query.order || "").trim();
  if (!raw) return res.json({ ok: true, guides: [], guideDetails: [], meta: { mode: "none", count: 0 } });

  const m = ORDER_RE.exec(raw);
  if (!m) return res.status(400).json({ ok: false, error: "Invalid order number" });
  const orderNumber = m[1];

  if (rateLimited(req.ip || "unknown")) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ ok: false, error: "Too many requests" });
  }

  const cached = cacheGet(`order:${orderNumber}`);
  if (cached) { res.setHeader("X-Cache", "HIT"); return res.json(cached); }

  try {
    const { found, guides } = await guidesForOrder(orderNumber);
    const body = {
      ok: true,
      guides: guides.map(g => g.url),
      guideDetails: guides,
      meta: { mode: "order", order: orderNumber, found, count: guides.length },
    };
    cacheSet(`order:${orderNumber}`, body);
    res.setHeader("X-Cache", "MISS");
    return res.json(body);
  } catch (err) {
    // Details go to the logs only — never to the public.
    console.error(`care-guides error (order ${orderNumber}):`, err?.message || err);
    return res.status(502).json({ ok: false, error: "Care guides lookup failed" });
  }
});

app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));

app.listen(PORT, () => {
  console.log(`Care Guides Proxy listening on port ${PORT} (Shopify API ${API_VERSION}${SHOP && TOKEN ? "" : ", NOT CONFIGURED"})`);
});
