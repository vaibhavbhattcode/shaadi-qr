import crypto from 'node:crypto';
import { config } from '../config.js';

const CSRF_COOKIE = 'wd_csrf';

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function timingSafeEqualString(a, b) {
  const aBuf = Buffer.from(String(a || ''));
  const bBuf = Buffer.from(String(b || ''));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function csrfContext(req, res, next) {
  let token = req.signedCookies?.[CSRF_COOKIE];
  if (!token) {
    token = randomToken();
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure: config.cookie.secure,
      sameSite: config.cookie.sameSite,
      signed: true,
      maxAge: 24 * 60 * 60 * 1000,
    });
  }
  req.csrfToken = token;
  res.locals.csrfToken = token;
  next();
}

export function requireCsrf(req, res, next) {
  const cookieToken = req.signedCookies?.[CSRF_COOKIE];
  const submitted = req.get('x-csrf-token') || req.body?._csrf || req.query?._csrf;
  if (!cookieToken || !submitted || !timingSafeEqualString(cookieToken, submitted)) {
    const wantsJson = req.xhr || req.get('accept')?.includes('application/json');
    if (wantsJson) return res.status(403).json({ ok: false, error: 'Security token expired. Refresh the page and try again.' });
    return res.status(403).render('error', { title: 'Security check failed', message: 'Security token expired. Please refresh the page and try again.' });
  }
  return next();
}
