import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { db } from '../db.js';

export function ipBlocker(req, res, next) {
  try {
    const blocked = db.prepare('SELECT 1 FROM blocked_ips WHERE ip = ?').get(req.ip);
    if (blocked) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'Your IP address has been temporarily or permanently blocked due to suspicious activity.',
      });
    }
  } catch (err) {
    console.error('IP blocker error:', err);
  }
  next();
}


export function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com/gsi/client", "https://checkout.razorpay.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com/gsi/style"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com', 'https://ssl.gstatic.com', 'https://*.razorpay.com'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", "https://accounts.google.com", "https://api.razorpay.com", "https://checkout.razorpay.com"],
        frameSrc: ["'self'", "https://accounts.google.com", "https://api.razorpay.com", "https://checkout.razorpay.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many login/register attempts. Please wait and try again.',
});

export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'Too many upload attempts. Please wait and try again.' },
});
