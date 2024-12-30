module.exports = (req, res, next) => {
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (req.headers.authorization === `Bearer ${adminPassword}`) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized access' });
  }
};
