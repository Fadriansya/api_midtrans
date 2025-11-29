// api/payment_finish.js
module.exports = (req, res) => {
  const orderId = req.query.order_id || "";
  const redirectUrl = `myapp://payment/success?order_id=${orderId}`;

  // Redirect ke custom scheme agar WebView Flutter bisa menangkap dan menutup.
  res.writeHead(302, { Location: redirectUrl });
  res.end();
};
