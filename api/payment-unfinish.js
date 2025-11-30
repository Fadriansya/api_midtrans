// api/payment-unfinish.js
module.exports = (req, res) => {
  const orderId = req.query.order_id || "";
  const scheme = "http://api-midtrans-teal.vercel.app/api/payment-unfinish";
  const redirect = `${scheme}/unfinish?order_id=${encodeURIComponent(orderId)}`;
  res.writeHead(302, { Location: redirect });
  res.end();
};
