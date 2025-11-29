// api/payment_error.js
module.exports = async (req, res) => {
  const orderId = req.query.order_id || "";
  const redirectUrl = `myapp://payment/error?order_id=${orderId}`;

  res.writeHead(302, { Location: redirectUrl });
  res.end();
};
