import express from 'express';
import { z } from 'zod';
import { db, logAudit, nowIso, getSettingBool } from '../db.js';
import { config } from '../config.js';
import { authLimiter } from '../middleware/security.js';
import { requireCsrf } from '../middleware/csrf.js';
import { clearAuthCookie, hashPassword, isSuperAdmin, redirectIfAuthenticated, setAuthCookie, verifyPassword } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { asyncHandler } from '../lib/async-handler.js';
import { verifyTotp } from '../lib/totp.js';
import { randomToken } from '../lib/helpers.js';

export const authRouter = express.Router();

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(80),
  email: z.string().trim().email('Valid email is required').max(160).transform((v) => v.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const loginSchema = z.object({
  email: z.string().trim().email('Valid email is required').max(160).transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Password is required').max(128),
  next: z.string().optional(),
});

function safeNext(next) {
  if (typeof next !== 'string') return '/dashboard';
  if (!next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  return next;
}

authRouter.get('/register', redirectIfAuthenticated, (req, res) => {
  if (!getSettingBool('registration_enabled', true)) {
    return res.status(403).render('error', { title: 'Registration disabled', message: 'Registration is disabled. Ask the owner to create your account.' });
  }
  return res.render('auth/register', { title: 'Create account', values: {}, errors: {} });
});

authRouter.post('/register', redirectIfAuthenticated, authLimiter, requireCsrf, asyncHandler(async (req, res) => {
  if (!getSettingBool('registration_enabled', true)) {
    return res.status(403).render('error', { title: 'Registration disabled', message: 'Registration is disabled.' });
  }

  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).render('auth/register', {
      title: 'Create account',
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const { name, email, password } = parsed.data;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).render('auth/register', {
      title: 'Create account',
      values: { name, email },
      errors: { email: ['This email already has an account.'] },
    });
  }

  const passwordHash = await hashPassword(password);
  const result = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name, email, passwordHash, 'owner');
  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(result.lastInsertRowid);
  setAuthCookie(res, user);
  logAudit({ actorUserId: user.id, action: 'register', ip: req.ip });
  setFlash(res, 'success', 'Account created successfully. Welcome!');
  return res.redirect('/dashboard');
}));

authRouter.get('/login', redirectIfAuthenticated, (req, res) => {
  return res.render('auth/login', { title: 'Login', values: { next: req.query.next || '' }, errors: {} });
});

authRouter.post('/login', redirectIfAuthenticated, authLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).render('auth/login', {
      title: 'Login',
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const { email, password } = parsed.data;
  const user = db.prepare('SELECT id, name, email, password_hash, role, status, two_factor_secret, two_factor_enabled FROM users WHERE email = ?').get(email);
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!ok) {
    return res.status(401).render('auth/login', {
      title: 'Login',
      values: { email, next: parsed.data.next || '' },
      errors: { password: ['Invalid email or password.'] },
    });
  }

  if (user.status !== 'active') {
    logAudit({ actorUserId: user.id, action: 'blocked_login_suspended', ip: req.ip });
    return res.status(403).render('auth/login', {
      title: 'Login',
      values: { email, next: parsed.data.next || '' },
      errors: { password: ['This account is suspended. Please contact support.'] },
    });
  }

  if (user.two_factor_enabled === 1) {
    setAuthCookie(res, user, true);
    const nextParam = parsed.data.next ? `?next=${encodeURIComponent(parsed.data.next)}` : '';
    return res.redirect(`/login/2fa${nextParam}`);
  }

  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), user.id);
  setAuthCookie(res, user);
  logAudit({ actorUserId: user.id, action: 'login', ip: req.ip });
  setFlash(res, 'success', 'Logged in successfully.');
  const target = parsed.data.next ? safeNext(parsed.data.next) : (isSuperAdmin(user) ? '/admin' : '/dashboard');
  return res.redirect(target);
}));

authRouter.post('/logout', requireCsrf, (req, res) => {
  if (req.user) logAudit({ actorUserId: req.user.id, action: 'logout', ip: req.ip });
  clearAuthCookie(res);
  setFlash(res, 'success', 'Logged out successfully.');
  return res.redirect('/');
});

