const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const protect = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const { rows } = await pool.query(
      `SELECT id, nickname, role, is_active FROM users WHERE id = $1`,
      [decoded.id]
    );
    if (!rows[0] || !rows[0].is_active) {
      return res.status(401).json({ message: 'Account not found or disabled' });
    }
    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied' });
  }
  next();
};

module.exports = { protect, restrictTo };
