// api/index.js
const axios = require("axios");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
  if (!MIDTRANS_SERVER_KEY) {
    console.error("MIDTRANS_SERVER_KEY not set");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const { order_id, gross_amount, name, email, item_details } = req.body || {};

  if (!order_id || gross_amount === undefined || gross_amount === null) {
    return res.status(400).json({ error: "order_id and gross_amount are required" });
  }

  const grossNum = Number(gross_amount);
  if (Number.isNaN(grossNum) || grossNum <= 0) {
    return res.status(400).json({ error: "gross_amount must be a positive number" });
  }

  // Build item_details: if provided, validate sum; otherwise create a single item.
  let items = [];
  if (Array.isArray(item_details) && item_details.length) {
    // normalize and compute sum
    try {
      items = item_details.map((it) => ({
        id: it.id?.toString() || `ITEM-${order_id}`,
        price: Number(it.price || it.price_amount || it.amount || 0),
        quantity: Number(it.quantity || 1),
        name: it.name || "Item",
      }));
      const sum = items.reduce((s, it) => s + it.price * (it.quantity || 1), 0);
      if (sum !== grossNum) {
        console.warn(`Item sum ${sum} != gross_amount ${grossNum} — overriding with single item`);
        items = [{ id: order_id, price: grossNum, quantity: 1, name: "Pembayaran Order" }];
      }
    } catch (e) {
      items = [{ id: order_id, price: grossNum, quantity: 1, name: "Pembayaran Order" }];
    }
  } else {
    items = [{ id: order_id, price: grossNum, quantity: 1, name: "Pembayaran Order" }];
  }

  // Build callbacks using Vercel environment or request host
  const baseHost = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `https://${req.headers.host}`;
  const callbacks = {
    finish: `${baseHost}/api/payment-finish`,
    error: `${baseHost}/api/payment-error`,
    unfinish: `${baseHost}/api/payment-unfinish`,
    notification: `${baseHost}/api/midtrans-webhook`,
  };

  const payload = {
    transaction_details: { order_id, gross_amount: grossNum },
    customer_details: { first_name: name || "User", email: email || "noemail@example.com" },
    item_details: items,
    callbacks,
  };

  try {
    const resp = await axios.post("https://app.sandbox.midtrans.com/snap/v1/transactions", payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(MIDTRANS_SERVER_KEY + ":").toString("base64"),
      },
      timeout: 15000,
    });

    // normalize response: midtrans snapshot contains token & redirect_url
    return res.status(200).json({
      snap_token: resp.data.token || resp.data.transaction_token || resp.data.token_id || null,
      redirect_url: resp.data.redirect_url || null,
      raw: resp.data,
    });
  } catch (err) {
    console.error("MIDTRANS ERROR:", err.response?.data || err.message || err);
    return res.status(500).json({
      error: "Midtrans error",
      detail: err.response?.data || err.message,
    });
  }
};
