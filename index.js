import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const SHOP = process.env.SHOPIFY_SHOP_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

if (!SHOP || !TOKEN) {
  console.error("Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_API_TOKEN");
  process.exit(1);
}

async function shopifyGraphQL(query, variables = {}) {
  const res = await fetch(
    `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  const json = await res.json();

  if (json.errors) {
    console.error(JSON.stringify(json.errors, null, 2));
    throw new Error("Shopify GraphQL error");
  }

  return json.data;
}

/* -------------------------
   GraphQL queries
-------------------------- */

const FIND_ORDER_QUERY = `
  query FindOrder($q: String!) {
    orders(first: 1, query: $q, sortKey: PROCESSED_AT, reverse: true) {
      edges {
        node {
          name
          lineItems(first: 50) {
            edges {
              node {
                product { id }
              }
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_METAFIELDS_QUERY = `
  query ProductMetafields($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        metafield(namespace: "custom", key: "care_guide") {
          reference {
            ... on Article {
              onlineStoreUrl
              title
            }
          }
        }
      }
    }
  }
`;

/* -------------------------
   /care-guides endpoint
-------------------------- */

app.get("/care-guides", async (req, res) => {
  try {
    const orderNumber = req.query.order;
    if (!orderNumber) {
      return res.status(400).json({ ok: false, error: "Missing order number" });
    }

    const orderQuery = `name:#${orderNumber}`;

    // 1) Find order
    const orderData = await shopifyGraphQL(FIND_ORDER_QUERY, {
      q: orderQuery,
    });

    const orderEdge = orderData.orders.edges[0];
    if (!orderEdge) {
      return res.json({
        ok: true,
        guides: [],
        meta: {
          mode: "order",
          order: orderNumber,
          shopify_order: `#${orderNumber}`,
          count: 0,
          phase: 2,
        },
      });
    }

    // 2) Extract product IDs
    const productIds = orderEdge.node.lineItems.edges
      .map((e) => e.node.product?.id)
      .filter(Boolean);

    if (!productIds.length) {
      return res.json({
        ok: true,
        guides: [],
        meta: {
          mode: "order",
          order: orderNumber,
          shopify_order: `#${orderNumber}`,
          count: 0,
          phase: 2,
        },
      });
    }

    // 3) Fetch care guide metafields
    const productData = await shopifyGraphQL(PRODUCT_METAFIELDS_QUERY, {
      ids: productIds,
    });

    // 4) Extract URLs (Blog post reference)
    const guides = [
      ...new Set(
        productData.nodes
          .map(
            (n) => n?.metafield?.reference?.onlineStoreUrl
          )
          .filter(Boolean)
      ),
    ];

    res.json({
      ok: true,
      guides,
      meta: {
        mode: "order",
        order: orderNumber,
        shopify_order: `#${orderNumber}`,
        count: guides.length,
        phase: 2,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* -------------------------
   Start server
-------------------------- */

app.listen(PORT, () => {
  console.log(`Care Guides Proxy listening on port ${PORT}`);
});
