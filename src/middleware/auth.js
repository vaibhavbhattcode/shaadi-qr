import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { config } from '../config.js';

export const AUTH_COOKIE = 'wd_auth';

export function signAuthToken(user, isTemp2fa = false) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: isTemp2fa ? 'temp_2fa' : (user.role || 'owner'),
    },
    config.jwtSecret,
    { expiresIn: isTemp2fa ? '15m' : '7d', issuer: 'wedding-qr-photo-app', audience: 'wedding-admin' }
  );
}

export function setAuthCookie(res, user, isTemp2fa = false) {
  const token = signAuthToken(user, isTemp2fa);
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    signed: true,
    maxAge: isTemp2fa ? 15 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    signed: true,
  });
}

export function isSuperAdmin(user) {
  return user?.role === 'super_admin';
}

export async function authContext(req, res, next) {
  res.locals.currentUser = null;
  res.locals.isSuperAdmin = false;
  const token = req.signedCookies?.[AUTH_COOKIE];
  if (!token) return next();

  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      issuer: 'wedding-qr-photo-app',
      audience: 'wedding-admin',
    });
    const user = await db
      .prepare('SELECT id, name, email, role, status, phone_number, google_id, created_at, last_login_at, two_factor_secret, two_factor_enabled FROM users WHERE id = ?')
      .get(Number(payload.sub));

    if (user && user.status === 'active') {
      if (payload.role === 'temp_2fa') {
        req.tempUser = user;
      } else {
        req.user = user;
        res.locals.currentUser = user;
        res.locals.isSuperAdmin = isSuperAdmin(user);
      }
    } else {
      clearAuthCookie(res);
    }
  } catch {
    clearAuthCookie(res);
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    const nextUrl = encodeURIComponent(req.originalUrl || '/dashboard');
    return res.redirect(`/login?next=${nextUrl}`);
  }
  return next();
}

export async function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    const nextUrl = encodeURIComponent(req.originalUrl || '/admin');
    return res.redirect(`/login?next=${nextUrl}`);
  }
  if (!isSuperAdmin(req.user)) {
    return res.status(403).render('error', {
      title: 'Super admin required',
      message: 'You do not have permission to access the super admin panel.',
    });
  }

  // Security: Check if admin is still using the default seeded password
  // Skip check for profile/security pages (so they can actually change it)
  if (config.isProduction && req.originalUrl && !req.originalUrl.startsWith('/dashboard/profile') && !req.originalUrl.startsWith('/dashboard/security')) {
    const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (user && user.password_hash) {
      const isDefault = bcrypt.compareSync('SuperAdmin123!', user.password_hash);
      if (isDefault) {
        return res.render('error', {
          title: 'Password Change Required',
          message: 'You are using the default super admin password. For security, please change it immediately via your Profile → Security Settings before continuing.',
        });
      }
    }
  }

  return next();
}

export function redirectIfAuthenticated(req, res, next) {
  if (req.user) return res.redirect(isSuperAdmin(req.user) ? '/admin' : '/dashboard');
  return next();
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function requireEventOwner(paramName = 'eventId') {
  return async (req, res, next) => {
    const eventId = Number(req.params[paramName]);
    if (!Number.isInteger(eventId)) return res.status(404).render('error', { title: 'Not found', message: 'Event not found.' });
    const event = await db.prepare('SELECT * FROM events WHERE id = ? AND owner_id = ?').get(eventId, req.user.id);
    if (!event) return res.status(404).render('error', { title: 'Not found', message: 'Event not found or you do not have access.' });
    req.event = event;
    res.locals.event = event;
    return next();
  };
}
