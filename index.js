/**
 * Care Guides Proxy (Shopify App Proxy signed requests)
 *
 * Shopify App Proxy calls include query params + a signature.
 * We verify signature using your app API Secret (NOT admin token).
 */

import express from "express";
import crypto from "crypto";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const ALLOW_DIRECT = String(process.env.ALLOW_DIRECT || "").toLowerCase() === "true";

// ====== EDIT THIS LIST ======
const CARE_GUIDES = [
  {
    title: "Dracula Orchids — Care Guide",
    url: "https://belgraveorchids.com.au/blogs/care-guides/dracula-orchids-care-guide",
    note: "Cool-growing, high humidity, low heat tolerance",
  },
];

// ---- helpers ----
function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Shopify App Proxy signature verification
 *
 * Shopify sends query params including `signature`.
 * To verify:
 * 1) Remove `signature`
 * 2) Sort params by key (lexicographic)
 * 3) Build message: key=value pairs concatenated with no separators? -> Shopify app proxy uses:
 *    message = key=value for each sorted key, joined with nothing? (common legacy)
 * In practice, Shopify expects: key=value&key2=value2... then HMAC-SHA256 secret, compare to signature.
 *
 * We'll do the robust approach used widely:
 * - Build querystring with & between pairs (after sorting)
 * - Use HMAC-SHA256 with SHOPIFY_API_SECRET
 * - Compare hex digest to provided signature
 */
function verifyAppProxy(req) {
  const q = { ...req.query };

  const provided = (q.signature || "").toString();
  if (!provided) {
    return { ok: false, error: "Missing signature" };
  }
  if (!SHOPIFY_API_SECRET) {
    return { ok: false, error: "Server missing SHOPIFY_API_SECRET" };
  }

  delete q.signature;

  // Shopify may include arrays; normalize to strings
  const keys = Object.keys(q).sort();
  const pairs = keys.map((k) => {
    const v = Array.isArray(q[k]) ? q[k].join(",") : String(q[k]);
    return `${k}=${v}`;
  });

  const message = pairs.join("&");

  const digest = crypto
    .createHmac("sha256", SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");

  // Shopify signature is hex
  const ok = timingSafeEqual(digest, provided);
  return ok ? { ok: true } : { ok: false, error: "Invalid signature" };
}

/**
 * Determine whether this request is coming via Shopify proxy.
 * Shopify proxy requests include at least: shop, path_prefix, timestamp, signature (and sometimes logged_in_customer_id).
 */
function looksLikeShopifyProxy(req) {
  return Boolean(req.query && req.query.signature && req.query.shop);
}

function renderPage({ title, intro, items }) {
  const now = new Date().toISOString();
  const list = items
    .map(
      (g) => `
      <li class="card">
        <a class="title" href="${esc(g.url)}">${esc(g.title)}</a>
        ${g.note ? `<div class="note">${esc(g.note)}</div>` : ""}
        <div class="meta">${esc(g.url)}</div>
      </li>
    `
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(title)}</title>
  <meta name="robots" content="noindex,nofollow"/>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; background:#fff; color:#111; }
    .wrap { max-width: 920px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 40px; margin: 0 0 8px; }
    p { margin: 0 0 18px; line-height: 1.5; color: #333; }
    .small { font-size: 12px; color: #666; margin-top: 10px; }
    .grid { list-style: none; padding: 0; margin: 18px 0 0; display: grid; grid-template-columns: 1fr; gap: 12px; }
    @media (min-width: 720px) { .grid { grid-template-columns: 1fr 1fr; } }
    .card { border: 1px solid #e5e5e5; border-radius: 14px; padding: 14px; }
    .title { font-weight: 700; font-size: 16px; color: #111; text-decoration: none; }
    .title:hover { text-decoration: underline; }
    .note { margin-top: 8px; color:#333; font-size: 13px; line-height: 1.4; }
    .meta { margin-top: 10px; font-size: 12px; color: #777; word-break: break-all; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${esc(title)}</h1>
    <p>${esc(intro)}</p>
    <ul class="grid">${list || `<li class="card">No guides yet.</li>`}</ul>
    <p class="small">Updated: ${esc(now)}</p>
  </div>
</body>
</html>`;
}

// Health page
app.get("/", (req, res) => {
  res.status(200).send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Care Guides Proxy</title></head>
<body style="font-family:system-ui; padding:24px">
<h1>Care Guides Proxy</h1>
<p>Status: OK</p>
<ul>
  <li>Proxy endpoint: <code>/care-guides</code></li>
  <li>Time: <code>${new Date().toISOString()}</code></li>
</ul>
</body></html>`);
});

// Middleware to enforce Shopify signature on proxy endpoints
function requireShopifySignature(req, res, next) {
  // If it looks like a Shopify proxy request, enforce verification.
  if (looksLikeShopifyProxy(req)) {
    const check = verifyAppProxy(req);
    if (!check.ok) {
      return res.status(401).json({ ok: false, error: "Unauthorized", detail: check.error });
    }
    return next();
  }

  // Otherwise it's a direct hit (browser/testing). Allow only if explicitly enabled.
  if (ALLOW_DIRECT) return next();

  return res.status(401).json({
    ok: false,
    error: "Unauthorized",
    detail: "Direct access disabled (set ALLOW_DIRECT=true to test without Shopify signature)",
  });
}

// Shopify proxy page
app.get("/care-guides", requireShopifySignature, (req, res) => {
  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(
    renderPage({
      title: "Care Guides",
      intro:
        "Start here. These guides are written for cool-growing orchids and long-term success — not quick fixes.",
      items: CARE_GUIDES,
    })
  );
});

// JSON endpoint (also signed via proxy)
app.get("/care-guides.json", requireShopifySignature, (req, res) => {
  res.status(200).json({
    ok: true,
    count: CARE_GUIDES.length,
    guides: CARE_GUIDES,
    time: new Date().toISOString(),
  });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found", path: req.path });
});

app.listen(PORT, () => {
  console.log(`Care Guides Proxy listening on port ${PORT}`);
});
