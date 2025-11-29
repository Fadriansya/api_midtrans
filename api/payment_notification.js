// api/payment_notification.js
const admin = require("firebase-admin");
if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (e) {
    console.error(e);
  }
}

module.exports = async (req, res) => {
  try {
    const body = req.body || {};
    console.log("📌 NOTIFICATION RECEIVED:", body);

    const orderId = body.order_id;
    const status = (body.transaction_status || "").toLowerCase();
    if (!orderId || !status) return res.status(400).json({ error: "Invalid callback" });

    const db = admin.firestore();
    const orderRef = db.collection("orders").doc(orderId);
    const historyRef = db.collection("order_history").doc(orderId);

    let newStatus = "pending_payment";
    if (status === "settlement" || status === "capture" || status === "success") newStatus = "waiting";
    if (["deny", "cancel", "expire", "failure"].includes(status)) newStatus = "payment_failed";

    await orderRef.set({ status: newStatus, payment_status: status, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await historyRef.set({ status: newStatus, payment_status: status, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    // optionally notify drivers here, or rely on midtrans-webhook which already does
    return res.status(200).json({ message: "OK" });
  } catch (e) {
    console.error("NOTIF ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
};
