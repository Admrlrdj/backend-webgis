const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { unauthorized, forbidden } = require('../utils/httpError');

function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, email: payload.email, role: payload.role, name: payload.name };
    return next();
  } catch {
    return next(unauthorized('Token tidak valid atau kedaluwarsa'));
  }
}

// superadmin selalu lolos pemeriksaan role admin
const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.role === 'superadmin' || roles.includes(req.user.role)) return next();
  return next(forbidden());
};

module.exports = { requireAuth, requireRole };
