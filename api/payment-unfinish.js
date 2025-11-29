// api/payment-unfinish.js
module.exports = (req, res) => {
  const orderId = req.query.order_id || "";
  const scheme = process.env.CUSTOM_FINISH_SCHEME || "myapp://payment";
  const redirect = `${scheme}/unfinish?order_id=${encodeURIComponent(orderId)}`;
  res.writeHead(302, { Location: redirect });
  res.end();
};
