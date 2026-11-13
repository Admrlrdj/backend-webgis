const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const repo = require('../repositories');
const config = require('../config/env');
const { badRequest, unauthorized, forbidden } = require('../utils/httpError');

function serializeUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    agency: u.agency || 'Pemerintah Kota Bogor',
    is_active: u.is_active !== false,
    last_login_at: u.last_login_at || null,
    created_at: u.created_at || null,
  };
}

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
  if (user.is_active === false) {
    throw forbidden('Akun Anda dinonaktifkan. Hubungi Super Admin.');
  }

  const touched = await repo.updateUser(user.id, { last_login_at: new Date().toISOString() });
  const activeUser = touched || user;

  const token = jwt.sign(
    { sub: activeUser.id, email: activeUser.email, role: activeUser.role, name: activeUser.name },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
  await repo.addAuditLog({ user_id: activeUser.id, action: 'login', resource: 'auth', resource_id: activeUser.id });

  res.json({
    token,
    token_type: 'Bearer',
    expires_in: config.jwtExpiresIn,
    user: serializeUser(activeUser),
  });
}

// GET /api/auth/me
async function me(req, res) {
  const user = await repo.findUserById(req.user.id);
  if (!user || user.is_active === false) {
    throw unauthorized('Sesi tidak berlaku atau akun telah dinonaktifkan');
  }
  res.json({ user: serializeUser(user) });
}

// POST /api/auth/change-password  { current_password, new_password }
async function changePassword(req, res) {
  const { current_password: currentPassword, new_password: newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    throw badRequest('Kata sandi lama dan kata sandi baru wajib diisi');
  }
  if (newPassword.length < 6) {
    throw badRequest('Kata sandi baru minimal 6 karakter');
  }

  const user = await repo.findUserAuthById(req.user.id);
  if (!user || user.is_active === false) {
    throw unauthorized('Akun tidak ditemukan atau tidak aktif');
  }
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw unauthorized('Kata sandi saat ini tidak sesuai');
  }

  const password_hash = await bcrypt.hash(newPassword, 10);
  await repo.updateUser(user.id, { password_hash });
  await repo.addAuditLog({ user_id: user.id, action: 'password.change', resource: 'auth', resource_id: user.id });

  res.json({ ok: true, message: 'Kata sandi akun berhasil diperbarui di database' });
}

module.exports = { login, me, changePassword };
