// api/payment-finish.js
module.exports = (req, res) => {
  const orderId = req.query.order_id || "";
  const scheme = "http://api-midtrans-teal.vercel.app/api/payment-finish";
  const redirect = `${scheme}/success?order_id=${encodeURIComponent(orderId)}`;
  res.writeHead(302, { Location: redirect });
  res.end();
};
