import express from "express";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Shopify App Proxy HMAC verification
 */
function verifyShopifyProxy(req) {
  const query = { ...req.query };
  const providedHmac = query.hmac;

  if (!providedHmac) return false;

  delete query.hmac;
  delete query.signature; // legacy safety

  const message = Object.keys(query)
    .sort()
    .map((key) => `${key}=${Array.isArray(query[key]) ? query[key].join(",") : query[key]}`)
    .join("&");

  const generatedHmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_APP_SECRET)
    .update(message)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(generatedHmac),
    Buffer.from(providedHmac)
  );
}

/**
 * Health check (NOT proxied)
 */
app.get("/", (req, res) => {
  res.send("Care Guides Proxy running");
});

/**
 * App Proxy endpoint
 * Shopify → /apps/care-guides → Render
 */
app.get("/care-guides", (req, res) => {
  if (!verifyShopifyProxy(req)) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  /**
   * Replace this with real data later
   */
  res.json({
    ok: true,
    guides: [],
  });
});

app.listen(PORT, () => {
  console.log(`Care Guides Proxy listening on ${PORT}`);
});
