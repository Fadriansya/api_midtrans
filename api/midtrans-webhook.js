// api/midtrans-webhook.js
const admin = require("firebase-admin");
const crypto = require("crypto");

// Initialize admin if not already
if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY || "";

  if (!projectId || !clientEmail || !privateKeyRaw) {
    console.error("Missing FIREBASE_* env vars for admin init");
  } else {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
        }),
      });
    } catch (e) {
      console.error("Failed to initialize firebase-admin:", e);
    }
  }
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (!body || Object.keys(body).length === 0) {
    // parse raw body if needed
    body = await new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          resolve(JSON.parse(raw || "{}"));
        } catch (e) {
          resolve({});
        }
      });
    });
  }

  console.log("🔥 MIDTRANS WEBHOOK body:", body);

  const orderId = body.order_id || body.orderId || body.order_id;
  if (!orderId) return res.status(400).json({ error: "No order_id found" });

  // signature validation
  const serverKey = process.env.MIDTRANS_SERVER_KEY || "";
  const status_code = String(body.status_code || "");
  const gross_amount = String(body.gross_amount || body.grossAmount || "");
  const signature_key = String(body.signature_key || body.sign_key || "");

  try {
    if (!serverKey) {
      console.warn("MIDTRANS_SERVER_KEY not set — skipping signature validation");
    } else {
      const computed = crypto
        .createHash("sha512")
        .update(String(orderId) + status_code + gross_amount + serverKey)
        .digest("hex");
      if (!signature_key || computed !== signature_key) {
        console.warn("Invalid signature_key:", { computed, signature_key });
        return res.status(403).json({ error: "Invalid signature" });
      }
    }
  } catch (e) {
    console.error("Signature validation error:", e);
    return res.status(500).json({ error: "Signature validation failed" });
  }

  const txStatus = String((body.transaction_status || "").toLowerCase());
  const fraudStatus = String((body.fraud_status || "").toLowerCase());
  const paymentType = String((body.payment_type || "").toLowerCase());

  // Map to app status
  let appStatus = "pending_payment";
  if ((txStatus === "capture" && fraudStatus === "accept") || txStatus === "settlement" || txStatus === "success") {
    appStatus = "waiting";
  } else if (["deny", "cancel", "expire", "failure"].includes(txStatus)) {
    appStatus = "payment_failed";
  } else if (txStatus === "pending") {
    // special-case: some e-wallet/qr may be considered waiting by your logic
    if (paymentType === "qris") appStatus = "waiting";
    else appStatus = "pending_payment";
  }

  const update = {
    status: appStatus,
    payment_status: txStatus,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    midtrans_raw: body,
  };

  try {
    const orderRef = db.collection("orders").doc(orderId);
    const historyRef = db.collection("order_history").doc(orderId);

    await orderRef.set(update, { merge: true });
    await historyRef.set(update, { merge: true });

    console.log(`🔥 UPDATED ORDER ${orderId} => ${appStatus}`);

    if (appStatus === "waiting") {
      const driversSnap = await db.collection("users").where("role", "==", "driver").where("fcm_token", "!=", null).get();

      const tokens = driversSnap.docs.map((d) => d.data().fcm_token).filter(Boolean);
      if (tokens.length) {
        await admin.messaging().sendMulticast({
          notification: { title: "Order Baru Masuk", body: `Order ${orderId} sudah dibayar dan siap diambil.` },
          data: { type: "new_order", order_id: orderId },
          tokens,
        });
        console.log("📩 FCM sent to drivers:", tokens.length);
      }
    }

    return res.json({ success: true });
  } catch (e) {
    console.error("Webhook handling error:", e);
    return res.status(500).json({ error: "Webhook handling error", detail: String(e) });
  }
};
