/**
 * Belgrave Orchids — Care Guides Proxy (Render)
 * Phase 1: Public endpoint that returns guide URLs from either:
 *   - ?guides=URL,URL
 *   - ?order=####  (returns [] for now; Phase 2 will map order -> products -> metafield URLs)
 *
 * IMPORTANT: This service is called directly from the browser on belgraveorchids.com.au
 * so it MUST send proper CORS headers.
 */

import express from "express";
import helmet from "helmet";

const app = express();

// -------------------- Config --------------------
const PORT = process.env.PORT || 3000;

// Allow these origins to fetch from the browser.
// You can add your staging domain here if needed.
const ALLOWED_ORIGINS = new Set([
  "https://belgraveorchids.com.au",
  "https://www.belgraveorchids.com.au",
  // Optional local dev:
  "http://localhost:3000",
  "http://localhost:5173",
]);

// If you want to allow ANY origin (public endpoint), set this to true.
// For your use-case, allowing all is acceptable because this endpoint is read-only.
const ALLOW_ANY_ORIGIN = false;

// -------------------- Middleware --------------------
app.use(helmet());

// CORS (must come before routes)
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (ALLOW_ANY_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  // Let browsers do preflight
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // If you ever use cookies/credentials, you'd need:
  // res.setHeader("Access-Control-Allow-Credentials", "true");

  next();
});

// Handle preflight OPTIONS for all routes
app.options("*", (req, res) => {
  return res.sendStatus(204);
});

// Basic JSON parsing (not strictly needed for GET, but safe)
app.use(express.json({ limit: "256kb" }));

// No caching (nice for debugging; change later if desired)
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// -------------------- Helpers --------------------
function isValidHttpUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeAndDedup(urls) {
  const out = [];
  const seen = new Set();

  for (const raw of urls) {
    const u = String(raw || "").trim();
    if (!u) continue;
    if (!isValidHttpUrl(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

// -------------------- Routes --------------------
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

/**
 * GET /care-guides
 * - ?guides=URL,URL
 * - ?order=1682&format=json
 */
app.get("/care-guides", async (req, res) => {
  try {
    const order = String(req.query.order || "").trim();
    const guidesParam = String(req.query.guides || "").trim();

    // Mode A: explicit guides list
    if (guidesParam) {
      const guides = normalizeAndDedup(
        guidesParam.split(",").map((s) => s.trim())
      );

      return res.status(200).json({
        ok: true,
        guides,
        meta: {
          mode: "guides",
          count: guides.length,
        },
      });
    }

    // Mode B: order lookup (Phase 1 returns empty list)
    if (order) {
      // Phase 1: we don't map order -> line items -> metafields yet
      // so return an empty list (your Shopify page will still render ALWAYS guide).
      const guides = [];

      return res.status(200).json({
        ok: true,
        guides,
        meta: {
          mode: "order",
          order,
          count: guides.length,
          phase: 1,
        },
      });
    }

    // No valid input
    return res.status(400).json({
      ok: false,
      error: "Missing query",
      detail: "Provide either ?guides=URL,URL or ?order=####",
    });
  } catch (err) {
    console.error("CARE-GUIDES ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: "Unexpected error while building care guides response.",
    });
  }
});

// -------------------- Start --------------------
app.listen(PORT, () => {
  console.log(`Care Guides proxy listening on port ${PORT}`);
});
