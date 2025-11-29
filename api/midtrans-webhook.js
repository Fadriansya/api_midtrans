// api/midtrans-webhook.js
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;

  // Fallback jika req.body kosong
  if (!body || Object.keys(body).length === 0) {
    body = await new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => resolve(JSON.parse(raw || "{}")));
    });
  }

  console.log("🔥 MIDTRANS WEBHOOK:", body);

  const orderId = body.order_id;
  const status = body.transaction_status;

  if (!orderId) return res.status(400).json({ error: "No order_id found" });

  // Pastikan order exists
  const orderRef = db.collection("orders").doc(orderId);
  const historyRef = db.collection("order_history").doc(orderId);

  // Mapping status Midtrans -> aplikasi
  let appStatus = "pending_payment";

  if (status === "capture" || status === "settlement") {
    appStatus = "waiting";
  } else if (["deny", "cancel", "expire"].includes(status)) {
    appStatus = "payment_failed";
  } else if (status === "pending") {
    appStatus = "pending_payment";
  }

  const update = {
    status: appStatus,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    midtrans_raw: body,
  };

  // Write to both main orders & history
  await orderRef.set(update, { merge: true });
  await historyRef.set(update, { merge: true });

  console.log(`🔥 UPDATED ORDER ${orderId} => ${appStatus}`);

  // Only send notification when order masuk ke status "waiting"
  if (appStatus === "waiting") {
    const drivers = await db.collection("users").where("role", "==", "driver").where("fcm_token", "!=", null).get();

    const tokens = drivers.docs.map((d) => d.data().fcm_token);

    if (tokens.length > 0) {
      await admin.messaging().sendMulticast({
        notification: {
          title: "Order Baru Masuk",
          body: `Order ${orderId} sudah dibayar dan siap diambil.`,
        },
        data: {
          type: "new_order",
          order_id: orderId,
        },
        tokens,
      });

      console.log("📩 FCM dikirim ke driver:", tokens.length, "device");
    }
  }

  return res.json({ success: true });
};
