const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const repo = require('../repositories');
const config = require('../config/env');
const { badRequest, unauthorized } = require('../utils/httpError');

// POST /api/auth/login  { email, password }
async function login(req, res) {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw badRequest('Email dan password wajib diisi');
  }
  const user = await repo.findUserByEmail(email.trim());
  // Pesan sama untuk email salah dan password salah agar tidak membocorkan akun yang ada
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw unauthorized('Email atau password salah');
  }

  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
  await repo.addAuditLog({ user_id: user.id, action: 'login', resource: 'auth', resource_id: user.id });

  res.json({
    token,
    token_type: 'Bearer',
    expires_in: config.jwtExpiresIn,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
}

// GET /api/auth/me
function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { login, me };
