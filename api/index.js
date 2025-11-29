const admin = require("firebase-admin");
const midtransClient = require("midtrans-client");

// ===================================
// INIT FIREBASE ADMIN
// ===================================
if (!admin.apps.length) {
  // Pastikan Environment Variables sudah terisi
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
  isProduction: process.env.NODE_ENV === "production", // Gunakan Environment Variable
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// Ekspor instance yang sudah terinisialisasi
module.exports = { admin, db, snap };
