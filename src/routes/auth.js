import express from 'express';
import { z } from 'zod';
import { db, logAudit, nowIso, getSettingBool } from '../db.js';
import { config } from '../config.js';
import { authLimiter } from '../middleware/security.js';
import { requireCsrf } from '../middleware/csrf.js';
import { clearAuthCookie, hashPassword, isSuperAdmin, redirectIfAuthenticated, setAuthCookie } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { asyncHandler } from '../lib/async-handler.js';
import { verifyTotp } from '../lib/totp.js';
import { randomToken } from '../lib/helpers.js';
import { AuthService } from '../services/auth.service.js';
import { sendEmail } from '../lib/email.js';

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

authRouter.get('/register', redirectIfAuthenticated, asyncHandler(async (req, res) => {
  if (!(await getSettingBool('registration_enabled', true))) {
    return res.status(403).render('error', { title: 'Registration disabled', message: 'Registration is disabled. Ask the owner to create your account.' });
  }
  const whatsappEnabled = await getSettingBool('whatsapp_login_enabled', true);
  const emailLoginEnabled = await getSettingBool('email_login_enabled', true);
  return res.render('auth/register', { title: 'Create account', values: {}, errors: {}, whatsappEnabled, emailLoginEnabled });
}));

authRouter.post('/register', redirectIfAuthenticated, (req, res) => {
  return res.status(400).render('error', { title: 'Registration disabled', message: 'Please complete registration using the OTP verification form.' });
});

authRouter.get('/login', redirectIfAuthenticated, asyncHandler(async (req, res) => {
  const whatsappEnabled = await getSettingBool('whatsapp_login_enabled', true);
  const emailLoginEnabled = await getSettingBool('email_login_enabled', true);
  const registrationEnabled = await getSettingBool('registration_enabled', true);
  return res.render('auth/login', { 
    title: 'Login', 
    values: { next: req.query.next || '' }, 
    errors: {}, 
    isAdminMode: req.query.admin === '1', 
    whatsappEnabled,
    emailLoginEnabled,
    registrationEnabled
  });
}));

authRouter.post('/login', redirectIfAuthenticated, authLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  const isAdminMode = req.body.admin === '1';

  if (!isAdminMode && !(await getSettingBool('email_login_enabled', true))) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Email/Password login is currently disabled by the administrator.' });
  }

  const whatsappEnabled = await getSettingBool('whatsapp_login_enabled', true);
  const emailLoginEnabled = await getSettingBool('email_login_enabled', true);
  const registrationEnabled = await getSettingBool('registration_enabled', true);

  if (!parsed.success) {
    return res.status(400).render('auth/login', {
      title: 'Login',
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
      isAdminMode,
      whatsappEnabled,
      emailLoginEnabled,
      registrationEnabled,
    });
  }

  const { email, password } = parsed.data;
  try {
    const user = await AuthService.verifyCredentials(email, password, isAdminMode);

    if (user.two_factor_enabled === 1) {
      setAuthCookie(res, user, true);
      const nextParam = parsed.data.next ? `?next=${encodeURIComponent(parsed.data.next)}` : '';
      return res.redirect(`/login/2fa${nextParam}`);
    }

    await AuthService.updateLastLogin(user.id);
    setAuthCookie(res, user);
    await logAudit({ actorUserId: user.id, action: 'login', ip: req.ip });
    setFlash(res, 'success', 'Logged in successfully.');
    const target = parsed.data.next ? safeNext(parsed.data.next) : (isSuperAdmin(user) ? '/admin' : '/dashboard');
    return res.redirect(target);
  } catch (err) {
    if (err.statusCode === 403 && err.message.includes('suspended')) {
      const checkUser = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (checkUser) await logAudit({ actorUserId: checkUser.id, action: 'blocked_login_suspended', ip: req.ip });
    }
    return res.status(err.statusCode || 401).render('auth/login', {
      title: 'Login',
      values: { email, next: parsed.data.next || '' },
      errors: { password: [err.message] },
      isAdminMode,
      whatsappEnabled,
      emailLoginEnabled,
      registrationEnabled,
    });
  }
}));

