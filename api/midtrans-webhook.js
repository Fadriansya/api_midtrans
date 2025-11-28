const crypto = require("crypto");
const admin = require("firebase-admin");

// Inisialisasi Firestore hanya sekali
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body;

  try {
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const expectedSignature = crypto
      .createHash("sha512")
      .update(body.order_id + body.status_code + body.gross_amount + serverKey)
      .digest("hex");

    // Validate signature
    if (expectedSignature !== body.signature_key) {
      console.log("❌ Invalid signature key");
      return res.status(403).json({ message: "Invalid signature" });
    }

    // Get transaction status
    const status = body.transaction_status;
    const orderId = body.order_id;

    console.log("Webhook received:", status, "for order", orderId);

    // Update Firestore order collection
    if (status === "settlement") {
      await db.collection("orders").doc(orderId).update({
        payment_status: "paid",
        status: "waiting_driver", // driver menerima order baru
        updated_at: new Date(),
      });

      console.log("✔ Firestore updated for order", orderId);
    }

    return res.status(200).json({ message: "OK" });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
};
