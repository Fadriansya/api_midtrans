// api/midtrans-webhook.js
const admin = require("firebase-admin");

// INIT FIREBASE
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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // PARSE JSON MANUAL
  let body = req.body;
  if (!body || Object.keys(body).length === 0) {
    body = await new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => resolve(JSON.parse(raw || "{}")));
      req.on("error", reject);
    });
  }

  console.log("Webhook payload:", JSON.stringify(body));

  const orderId = body.order_id;
  const status = body.transaction_status;

  if (!orderId) return res.status(400).json({ error: "Missing order_id" });

  let appStatus = "pending_payment";
  // settlement/capture => app ready for driver (set to waiting)
  if (transactionStatus === "settlement" || transactionStatus === "capture") {
    appStatus = "waiting"; // supaya driver menerima (listener mencari 'waiting')
  } else if (transactionStatus === "cancel" || transactionStatus === "deny" || transactionStatus === "expire") {
    appStatus = "payment_failed";
  } else if (transactionStatus === "pending") {
    appStatus = "pending_payment";
  }

  if (status === "settlement" || status === "capture") appStatus = "paid";
  else if (["cancel", "deny", "expire"].includes(status)) appStatus = "payment_failed";

  // Update order
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

  // ==== NOTIFY DRIVERS ====
  if (appStatus === "paid") {
    await db.collection("orders").doc(orderId).set(
      {
        status: "waiting",
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    const drivers = await db.collection("users").where("role", "==", "driver").where("fcm_token", "!=", null).get();

    const tokens = drivers.docs.map((d) => d.data().fcm_token);

    if (tokens.length > 0) {
      await admin.messaging().sendMulticast({
        notification: {
          title: "Order Baru Tersedia",
          body: `Order ${orderId} telah dibayar dan siap diambil.`,
        },
        data: {
          type: "new_order",
          order_id: orderId,
        },
        tokens,
      });
    }
  }

  return res.status(200).json({ message: "Webhook received" });
};
