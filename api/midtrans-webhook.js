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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;

  // Manual parse jika body kosong
  if (!body || Object.keys(body).length === 0) {
    body = await new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => resolve(JSON.parse(raw || "{}")));
      req.on("error", reject);
    });
  }

  console.log("MIDTRANS WEBHOOK:", body);

  const orderId = body.order_id;
  const transactionStatus = body.transaction_status;

  if (!orderId || !transactionStatus) {
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  // =========================
  // MAP STATUS MIDTRANS KE APP
  // =========================
  let paymentStatus = "pending_payment";

  if (["settlement", "capture"].includes(transactionStatus)) {
    paymentStatus = "paid";
  } else if (["cancel", "deny", "expire"].includes(transactionStatus)) {
    paymentStatus = "payment_failed";
  }

  // =========================
  // UPDATE PAYMENT STATUS SAJA
  // =========================
  await db.collection("orders").doc(orderId).set(
    {
      payment_status: paymentStatus,
      midtrans_raw: body,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`PAYMENT STATUS UPDATED: ${orderId} → ${paymentStatus}`);

  // =========================
  // KIRIM NOTIF DRIVER (HANYA SEKALI)
  // =========================
  if (paymentStatus === "paid") {
    await db.collection("orders").doc(orderId).set(
      {
        status: "waiting",
      },
      { merge: true }
    );
    const orderDoc = await db.collection("orders").doc(orderId).get();

    // Cegah notifikasi berulang
    if (orderDoc.data().driver_notified === true) {
      console.log("Driver already notified → skip");
    } else {
      // tandai supaya tidak notifikasi 2 kali
      await db.collection("orders").doc(orderId).set(
        {
          driver_notified: true,
        },
        { merge: true }
      );

      const drivers = await db.collection("users").where("role", "==", "driver").where("fcm_token", "!=", null).get();

      const tokens = drivers.docs.map((d) => d.data().fcm_token);

      if (tokens.length > 0) {
        await admin.messaging().sendMulticast({
          notification: {
            title: "Order Baru",
            body: `Order ${orderId} sudah dibayar dan siap diambil.`,
          },
          data: {
            type: "new_order",
            order_id: orderId,
          },
          tokens,
        });

        console.log("Driver notified.");
      }
    }
  }

  return res.status(200).json({ success: true });
};
