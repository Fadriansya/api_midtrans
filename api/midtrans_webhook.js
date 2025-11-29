// api/midtrans-webhook.js
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // private key in env should keep \n as two characters; convert to real newlines:
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body;
    console.log("Webhook payload:", JSON.stringify(body));

    // Midtrans payload may contain order_id in different fields depending on event
    const orderId = body.order_id || (body.transaction_details && body.transaction_details.order_id);
    const transactionStatus = body.transaction_status || body.status_code || body.transaction_status;

    if (!orderId) return res.status(400).json({ error: "Missing order_id" });

    // Map midtrans status ke app status:
    let appStatus = "pending_payment";
    // settlement/capture => paid
    if (transactionStatus === "settlement" || transactionStatus === "capture") {
      appStatus = "paid";
    } else if (transactionStatus === "cancel" || transactionStatus === "deny" || transactionStatus === "expire") {
      appStatus = "payment_failed";
    } else if (transactionStatus === "pending") {
      appStatus = "pending_payment";
    }

    // Update order doc
    await db
      .collection("orders")
      .doc(orderId)
      .set(
        {
          status: appStatus,
          paid: appStatus === "paid",
          midtrans_raw: body,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    console.log(`Order ${orderId} updated to ${appStatus}`);

    // Jika pembayaran berhasil -> notify drivers (simple multicast)
    if (appStatus === "paid") {
      // Ambil detail order untuk informasi notifikasi
      const orderSnap = await db.collection("orders").doc(orderId).get();
      const orderData = orderSnap.exists ? orderSnap.data() : null;

      // Kumpulkan token driver (example: users collection with role: 'driver' and fcm_token)
      const drivers = await db.collection("users").where("role", "==", "driver").where("fcm_token", "!=", null).get();

      const tokens = [];
      drivers.forEach((doc) => {
        const t = doc.data()?.fcm_token;
        if (t) tokens.push(t);
      });

      if (tokens.length > 0) {
        // chunk tokens in 500s if needed
        const chunkSize = 450;
        for (let i = 0; i < tokens.length; i += chunkSize) {
          const chunk = tokens.slice(i, i + chunkSize);
          const message = {
            notification: {
              title: "Order Baru Tersedia",
              body: `Order ${orderId} telah dibayar dan siap diambil.`,
            },
            data: {
              order_id: orderId,
              type: "new_order",
            },
            tokens: chunk,
          };

          const response = await admin.messaging().sendMulticast(message);
          console.log("FCM result:", response.successCount, "success, failures:", response.failureCount);
        }
      }
    }

    return res.status(200).json({ message: "Webhook received" });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ error: error.toString() });
  }
};
