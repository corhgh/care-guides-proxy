/**
 * Care Guides Proxy (static list) — Belgrave Orchids
 *
 * Shopify App Proxy:
 *   /apps/care-guides  ->  hits this service at path: /care-guides
 *
 * What this does:
 * - GET /            : simple health page
 * - GET /care-guides : renders a nice HTML index of Care Guides (static list)
 * - GET /care-guides.json : same list as JSON (handy for future)
 */

import express from "express";

const app = express();
app.disable("x-powered-by");

// If you're behind a proxy (Render), this helps with correct IP/https handling.
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

// ====== EDIT THIS LIST ======
// Put your real Care Guide URLs here.
const CARE_GUIDES = [
  {
    title: "Dracula Orchids — Care Guide",
    url: "https://belgraveorchids.com.au/blogs/care-guides/dracula-orchids-care-guide",
    note: "Cool-growing, high humidity, low heat tolerance",
  },
  {
    title: "Masdevallia — Care Guide",
    url: "https://belgraveorchids.com.au/blogs/care-guides/masdevallia-care-guide",
    note: "Cool nights, moisture balance, airflow",
  },
  {
    title: "Cymbidium — Care Guide",
    url: "https://belgraveorchids.com.au/blogs/care-guides/cymbidium-care-guide",
    note: "Seasonal growth, light, feeding, flowering timing",
  },
  {
    title: "Sarcochilus — Care Guide",
    url: "https://belgraveorchids.com.au/blogs/care-guides/sarcochilus-care-guide",
    note: "Potted vs mounted, watering rhythm, light levels",
  },
  {
    title: "Dendrobium — Care Guide",
    url: "https://belgraveorchids.com.au/blogs/care-guides/dendrobium-care-guide",
    note: "Speciosum/kingianum types, seasonal cues",
  },
];

// Simple HTML escaping for safety
function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    :root { color-scheme: light; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 0; background: #fff; color: #111; }
    .wrap { max-width: 920px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 40px; margin: 0 0 8px; }
    p { margin: 0 0 18px; line-height: 1.5; color: #333; }
    .small { font-size: 12px; color: #666; margin-top: 10px; }
    .grid { list-style: none; padding: 0; margin: 18px 0 0; display: grid; grid-template-columns: 1fr; gap: 12px; }
    @media (min-width: 720px) { .grid { grid-template-columns: 1fr 1fr; } }
    .card { border: 1px solid #e5e5e5; border-radius: 14px; padding: 14px 14px 12px; background: #fff; }
    .title { font-weight: 700; font-size: 16px; color: #111; text-decoration: none; }
    .title:hover { text-decoration: underline; }
    .note { margin-top: 8px; color: #333; font-size: 13px; line-height: 1.4; }
    .meta { margin-top: 10px; font-size: 12px; color: #777; word-break: break-all; }
    .bar { margin-top: 14px; display:flex; gap:10px; flex-wrap: wrap; align-items: center; }
    .btn { display:inline-block; padding: 10px 12px; border-radius: 10px; border: 1px solid #e5e5e5; background: #f8f8f8; text-decoration:none; color:#111; font-size: 13px; }
    .btn:hover { background: #f1f1f1; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${esc(title)}</h1>
    <p>${esc(intro)}</p>

    <div class="bar">
      <a class="btn" href="/care-guides.json">View JSON</a>
      <span class="small">Updated: ${esc(now)}</span>
    </div>

    <ul class="grid">
      ${list || `<li class="card">No guides yet.</li>`}
    </ul>

    <p class="small">
      Proxy endpoint: <strong>/care-guides</strong> (Shopify App Proxy → Render).<br/>
      If you want this indexed by Google later, we’ll remove <code>noindex</code> and add canonical/meta properly.
    </p>
  </div>
</body>
</html>`;
}

// Health page (direct hits to your service root)
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

// The Shopify proxied page
app.get("/care-guides", (req, res) => {
  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(
    renderPage({
      title: "Care Guides",
      intro:
        "Start here. These guides are written for cool-growing orchids and long-term success — not quick fixes.",
      items: CARE_GUIDES,
    })
  );
});

// JSON endpoint (handy later for dynamic front-end)
app.get("/care-guides.json", (req, res) => {
  res.status(200).json({
    ok: true,
    count: CARE_GUIDES.length,
    guides: CARE_GUIDES,
    time: new Date().toISOString(),
  });
});

// Basic 404 (prevents “Cannot GET /something” confusion)
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not found",
    path: req.path,
  });
});

app.listen(PORT, () => {
  console.log(`Care Guides Proxy listening on port ${PORT}`);
});
