// api/payment_notification.js
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();

module.exports = async (req, res) => {
  try {
    const body = req.body;

    console.log("📌 NOTIFICATION RECEIVED:", body);

    const orderId = body.order_id;
    const status = body.transaction_status;

    if (!orderId || !status) {
      return res.status(400).json({ error: "Invalid callback" });
    }

    // referensi Firestore
    const db = admin.firestore();
    const orderRef = db.collection("order_history").doc(orderId);

    if (status === "settlement" || status === "capture") {
      await orderRef.update({
        status: "waiting_driver",
        payment_status: "paid",
        updated_at: new Date(),
      });

      // Kirim notifikasi ke driver
      // (implement push notif atau firestore trigger)
    }

    return res.status(200).json({ message: "OK" });
  } catch (e) {
    console.error("❌ NOTIF ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
};
