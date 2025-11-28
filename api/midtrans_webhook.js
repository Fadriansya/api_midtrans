const admin = require("firebase-admin");

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

  try {
    console.log("Webhook data:", req.body);

    const { order_id, transaction_status } = req.body;

    if (!order_id) {
      return res.status(400).json({ error: "Missing order_id" });
    }

    // Update ke Firestore
    await db
      .collection("orders")
      .doc(order_id)
      .set(
        {
          status: transaction_status,
          paid: transaction_status === "settlement",
          updatedAt: Date.now(),
        },
        { merge: true }
      );

    console.log("✔ Firestore updated successfully!");

    return res.status(200).json({ message: "Webhook received" });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    return res.status(500).json({ error: error.toString() });
  }
};