authRouter.post('/logout', requireCsrf, asyncHandler(async (req, res) => {
  if (req.user) await logAudit({ actorUserId: req.user.id, action: 'logout', ip: req.ip });
  clearAuthCookie(res);
  setFlash(res, 'success', 'Logged out successfully.');
  return res.redirect('/');
}));

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

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.tempUser.id);
  const isValid = verifyTotp(code, user.two_factor_secret);
  if (!isValid) {
    await logAudit({ actorUserId: user.id, action: 'failed_2fa', ip: req.ip });
    return res.status(401).render('auth/login-2fa', {
      title: 'Two-Factor Verification',
      next: req.body.next || '',
      errors: { code: ['Invalid code. Please try again.'] },
    });
  }

  await db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), user.id);
  setAuthCookie(res, user);
  await logAudit({ actorUserId: user.id, action: 'login', ip: req.ip });
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
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (user) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    
    await db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    await db.prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

    const resetLink = `${config.appUrl}/reset-password?token=${token}`;
    
    // Send transactional email
    try {
      await sendEmail({
        to: email,
        subject: 'Reset your ShaadiShots Password',
        html: `
          <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #b83280;">Password Reset Request</h2>
            <p>We received a request to reset your password for your ShaadiShots account. Click the button below to choose a new password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" style="background: linear-gradient(135deg, #b83280 0%, #ff7a59 100%); color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 999px; font-weight: bold; display: inline-block;">Reset Password</a>
            </div>
            <p style="color: #666; font-size: 12px;">This link will expire in 60 minutes. If you did not request this, you can safely ignore this email.</p>
          </div>
        `
      });
    } catch (err) {
      console.error('Failed to dispatch password reset email:', err);
    }

    console.log(`\n========================================\n[PASSWORD RESET] Link for ${email}:\n${resetLink}\n========================================\n`);
    await logAudit({ actorUserId: user.id, action: 'password_reset_requested', ip: req.ip });
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

  const reset = await db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
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

  const reset = await db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
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
  await db.transaction(async (txClient) => {
    if (txClient && typeof txClient.query === 'function') {
      await txClient.query('UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3', [passwordHash, nowIso(), reset.user_id]);
      await txClient.query('DELETE FROM password_resets WHERE id = $1', [reset.id]);
    } else {
      await db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, nowIso(), reset.user_id);
      await db.prepare('DELETE FROM password_resets WHERE id = ?').run(reset.id);
    }
  });

  await logAudit({ actorUserId: reset.user_id, action: 'password_reset_completed', ip: req.ip });
  setFlash(res, 'success', 'Password reset successfully. You can now log in.');
  return res.redirect('/login');
}));

authRouter.post('/auth/google', authLimiter, asyncHandler(async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ ok: false, error: 'Google ID Token is missing.' });
  }

  try {
    const user = await AuthService.verifyGoogleLogin(credential);

    await AuthService.updateLastLogin(user.id);
    setAuthCookie(res, user);
    await logAudit({ actorUserId: user.id, action: 'login_google', ip: req.ip });
    setFlash(res, 'success', 'Logged in successfully with Google.');
    return res.json({ ok: true, redirectUrl: '/dashboard' });
  } catch (err) {
    console.error('Google Auth Route Error:', err);
    return res.status(err.statusCode || 500).json({ ok: false, error: err.message || 'Failed to verify Google credential.' });
  }
}));

authRouter.post('/auth/google/mock', authLimiter, asyncHandler(async (req, res) => {
  try {
    const user = await AuthService.verifyGoogleMockLogin();

    await AuthService.updateLastLogin(user.id);
    setAuthCookie(res, user);
    await logAudit({ actorUserId: user.id, action: 'login_google_mock', ip: req.ip });
    setFlash(res, 'success', 'Logged in successfully with Google Demo Sandbox.');
    return res.json({ ok: true, redirectUrl: '/dashboard' });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
}));

authRouter.post('/auth/whatsapp/send-otp', authLimiter, asyncHandler(async (req, res) => {
  const { phone } = req.body;
  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ ok: false, error: 'Phone number is required.' });
  }

  try {
    const result = await AuthService.sendOtp(phone);

    if (!result.sent) {
      console.log(`\n========================================\n[WHATSAPP OTP FALLBACK] Phone: +${result.cleanPhone}\nCode: ${result.code}\n========================================\n`);
      return res.json({ ok: true, message: 'OTP sent in fallback mode.', mockOtp: result.code });
    }

    return res.json({ ok: true, message: 'OTP sent successfully.' });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
}));

