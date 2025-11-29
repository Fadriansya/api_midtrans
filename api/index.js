const admin = require("firebase-admin");
const midtransClient = require("midtrans-client");

// ===================================
// INIT FIREBASE ADMIN
// ===================================
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

// ===================================
// INIT MIDTRANS CLIENT
// ===================================
const snap = new midtransClient.Snap({
  isProduction: false, // Ganti ke true jika sudah production
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY, // Hanya dibutuhkan jika menggunakan Snap.js di Frontend
});

// ===================================
// HANDLER UTAMA
// ===================================
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    // Hanya izinkan POST untuk kedua fungsi (Snap & Webhook)
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body; // Manual parse jika body kosong (penting untuk Webhook)

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

  console.log("INCOMING REQUEST BODY:", body); // ========================================================== // 1. DETEKSI: APAKAH INI WEBHOOK DARI MIDTRANS? //    (Webhooks memiliki 'transaction_status' dan 'order_id') // ==========================================================

  if (body.transaction_status && body.order_id) {
    return await handleWebhook(body, res);
  } // ========================================================== // 2. DETEKSI: APAKAH INI PERMINTAAN SNAP DARI FLUTTER? //    (Memiliki 'order_id', 'total_amount', 'customer_details') // ==========================================================

  if (body.order_id && body.total_amount && body.customer_details) {
    return await handleSnapRequest(body, res);
  } // Jika tidak dikenali

  return res.status(400).json({ error: "Request type not recognized" });
};

// ===================================
// FUNGSI 1: WEBHOOK HANDLER
// ===================================
async function handleWebhook(body, res) {
  const orderId = body.order_id;
  const transactionStatus = body.transaction_status;

  console.log(`WEBHOOK: Order ${orderId} status: ${transactionStatus}`); // MAP STATUS MIDTRANS KE APP

  let paymentStatus = "pending_payment";
  if (["settlement", "capture"].includes(transactionStatus)) {
    paymentStatus = "paid";
  } else if (["cancel", "deny", "expire"].includes(transactionStatus)) {
    paymentStatus = "payment_failed";
  } // Buat objek update dasar

  const updateData = {
    payment_status: paymentStatus,
    midtrans_raw: body,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }; // Tambahkan 'status: waiting' hanya jika pembayaran sukses

  if (paymentStatus === "paid") {
    // 🔥 KRITIS: Update status utama untuk Polling Flutter
    updateData.status = "waiting";
  }
  await db.collection("orders").doc(orderId).set(updateData, { merge: true });

  console.log(`STATUS UPDATED: Order ${orderId} → ${paymentStatus} (Order Status: ${updateData.status || "unchanged"})`); // ========================= // KIRIM NOTIF DRIVER (HANYA JIKA STATUS BARU 'paid') // =========================

  if (paymentStatus === "paid") {
    const orderDoc = await db.collection("orders").doc(orderId).get();

    if (orderDoc.exists && orderDoc.data().driver_notified === true) {
      console.log("Driver already notified → skip");
    } else {
      await db.collection("orders").doc(orderId).set({ driver_notified: true }, { merge: true });

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
      }
    }
  }

  return res.status(200).json({ success: true, message: "Webhook processed" });
}

// ===================================
// FUNGSI 2: SNAP REQUEST HANDLER
// ===================================
async function handleSnapRequest(body, res) {
  const { order_id, total_amount, item_details, customer_details, finish_url } = body;

  const transactionDetails = {
    order_id: order_id,
    gross_amount: total_amount,
  };

  const parameter = {
    transaction_details: transactionDetails,
    item_details: item_details,
    customer_details: customer_details,
    callbacks: {
      finish: finish_url || "https://api-midtrans-teal.vercel.app/api/payment-finish",
      error: "https://api-midtrans-teal.vercel.app/api/payment-error",
      unfinish: "https://api-midtrans-teal.vercel.app/api/payment-unfinish",
    },
  };

  try {
    // Dapatkan URL Snap Token dari Midtrans
    const transaction = await snap.createTransaction(parameter);
    const snapToken = transaction.token;
    const redirectUrl = transaction.redirect_url;

    console.log(`SNAP GENERATED: Order ${order_id}, Token: ${snapToken}`);

    return res.status(200).json({
      snap_token: snapToken,
      redirect_url: redirectUrl,
    });
  } catch (error) {
    console.error("Error creating Midtrans transaction:", error);
    return res.status(500).json({ error: "Failed to create Midtrans transaction" });
  }
}
