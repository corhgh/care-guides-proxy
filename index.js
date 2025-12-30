// index.js
// Care Guides Proxy (Shopify App Proxy -> Render)
// Handles:
//  - GET /              (direct hit to subdomain, useful for testing)
//  - GET /care-guides   (Shopify App Proxy target: /apps/care-guides -> proxy subpath "care-guides")
//  - GET /care-guides.json (same data as JSON)
//
// ENV you should set in Render:
//  - SHOPIFY_API_SECRET            (your app "Secret" from Shopify dev dashboard)
//  - SHOPIFY_SHOP_DOMAIN           (optional, e.g. belgraveorchids.com.au OR your *.myshopify.com; only used for strict allow-list)
//  - SHOPIFY_ADMIN_ACCESS_TOKEN    (optional, shpat_... if you want to call Admin API)
//  - SHOPIFY_API_VERSION           (optional, default "2025-10")
//  - PORT                          (Render provides this automatically)

import express from "express";
import crypto from "crypto";

const app = express();

const PORT = process.env.PORT || 3000;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const SHOPIFY_SHOP_DOMAIN = (process.env.SHOPIFY_SHOP_DOMAIN || "").toLowerCase();
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";

// ---- helpers ---------------------------------------------------------------

// Shopify App Proxy verification uses a "signature" query param.
// You build a message from all query params except "signature" (and "hmac" if present),
// sort keys, join as key=value, then HMAC-SHA256 with app secret, hex digest.
function verifyShopifyAppProxySignature(req) {
  if (!SHOPIFY_API_SECRET) return { ok: false, reason: "Missing SHOPIFY_API_SECRET env var" };

  const q = { ...req.query };

  const provided = (q.signature || "").toString();
  if (!provided) return { ok: false, reason: "Missing signature" };

  delete q.signature;
  delete q.hmac; // some contexts include hmac; app proxy uses signature, but safe to remove

  const keys = Object.keys(q).sort();
  const message = keys
    .map((k) => `${k}=${Array.isArray(q[k]) ? q[k].join(",") : q[k]}`)
    .join("");

  const calculated = crypto
    .createHmac("sha256", SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");

  // timing-safe compare
  const a = Buffer.from(calculated, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "Signature length mismatch" };

  const ok = crypto.timingSafeEqual(a, b);
  return ok ? { ok: true } : { ok: false, reason: "Bad signature" };
}

// Optional: if you want to restrict to only your shop,
// Shopify usually passes "shop" query param (like yourshop.myshopify.com)
function shopLooksAllowed(req) {
  if (!SHOPIFY_SHOP_DOMAIN) return true; // not enforcing

  const shop = (req.query.shop || "").toString().toLowerCase();
  if (!shop) return true; // some proxy calls may not include it depending on settings

  // allow either exact match, or if you set SHOPIFY_SHOP_DOMAIN to your myshopify domain
  if (shop === SHOPIFY_SHOP_DOMAIN) return true;

  // If you set SHOPIFY_SHOP_DOMAIN to belgraveorchids.com.au, we can't reliably match shop param.
  // In that case, don't enforce or set SHOPIFY_SHOP_DOMAIN to your *.myshopify.com.
  if (SHOPIFY_SHOP_DOMAIN.endsWith(".com.au") || SHOPIFY_SHOP_DOMAIN.includes(".")) return true;

  return false;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---- data layer ------------------------------------------------------------
// For now, returns a placeholder list.
// Later you can fetch from Shopify Admin API (metafields/metaobjects/blog/articles).

async function getCareGuides() {
  // If you don’t have the Admin token working yet, keep this static.
  // This stops the whole system breaking while you sort auth.
  const staticGuides = [
    { title: "Dracula Orchids", slug: "dracula", href: "/apps/care-guides/dracula" },
    { title: "Masdevallia Orchids", slug: "masdevallia", href: "/apps/care-guides/masdevallia" },
    { title: "Cymbidium Orchids", slug: "cymbidium", href: "/apps/care-guides/cymbidium" },
  ];

  // OPTIONAL: If you later want to call Admin API, put your logic here.
  // This is intentionally conservative: if token is missing, we fall back.
  if (!SHOPIFY_ADMIN_ACCESS_TOKEN) return staticGuides;

  // NOTE: you MUST set SHOPIFY_SHOP_DOMAIN to your store's *.myshopify.com
  // for Admin API calls (e.g. belgrave-orchids.myshopify.com).
  // If you don't, this will just fall back to static.
  if (!SHOPIFY_SHOP_DOMAIN.includes(".myshopify.com")) return staticGuides;

  try {
    // Example: you might fetch metaobjects for care guides.
    // Leaving as a no-op for now, returning static to keep stable.
    return staticGuides;
  } catch (e) {
    return staticGuides;
  }
}

// ---- middleware ------------------------------------------------------------

app.disable("x-powered-by");

app.use((req, res, next) => {
  // helpful headers; keep simple
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

// ---- routes ----------------------------------------------------------------

// Root = useful for direct testing of the subdomain
app.get("/", async (req, res) => {
  res.status(200).send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Care Guides Proxy</title>
      </head>
      <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 860px; margin: 40px auto; line-height: 1.6;">
        <h1>Care Guides Proxy</h1>
        <p><strong>Status:</strong> OK</p>
        <ul>
          <li>Proxy endpoint: <code>/care-guides</code></li>
          <li>Time: ${new Date().toISOString()}</li>
        </ul>
        <p>
          If Shopify App Proxy is set to:
          <br>
          <code>Subpath prefix</code> = <strong>apps</strong>,
          <code>Subpath</code> = <strong>care-guides</strong>,
          <code>Proxy URL</code> = <strong>https://care-guides.belgraveorchids.com.au</strong>
          <br>
          then Shopify will request:
          <br>
          <code>https://care-guides.belgraveorchids.com.au/care-guides</code>
        </p>
      </body>
    </html>
  `);
});

// JSON endpoint (works both direct and via proxy)
app.get("/care-guides.json", async (req, res) => {
  // If Shopify is hitting this through app proxy, it should be signed.
  // If you're testing directly, you can allow unsigned.
  const isLikelyProxyCall = "signature" in req.query;

  if (isLikelyProxyCall) {
    if (!shopLooksAllowed(req)) {
      return res.status(403).json({ ok: false, error: "Forbidden shop" });
    }
    const sig = verifyShopifyAppProxySignature(req);
    if (!sig.ok) return res.status(401).json({ ok: false, error: "Unauthorized", detail: sig.reason });
  }

  const guides = await getCareGuides();
  res.json({ ok: true, guides });
});

// MAIN proxy endpoint
app.get("/care-guides", async (req, res) => {
  // Shopify App Proxy requests should include signature
  const sig = verifyShopifyAppProxySignature(req);
  if (!sig.ok) {
    // show JSON to make debugging less painful
    return res.status(401).send(JSON.stringify({ ok: false, error: "Unauthorized", detail: sig.reason }, null, 2));
  }

  if (!shopLooksAllowed(req)) {
    return res.status(403).send(JSON.stringify({ ok: false, error: "Forbidden shop" }, null, 2));
  }

  const guides = await getCareGuides();

  // Simple clean HTML page (Option A landing page)
  const items = guides
    .map(
      (g) =>
        `<li style="margin: .6em 0;"><a href="${escapeHtml(g.href)}" style="text-decoration:none;">${escapeHtml(
          g.title
        )}</a></li>`
    )
    .join("");

  res.status(200).send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Orchid Care Guides | Belgrave Orchids</title>
        <meta name="robots" content="noindex, follow" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 860px; margin: 40px auto; line-height: 1.6; padding: 0 16px;">
        <h1 style="margin-bottom:.4em;">Orchid Care Guides</h1>
        <p style="margin-top:0;">
          These guides explain how to grow different orchid groups successfully over time.
          Product pages link to the relevant guide.
        </p>

        <h2 style="margin-top:1.2em;">Care Guides</h2>
        <ul style="padding-left: 1.2em;">
          ${items || "<li>No guides yet.</li>"}
        </ul>

        <hr style="margin: 2em 0; opacity:.2;" />
        <p style="font-size:.95em; opacity:.8;">
          Debug: <code>shop=${escapeHtml(req.query.shop || "")}</code> •
          <code>path=/care-guides</code> •
          <code>${new Date().toISOString()}</code>
        </p>
      </body>
    </html>
  `);
});

// Catch-all (so you don't see "Cannot GET /" surprises during testing)
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.path });
});

// ---- start -----------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Care Guides Proxy listening on port ${PORT}`);
});
