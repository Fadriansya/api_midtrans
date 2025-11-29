// api/index.js
const axios = require("axios");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { order_id, gross_amount, name, email } = req.body;
  const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
  const MIDTRANS_API_URL = "https://app.sandbox.midtrans.com/snap/v1/transactions";
  const BASE_URL = process.env.BASE_URL || "https://api-midtrans-teal.vercel.app";

  try {
    const response = await axios.post(
      MIDTRANS_API_URL,
      {
        transaction_details: { order_id, gross_amount },
        customer_details: { first_name: name, email },
        callbacks: {
          finish: `https://api-midtrans-teal.vercel.app/api/payment_finish`,
          notification: `https://api-midtrans-teal.vercel.app/api/midtrans-webhook`,
          unfinish: `https://api-midtrans-teal.vercel.app/api/payment_unfinish`,
          error: `https://api-midtrans-teal.vercel.app/api/payment_error`,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Basic " + Buffer.from(MIDTRANS_SERVER_KEY + ":").toString("base64"),
        },
      }
    );

    return res.status(200).json(response.data);
  } catch (error) {
    console.error("Midtrans API Error:", error.response?.data || error.message || error);
    return res.status(500).json({ error: "Midtrans error" });
  }
};