authRouter.post('/auth/whatsapp/verify-otp', authLimiter, asyncHandler(async (req, res) => {
  const { phone, code, next } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ ok: false, error: 'Phone number and verification code are required.' });
  }

  try {
    const user = await AuthService.verifyOtp(phone, code);

    await AuthService.updateLastLogin(user.id);
    setAuthCookie(res, user);
    await logAudit({ actorUserId: user.id, action: 'login_whatsapp', ip: req.ip });
    setFlash(res, 'success', 'Logged in successfully via WhatsApp OTP.');

    const target = next ? safeNext(next) : (isSuperAdmin(user) ? '/admin' : '/dashboard');
    return res.json({ ok: true, redirectUrl: target });
  } catch (err) {
    const cleanPhone = String(phone).replace(/[^0-9]/g, '');
    await logAudit({ action: 'failed_whatsapp_otp', metadata: { phone: cleanPhone }, ip: req.ip });
    return res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
}));

authRouter.post('/auth/email/send-otp', authLimiter, asyncHandler(async (req, res) => {
  const { email, action } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ ok: false, error: 'Email address is required.' });
  }
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);

  if (action === 'register') {
    if (!(await getSettingBool('registration_enabled', true))) {
      return res.status(403).json({ ok: false, error: 'Registration is currently disabled.' });
    }
    if (existing) {
      return res.status(400).json({ ok: false, error: 'This email is already registered.' });
    }
  } else if (action === 'login') {
    if (!existing) {
      return res.status(400).json({ ok: false, error: 'This email is not registered. Please create an account first.' });
    }
    const user = await db.prepare('SELECT status FROM users WHERE email = ?').get(normalizedEmail);
    if (user && user.status !== 'active') {
      return res.status(403).json({ ok: false, error: 'This account is suspended. Please contact support.' });
    }
  } else {
    return res.status(400).json({ ok: false, error: 'Invalid action.' });
  }

  const result = await AuthService.sendEmailOtp(normalizedEmail);
  return res.json({ ok: true, message: 'Verification code sent to your email.', mockOtp: result.code });
}));

authRouter.post('/auth/email/verify-otp', authLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { email, code, next } = req.body;
  if (!email || !code) {
    return res.status(400).json({ ok: false, error: 'Email and verification code are required.' });
  }

  try {
    await AuthService.verifyEmailOtp(email, code);
    
    const normalizedEmail = email.toLowerCase().trim();
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    if (!user) {
      return res.status(400).json({ ok: false, error: 'User account not found.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ ok: false, error: 'This account is suspended. Please contact support.' });
    }

    await AuthService.updateLastLogin(user.id);
    setAuthCookie(res, user);
    await logAudit({ actorUserId: user.id, action: 'login_email_otp', ip: req.ip });
    setFlash(res, 'success', 'Logged in successfully via Email OTP.');

    const target = next ? safeNext(next) : (isSuperAdmin(user) ? '/admin' : '/dashboard');
    return res.json({ ok: true, redirectUrl: target });
  } catch (err) {
    await logAudit({ action: 'failed_email_otp', metadata: { email: email.toLowerCase().trim() }, ip: req.ip });
    return res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
}));

authRouter.post('/auth/email/register-verify', authLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { name, email, password, code } = req.body;
  if (!name || !email || !password || !code) {
    return res.status(400).json({ ok: false, error: 'All fields are required.' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (password.length < 8) {
    return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters.' });
  }

  try {
    // 1. Verify OTP first
    await AuthService.verifyEmailOtp(normalizedEmail, code);

    // 2. Create the user
    const user = await AuthService.registerUser(name, normalizedEmail, password);

    // 3. Log them in
    await AuthService.updateLastLogin(user.id);
    setAuthCookie(res, user);
    await logAudit({ actorUserId: user.id, action: 'register_email_otp', ip: req.ip });
    setFlash(res, 'success', 'Welcome! Your account has been registered and verified.');

    return res.json({ ok: true, redirectUrl: '/dashboard' });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
}));
