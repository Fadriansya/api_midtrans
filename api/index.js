// api/index.js
const axios = require("axios");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { order_id, gross_amount, name, email } = req.body;

  if (!order_id || !gross_amount) {
    return res.status(400).json({
      error: "order_id and gross_amount are required",
    });
  }

  const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;

  try {
    const response = await axios.post(
      "https://app.sandbox.midtrans.com/snap/v1/transactions",
      {
        transaction_details: {
          order_id,
          gross_amount: Number(gross_amount), // FIX: harus number
        },
        customer_details: {
          first_name: name,
          email,
        },
        callbacks: {
          finish: "https://api-midtrans-teal.vercel.app/api/payment-finish",
          error: "https://api-midtrans-teal.vercel.app/api/payment-error",
          unfinish: "https://api-midtrans-teal.vercel.app/api/payment-unfinish",
          notification: "https://api-midtrans-teal.vercel.app/api/midtrans-webhook",
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + Buffer.from(MIDTRANS_SERVER_KEY + ":").toString("base64"),
        },
      }
    );

    return res.status(200).json(response.data);
  } catch (error) {
    console.log("MIDTRANS ERROR:", error.response?.data || error.message);
    return res.status(500).json({
      error: "Midtrans error",
      detail: error.response?.data || null,
    });
  }
};