authRouter.get('/login/2fa', (req, res) => {
  if (req.user) {
    return res.redirect(isSuperAdmin(req.user) ? '/admin' : '/dashboard');
  }
  if (!req.tempUser) {
    setFlash(res, 'error', 'Session expired. Please log in again.');
    return res.redirect('/login');
  }
  return res.render('auth/login-2fa', { title: 'Two-Factor Verification', next: req.query.next || '', errors: {} });
});

authRouter.post('/login/2fa', authLimiter, requireCsrf, asyncHandler(async (req, res) => {
  if (req.user) {
    return res.redirect(isSuperAdmin(req.user) ? '/admin' : '/dashboard');
  }
  if (!req.tempUser) {
    setFlash(res, 'error', 'Session expired. Please log in again.');
    return res.redirect('/login');
  }

  const { code } = req.body;
  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).render('auth/login-2fa', {
      title: 'Two-Factor Verification',
      next: req.body.next || '',
      errors: { code: ['Please enter a valid 6-digit verification code.'] },
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.tempUser.id);
  const isValid = verifyTotp(code, user.two_factor_secret);
  if (!isValid) {
    logAudit({ actorUserId: user.id, action: 'failed_2fa', ip: req.ip });
    return res.status(401).render('auth/login-2fa', {
      title: 'Two-Factor Verification',
      next: req.body.next || '',
      errors: { code: ['Invalid code. Please try again.'] },
    });
  }

  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), user.id);
  setAuthCookie(res, user);
  logAudit({ actorUserId: user.id, action: 'login', ip: req.ip });
  setFlash(res, 'success', 'Logged in successfully.');

  const target = req.body.next ? safeNext(req.body.next) : (isSuperAdmin(user) ? '/admin' : '/dashboard');
  return res.redirect(target);
}));

authRouter.get('/forgot-password', redirectIfAuthenticated, (req, res) => {
  res.render('auth/forgot-password', { title: 'Forgot Password', email: '', errors: {} });
});

authRouter.post('/forgot-password', authLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const emailSchema = z.string().trim().email('Valid email is required').transform((v) => v.toLowerCase());
  const parsed = emailSchema.safeParse(req.body.email);
  if (!parsed.success) {
    return res.status(400).render('auth/forgot-password', {
      title: 'Forgot Password',
      email: req.body.email || '',
      errors: { email: ['Please enter a valid email address.'] },
    });
  }

  const email = parsed.data;
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (user) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    db.prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

    const resetLink = `${config.appUrl}/reset-password?token=${token}`;
    console.log(`\n========================================\n[PASSWORD RESET] Link for ${email}:\n${resetLink}\n========================================\n`);
    logAudit({ actorUserId: user.id, action: 'password_reset_requested', ip: req.ip });
  }

  setFlash(res, 'success', 'If that email exists in our system, we have logged a reset link.');
  return res.redirect('/login');
}));

authRouter.get('/reset-password', redirectIfAuthenticated, asyncHandler(async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    setFlash(res, 'error', 'Reset token is missing.');
    return res.redirect('/login');
  }

  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
  if (!reset || new Date(reset.expires_at) < new Date()) {
    setFlash(res, 'error', 'Reset token is invalid or has expired.');
    return res.redirect('/login');
  }

  res.render('auth/reset-password', { title: 'Reset Password', token, errors: {} });
}));

authRouter.post('/reset-password', authLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const token = String(req.body.token || '').trim();
  const password = String(req.body.password || '');

  if (!token) {
    setFlash(res, 'error', 'Reset token is missing.');
    return res.redirect('/login');
  }

  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
  if (!reset || new Date(reset.expires_at) < new Date()) {
    setFlash(res, 'error', 'Reset token is invalid or has expired.');
    return res.redirect('/login');
  }

  if (password.length < 8) {
    return res.status(400).render('auth/reset-password', {
      title: 'Reset Password',
      token,
      errors: { password: ['Password must be at least 8 characters.'] },
    });
  }

  const passwordHash = await hashPassword(password);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, nowIso(), reset.user_id);
    db.prepare('DELETE FROM password_resets WHERE id = ?').run(reset.id);
  })();

  logAudit({ actorUserId: reset.user_id, action: 'password_reset_completed', ip: req.ip });
  setFlash(res, 'success', 'Password reset successfully. You can now log in.');
  return res.redirect('/login');
}));
