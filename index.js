/**
 * Care Guides Proxy (Render / Node)
 * Routes:
 *   GET /                 -> health page (fixes "Cannot GET /")
 *   GET /care-guides      -> Shopify App Proxy endpoint (customers hit /apps/care-guides)
 *
 * Env required:
 *   SHOPIFY_API_SECRET
 *   SHOPIFY_ADMIN_ACCESS_TOKEN
 *   SHOPIFY_STORE_DOMAIN (e.g. belgraveorchids.com.au)
 *
 * Optional:
 *   ALLOW_NO_HMAC=true   (debug only; skips HMAC check if no signature present)
 */

import express from "express";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- ENV ----------
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "";
const ALLOW_NO_HMAC = (process.env.ALLOW_NO_HMAC || "").toLowerCase() === "true";

// Basic startup validation (keeps logs obvious)
function requireEnv(name, value) {
  if (!value) {
    console.warn(`[WARN] Missing env: ${name}`);
  }
}
requireEnv("SHOPIFY_API_SECRET", SHOPIFY_API_SECRET);
requireEnv("SHOPIFY_ADMIN_ACCESS_TOKEN", SHOPIFY_ADMIN_ACCESS_TOKEN);
requireEnv("SHOPIFY_STORE_DOMAIN", SHOPIFY_STORE_DOMAIN);

// ---------- Helpers ----------
function timingSafeEqual(a, b) {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function verifyShopifyProxyHmac(req) {
  // Shopify app proxy uses "signature" (NOT "hmac") in many cases
  const signature = req.query.signature;

  // If Shopify isn't including it (during testing), allow skipping if explicitly set
  if (!signature) {
    if (ALLOW_NO_HMAC) return { ok: true, skipped: true };
    return { ok: false, reason: "Missing signature" };
  }

  if (!SHOPIFY_API_SECRET) return { ok: false, reason: "Server missing SHOPIFY_API_SECRET" };

  // Build message from query params except "signature"
  const params = { ...req.query };
  delete params.signature;

  // Sort keys + join as key=value (Shopify proxy signing format)
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${Array.isArray(params[k]) ? params[k].join(",") : params[k]}`)
    .join("");

  const digest = crypto.createHmac("sha256", SHOPIFY_API_SECRET).update(message).digest("hex");

  const ok = timingSafeEqual(digest, String(signature));
  return ok ? { ok: true } : { ok: false, reason: "Bad signature" };
}

async function shopifyGraphQL(query, variables = {}) {
  if (!SHOPIFY_STORE_DOMAIN) throw new Error("Missing SHOPIFY_STORE_DOMAIN");
  if (!SHOPIFY_ADMIN_ACCESS_TOKEN) throw new Error("Missing SHOPIFY_ADMIN_ACCESS_TOKEN");

  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-10/graphql.json`;

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
    throw new Error(`Shopify response not JSON: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`Shopify API ${res.status}: ${text.slice(0, 500)}`);
  }
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// ---------- Routes ----------

// 1) Root route (fixes "Cannot GET /" when you open the app or hit the service URL)
app.get("/", (req, res) => {
  res.status(200).send(`
    <html>
      <head><title>Care Guides Proxy</title></head>
      <body style="font-family: system-ui; padding: 24px;">
        <h1>Care Guides Proxy</h1>
        <p>Status: <strong>OK</strong></p>
        <ul>
          <li>Proxy endpoint: <code>/care-guides</code></li>
          <li>Time: ${new Date().toISOString()}</li>
        </ul>
      </body>
    </html>
  `);
});

// 2) App Proxy endpoint (Shopify storefront hits /apps/care-guides, Shopify forwards here)
app.get("/care-guides", async (req, res) => {
  // Verify proxy signature
  const sig = verifyShopifyProxyHmac(req);
  if (!sig.ok) {
    return res.status(401).json({ ok: false, error: "Unauthorized", detail: sig.reason });
  }

  // Basic optional inputs Shopify proxy often includes:
  // req.query.logged_in_customer_id, req.query.shop, req.query.path_prefix, etc.

  try {
    // Example: read shop name (proof token works).
    // You can replace this later with your “find care guides for order/customer” logic.
    const data = await shopifyGraphQL(`
      query {
        shop {
          name
          primaryDomain { url }
        }
      }
    `);

    // Return JSON (easy to test in browser)
    res.status(200).json({
      ok: true,
      shop: data.shop?.name || null,
      domain: data.shop?.primaryDomain?.url || null,
      guides: [], // placeholder for your real guide list
      hmac: sig.skipped ? "skipped" : "verified",
    });
  } catch (err) {
    console.error("[/care-guides] error:", err);
    res.status(500).json({ ok: false, error: "Server error", detail: String(err.message || err) });
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Care Guides Proxy listening on :${PORT}`);
});
