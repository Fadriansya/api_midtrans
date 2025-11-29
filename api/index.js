// api/index.js
const axios = require("axios");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { order_id, total_amount, customer_details, item_details } = req.body;

    if (!order_id || !total_amount) {
      return res.status(400).json({
        error: "order_id and total_amount are required",
      });
    }

    const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;

    // Payload ke Midtrans
    const payload = {
      transaction_details: {
        order_id,
        gross_amount: Number(total_amount),
      },
      customer_details: customer_details,
      item_details: item_details,
      callbacks: {
        finish: "https://api-midtrans-teal.vercel.app/api/payment-finish",
        error: "https://api-midtrans-teal.vercel.app/api/payment-error",
        unfinish: "https://api-midtrans-teal.vercel.app/api/payment-unfinish",
        notification: "https://api-midtrans-teal.vercel.app/api/midtrans-webhook",
      },
    };

    const midtrans = await axios.post("https://app.sandbox.midtrans.com/snap/v1/transactions", payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(MIDTRANS_SERVER_KEY + ":").toString("base64"),
      },
    });

    // Midtrans Response
    const { token, redirect_url } = midtrans.data;

    // REFORMAT agar cocok dengan Flutter
    return res.status(200).json({
      snap_token: token,
      redirect_url: redirect_url,
    });
  } catch (error) {
    console.error("MIDTRANS ERROR:", error.response?.data || error.message);

    return res.status(500).json({
      error: "Midtrans error",
      detail: error.response?.data || null,
    });
  }
};
