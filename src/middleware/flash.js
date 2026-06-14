import { config } from '../config.js';

const FLASH_COOKIE = 'wd_flash';

export function setFlash(res, type, message) {
  res.cookie(FLASH_COOKIE, JSON.stringify({ type, message }), {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    signed: true,
    maxAge: 60 * 1000,
  });
}

export function flashContext(req, res, next) {
  const raw = req.signedCookies?.[FLASH_COOKIE];
  res.locals.flash = null;
  if (raw) {
    try {
      res.locals.flash = JSON.parse(raw);
    } catch {
      res.locals.flash = null;
    }
    res.clearCookie(FLASH_COOKIE, {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: config.cookie.sameSite,
      signed: true,
    });
  }
  next();
}
