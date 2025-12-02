// api/midtrans-webhook.js
const admin = require("firebase-admin");
const crypto = require("crypto");

// --- Firestore Admin Init ---
if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.error("❌ Missing FIREBASE_* ENV VARS!");
  } else {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
      console.log("🔥 Firebase Admin initialized");
    } catch (e) {
      console.error("❌ Failed init firebase-admin:", e);
    }
  }
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // Handle raw body (Vercel sometimes does not parse)
  let body = req.body;
  if (!body || Object.keys(body).length === 0) {
    body = await new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch (_) {
          resolve({});
        }
      });
    });
  }

  console.log("📥 MIDTRANS WEBHOOK:", body);

  const orderId = body.order_id;
  if (!orderId) return res.status(400).json({ error: "order_id missing" });

  // --- Signature validation ---
  const serverKey = process.env.MIDTRANS_SERVER_KEY || "";
  const signature = body.signature_key || "";

  if (serverKey) {
    const baseString = orderId + String(body.status_code || "") + String(body.gross_amount || "");

    const computed = crypto
      .createHash("sha512")
      .update(baseString + serverKey)
      .digest("hex");

    if (computed !== signature) {
      console.warn("❌ Invalid signature:", { computed, signature });
      return res.status(403).json({ error: "Invalid signature" });
    }
  } else {
    console.warn("⚠ MIDTRANS_SERVER_KEY missing → skipping signature check");
  }

  // --- Determine App Status ---
  const tx = (body.transaction_status || "").toLowerCase();
  const fraud = (body.fraud_status || "").toLowerCase();
  const type = (body.payment_type || "").toLowerCase();

  let appStatus = "waiting";

  if (tx === "settlement" || (tx === "capture" && fraud === "accept")) {
    appStatus = "payment_success";
  } else if (["cancel", "deny", "expire", "failure"].includes(tx)) {
    appStatus = "payment_failed";
  } else if (tx === "pending") {
    // QRIS auto success after settlement
    if (type === "qris") appStatus = "pending_qris";
  }

  const update = {
    status: appStatus,
    payment_status: tx,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    midtrans_raw: body,
  };

  try {
    const orderRef = db.collection("orders").doc(orderId);
    const historyRef = db.collection("order_history").doc(orderId);

    const existing = await orderRef.get();
    const prevStatus = existing.exists ? existing.data().status : null;

    // 🚫 Prevent infinite updates & duplicate notifications
    if (prevStatus === appStatus) {
      console.log("⏭ Skipping duplicate update for", orderId);
      return res.json({ success: true, skip: true });
    }

    await orderRef.set(update, { merge: true });
    await historyRef.set(update, { merge: true });

    console.log(`🔥 UPDATED ORDER ${orderId}: ${prevStatus} → ${appStatus}`);

    // Send notif only when transitioning into waiting state
    if (appStatus === "payment_success" && prevStatus !== "payment_success") {
      const drivers = await db.collection("users").where("role", "==", "driver").where("fcm_token", "!=", null).get();

      const tokens = drivers.docs.map((d) => d.data().fcm_token).filter(Boolean);

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

        console.log("📩 FCM sent to", tokens.length, "drivers");
      }
    }

    return res.json({ success: true });
  } catch (e) {
    console.error("❌ Webhook error:", e);
    return res.status(500).json({ error: "Webhook processing error" });
  }
};
