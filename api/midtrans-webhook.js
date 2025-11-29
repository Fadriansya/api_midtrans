// api/midtrans-webhook.js (KODE DEBUGGING SEMENTARA)

module.exports = async (req, res) => {
  console.log("🔥 WEBHOOK FIRE IN VERCEL 🔥");

  // Mengatasi masalah body parsing Vercel
  const body =
    req.body ||
    (await new Promise((resolve) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(raw || "{}"));
        } catch (e) {
          resolve({});
        }
      });
    }));

  console.log("WEBHOOK PAYLOAD RECEIVED:", body);

  // Hanya kirim 200 agar Midtrans tahu request diterima
  return res.status(200).json({ status: "received" });
};
