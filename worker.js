// Cloudflare Worker — care-guides-proxy
// Env vars (set in Cloudflare dashboard or wrangler secret put):
//   SHOPIFY_SHOP_DOMAIN
//   SHOPIFY_ADMIN_API_TOKEN
//   SHOPIFY_API_VERSION  (optional, default 2025-01)
//   STOREFRONT_BASE      (optional, default https://belgraveorchids.com.au)

const ALLOWED_ORIGINS = new Set([
  "https://belgraveorchids.com.au",
  "https://www.belgraveorchids.com.au",
]);

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

async function shopifyGraphQL(env, query, variables = {}) {
  const shop = env.SHOPIFY_SHOP_DOMAIN;
  const token = env.SHOPIFY_ADMIN_API_TOKEN;
  const version = env.SHOPIFY_API_VERSION || "2025-01";
  if (!shop || !token) throw new Error("Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_API_TOKEN");
  const url = `https://${shop}/admin/api/${version}/graphql.json`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`Shopify returned non-JSON: HTTP ${resp.status} ${text.slice(0, 500)}`);
  }
  if (!resp.ok) throw Object.assign(new Error(`Shopify HTTP ${resp.status}`), { shopify: json?.errors || json });
  if (json.errors?.length) throw Object.assign(new Error("Shopify GraphQL error"), { shopify: json.errors });
  return json.data;
}

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
              summary
              image { url altText }
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

function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(str, n) {
  if (!str) return "";
  str = str.trim();
  return str.length > n ? str.slice(0, n).replace(/\s+\S*$/, "") + "…" : str;
}

function buildGuideObject(env, articleRef) {
  const aHandle = articleRef?.handle;
  const bHandle = articleRef?.blog?.handle;
  if (!aHandle || !bHandle) return null;
  const base = env.STOREFRONT_BASE || "https://belgraveorchids.com.au";
  const url = `${base}/blogs/${bHandle}/${aHandle}`;
  return {
    url,
    title: articleRef.title || null,
    summary: truncate(stripHtml(articleRef.summary), 160) || null,
    image: articleRef.image?.url || null,
    imageAlt: articleRef.image?.altText || articleRef.title || null,
  };
}

async function handleCareGuides(request, env) {
  const { searchParams } = new URL(request.url);
  const orderParam = (searchParams.get("order") || "").trim();
  const rawGuides = (searchParams.get("guides") || "").trim();

  if (!orderParam && rawGuides) {
    const urls = dedupe(rawGuides.split(",").map(s => s.trim()).filter(Boolean));
    return { ok: true, guides: urls, guideDetails: [], meta: { mode: "guides", count: urls.length, phase: 1 } };
  }

  if (!orderParam) {
    return { ok: true, guides: [], guideDetails: [], meta: { mode: "none", count: 0, phase: 1 } };
  }

  const orderNumber = orderParam.replace(/^#/, "");
  const orderData = await shopifyGraphQL(env, FIND_ORDER_QUERY, { q: `name:#${orderNumber}` });
  const edge = orderData?.orders?.edges?.[0];
  const shopifyOrderName = edge?.node?.name || `#${orderNumber}`;

  const productIds = dedupe(
    (edge?.node?.lineItems?.edges || []).map(e => e?.node?.product?.id)
  );

  if (!productIds.length) {
    return { ok: true, guides: [], guideDetails: [], meta: { mode: "order", order: orderNumber, shopify_order: shopifyOrderName, count: 0, phase: 2 } };
  }

  const prodData = await shopifyGraphQL(env, PRODUCT_CARE_GUIDE_REFERENCE_QUERY, { ids: productIds });

  const seen = new Set();
  const guides = (prodData?.nodes || [])
    .map(n => buildGuideObject(env, n?.metafield?.reference))
    .filter(Boolean)
    .filter(g => {
      if (seen.has(g.url)) return false;
      seen.add(g.url);
      return true;
    });

  return {
    ok: true,
    guides: guides.map(g => g.url),
    guideDetails: guides,
    meta: { mode: "order", order: orderNumber, shopify_order: shopifyOrderName, count: guides.length, phase: 2 },
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === "/") {
      return new Response("ok", { status: 200, headers: corsHeaders(origin) });
    }

    if (url.pathname === "/care-guides") {
      try {
        const result = await handleCareGuides(request, env);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error("care-guides error:", err?.message || err);
        return new Response(JSON.stringify({
          ok: false,
          error: "Care guides lookup failed",
          detail: { message: err?.message || String(err), shopify_errors: err?.shopify || null },
        }), {
          status: 500,
          headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders(origin) });
  },
};
