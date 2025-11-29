// api/payment_finish.js
module.exports = (req, res) => {
  res.status(200).json({ message: "Finish callback received", data: req.query });
};
