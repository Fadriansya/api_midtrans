// api/payment_error.js
module.exports = async (req, res) => {
  return res.status(200).send("Terjadi error pada pembayaran.");
};
