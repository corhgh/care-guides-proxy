/**
 * Care Guides Proxy (v2.3.0)
 *
 * ✔ Smart HTML landing page (default)
 * ✔ JSON via ?format=json
 * ✔ ROOT fallback if Shopify proxy points to "/"
 * ✔ NO Shopify signature enforcement (intentional)
 * ✔ Supports full URLs in query params
 * ✔ NO Admin API token
 * ✔ NO Storefront token
 */

import express from "express";

const app = express();
const VERSION = "2.3.0";

const { PORT, NODE_ENV, RENDER_GIT_COMMIT } = process.env;

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

function nowIso() {
  return new Date().toISOString();
}

function parseGuides(req) {
  const list = [];

  if (req.query.guides) {
    String(req.query.guides)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((u) => list.push(u));
  }

  const g = req.query.guide;
  if (g) {
    if (Array.isArray(g)) g.forEach((u) => list.push(String(u).trim()));
    else list.push(String(g).trim());
  }

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

  return out.slice(0, 50);
}

function wantsJson(req) {
  const f = String(req.query.format || "").toLowerCase();
  if (f === "json") return true;
  if (f === "html") return false;

  const accept = String(req.headers.accept || "").toLowerCase();
  return accept.includes("application/json") && !accept.includes("text/html");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function titleFromUrl(url) {
  try {
    const u = new URL(url);
    const slug = u.pathname.split("/").filter(Boolean).pop();
    if (!slug) return url;
    const t = slug.replaceAll("-", " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  } catch {
    return url;
  }
}

function renderHtml({ guides }) {
  const items = guides
    .map(
      (url) => `
      <li>
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener">
          ${escapeHtml(titleFromUrl(url))}
        </a>
        <div class="url">${escapeHtml(url)}</div>
      </li>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Care Guides — Belgrave Orchids</title>
<meta name="robots" content="noindex,nofollow">
<style>
  body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; background:#fafafa; color:#111; }
  .wrap { max-width:860px; margin:0 auto; padding:32px 16px 56px; }
  .card { background:#fff; border:1px solid #e6e6e6; border-radius:14px; padding:20px; }
  h1 { margin:0 0 10px; font-size:22px; }
  p { margin:0 0 16px; color:#555; }
  ul { list-style:none; padding:0; margin:0; }
  li { padding:12px 0; border-top:1px solid #eee; }
  li:first-child { border-top:0; }
  a { font-weight:600; color:#111; text-decoration:none; }
  a:hover { text-decoration:underline; }
  .url { margin-top:6px; font-size:12px; color:#777; word-break:break-all; }
  .meta { margin-top:16px; font-size:12px; color:#777; display:flex; justify-content:space-between; flex-wrap:wrap; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>Your care guides</h1>
    <p>These guides are matched to the plants in your order. Save this page for reference.</p>
    ${guides.length ? `<ul>${items}</ul>` : `<p>No care guides were found.</p>`}
    <div class="meta">
      <div>Belgrave Orchids</div>
      <div>Public link</div>
    </div>
  </div>
</div>
</body>
</html>`;
}

/* -------------------------------------------------- */
/* Core handler                                       */
/* -------------------------------------------------- */

function handleCareGuides(req, res) {
  const guides = parseGuides(req);

  if (wantsJson(req)) {
    return res.status(200).json({
      ok: true,
      guides,
      meta: { count: guides.length },
    });
  }

  return res.status(200).type("text/html").send(renderHtml({ guides }));
}

/* -------------------------------------------------- */
/* Routes                                             */
/* -------------------------------------------------- */

app.get("/", (req, res) => {
  // Root fallback for Shopify App Proxy
  if (req.query.guides || req.query.guide) {
    return handleCareGuides(req, res);
  }

  res.status(200).type("text/plain").send(
    [
      "Care Guides Proxy – Status OK",
      `Version: ${VERSION}`,
      `Time: ${nowIso()}`,
      `Node env: ${NODE_ENV || "unknown"}`,
    ].join("\n")
  );
});

app.get("/care-guides", handleCareGuides);

app.get("/healthz", (req, res) => {
  res.status(200).json({
    ok: true,
    version: VERSION,
    commit: RENDER_GIT_COMMIT || null,
    time: nowIso(),
  });
});

app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));

const port = Number(PORT) || 3000;
app.listen(port, () => {
  console.log(`[Care Guides Proxy] ${VERSION} listening on ${port}`);
});
