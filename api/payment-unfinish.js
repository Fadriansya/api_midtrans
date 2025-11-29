// api/payment_unfinish.js
module.exports = async (req, res) => {
  const orderId = req.query.order_id || "";
  const redirectUrl = `myapp://payment/unfinish?order_id=${orderId}`;

  res.writeHead(302, { Location: redirectUrl });
  res.end();
};
