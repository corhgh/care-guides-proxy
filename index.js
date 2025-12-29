import express from "express";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

const { SHOPIFY_APP_PROXY_SECRET } = process.env;

function verifyProxySignature(query, secret) {
  const q = { ...query };
  const signature = q.signature;
  if (!signature || !secret) return false;
  delete q.signature;

  const message = Object.keys(q)
    .sort()
    .map((k) => `${k}=${Array.isArray(q[k]) ? q[k].join(",") : q[k]}`)
    .join("");

  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");

  if (signature.length !== digest.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

app.get("/care-guides", (req, res) => {
  if (!verifyProxySignature(req.query, SHOPIFY_APP_PROXY_SECRET)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  // Temporary response (we’ll wire Shopify Admin API next)
  return res.json({ ok: true, guides: [] });
});

app.listen(PORT, () => console.log(`Running on ${PORT}`));
