import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * This service is called DIRECTLY from the browser on belgraveorchids.com.au
 * Therefore CORS headers are REQUIRED.
 */

// ---- CORS CONFIG ----
const ALLOWED_ORIGINS = new Set([
  "https://belgraveorchids.com.au",
  "https://www.belgraveorchids.com.au",
  "http://localhost:3000"
]);

const ALLOW_ANY_ORIGIN = false; // set true if you want to allow all origins

// ---- CORS MIDDLEWARE (MUST BE FIRST) ----
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (ALLOW_ANY_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Handle preflight
app.options("*", (req, res) => res.sendStatus(204));

// ---- BASIC MIDDLEWARE ----
app.use(express.json({ limit: "256kb" }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// ---- HELPERS ----
function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeAndDedup(list) {
  const seen = new Set();
  const out = [];

  for (const raw of list) {
    const url = String(raw || "").trim();
    if (!url) continue;
    if (!isValidHttpUrl(url)) continue;
    if (seen.has(url)) continue;

    seen.add(url);
    out.push(url);
  }

  return out;
}

// ---- HEALTH CHECK ----
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

// ---- CARE GUIDES ENDPOINT ----
/**
 * GET /care-guides
 *
 * Supported:
 *  - ?guides=URL,URL
 *  - ?order=1682&format=json
 *
 * Phase 1:
 *  - order mode returns [] (UI always renders General guide)
 */
app.get("/care-guides", (req, res) => {
  try {
    const order = String(req.query.order || "").trim();
    const guidesParam = String(req.query.guides || "").trim();

    // Mode A — explicit guide list
    if (guidesParam) {
      const guides = normalizeAndDedup(guidesParam.split(","));

      return res.status(200).json({
        ok: true,
        guides,
        meta: {
          mode: "guides",
          count: guides.length
        }
      });
    }

    // Mode B — order lookup (Phase 1 stub)
    if (order) {
      return res.status(200).json({
        ok: true,
        guides: [],
        meta: {
          mode: "order",
          order,
          count: 0,
          phase: 1
        }
      });
    }

    // Invalid request
    return res.status(400).json({
      ok: false,
      error: "Missing query",
      detail: "Provide either ?guides=URL,URL or ?order=####"
    });
  } catch (err) {
    console.error("CARE-GUIDES ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: "Unexpected error while building care guides response"
    });
  }
});

// ---- START SERVER ----
app.listen(PORT, () => {
  console.log(`Care Guides proxy running on port ${PORT}`);
});
