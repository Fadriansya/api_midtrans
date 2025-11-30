// api/payment-error.js
module.exports = (req, res) => {
  const orderId = req.query.order_id || "";
  const scheme = "http://api-midtrans-teal.vercel.app/api/payment-error";
  const redirect = `${scheme}/error?order_id=${encodeURIComponent(orderId)}`;
  res.writeHead(302, { Location: redirect });
  res.end();
};
