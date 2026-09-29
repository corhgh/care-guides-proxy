# Care Guides Proxy

Small service behind **belgraveorchids.com.au/pages/your-care-guides** (short link `belgrv.au/care`).
Given an order number, it returns the care guides for the products in that order.

Hosted on **Railway** (project `accurate-adventure`, service `care-guides-proxy`). Pushing to `main` deploys automatically.

## Endpoints
| Endpoint | Returns |
|---|---|
| `GET /care-guides?order=2287` | `{ ok, guides: [url…], guideDetails: [{url,title,summary,image,imageAlt}], meta }` |
| `GET /health` | `{ ok: true, shopify: "connected" }` or 503 if the Shopify token/connection is broken |
| `GET /` | `ok` |

## How guides are chosen
1. Each product's `custom.care_guide` metafield (an Article reference).
2. If a product has none, the genus care guide from the `care-guides` blog, matched on product title/type (Dracula, Masdevallia, Sarcochilus, Cymbidium, Dockrillia, Dendrobium cuthbertsonii/monophyllum/speciosum/kingianum…).

## Safeguards
- Only digits are accepted as an order number (nothing else reaches Shopify search), and only an exact order-name match is used.
- CORS limited to belgraveorchids.com.au.
- 30 lookups per IP per minute; each order's result cached for an hour.
- Shopify errors are logged, never returned to the public.

## Environment variables (Railway → Variables)
| Name | Value |
|---|---|
| `SHOPIFY_SHOP_DOMAIN` | `7a6d38-5.myshopify.com` |
| `SHOPIFY_ADMIN_API_TOKEN` | Admin API access token (`shpat_…`). Only needs `read_orders`, `read_products`, `read_content` — ideally its own read-only Shopify app so other apps' changes can't break this page |
| `SHOPIFY_API_VERSION` | optional, default `2026-07` |
| `STOREFRONT_BASE` | optional, default `https://belgraveorchids.com.au` |
