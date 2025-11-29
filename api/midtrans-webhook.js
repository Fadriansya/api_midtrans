const admin = require("firebase-admin");

// INIT FIREBASE
if (!admin.apps.length) {
  // Pastikan Environment Variables sudah terisi di Vercel Dashboard
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

  // Manual parse untuk kasus Vercel gagal parsing JSON otomatis (JANGAN DIHAPUS)
  if (!body || Object.keys(body).length === 0) {
    try {
      body = await new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => resolve(JSON.parse(raw || "{}")));
        req.on("error", reject);
      });
    } catch (e) {
      console.error("Error parsing raw body:", e);
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  console.log("MIDTRANS WEBHOOK:", body);

  const orderId = body.order_id;
  const transactionStatus = body.transaction_status;

  if (!orderId || !transactionStatus) {
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  // =========================
  // 1. MAP STATUS MIDTRANS KE APP
  // =========================
  let paymentStatus = "pending_payment";

  if (["settlement", "capture"].includes(transactionStatus)) {
    paymentStatus = "paid";
  } else if (["cancel", "deny", "expire"].includes(transactionStatus)) {
    paymentStatus = "payment_failed";
  }

  // =========================
  // 2. UPDATE STATUS PEMBAYARAN & STATUS PESANAN UTAMA
  // =========================
  const updateData = {
    payment_status: paymentStatus,
    midtrans_raw: body,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Tambahkan 'status: waiting' hanya jika pembayaran sukses
  if (paymentStatus === "paid") {
    // 🔥 PERBAIKAN SINKRONISASI KRITIS: Update status utama untuk Polling Flutter 🔥
    updateData.status = "waiting";
  }

  await db.collection("orders").doc(orderId).set(updateData, { merge: true });

  console.log(`PAYMENT STATUS UPDATED: ${orderId} → ${paymentStatus} (Order Status: ${updateData.status || "unchanged"})`);

  // =========================
  // 3. KIRIM NOTIF DRIVER (HANYA JIKA STATUS BARU 'paid')
  // =========================
  if (paymentStatus === "paid") {
    const orderDoc = await db.collection("orders").doc(orderId).get();

    // Cegah notifikasi berulang (hanya kirim jika driver_notified BUKAN true)
    if (orderDoc.exists && orderDoc.data().driver_notified === true) {
      console.log("Driver already notified → skip");
    } else {
      // Tandai supaya tidak notifikasi 2 kali
      await db.collection("orders").doc(orderId).set(
        {
          driver_notified: true,
        },
        { merge: true }
      );

      // Ambil token driver
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

        console.log(`Driver notified. Tokens sent: ${tokens.length}`);
      } else {
        console.log("No available drivers with FCM tokens found.");
      }
    }
  }

  return res.status(200).json({ success: true, message: "Webhook processed" });
};
