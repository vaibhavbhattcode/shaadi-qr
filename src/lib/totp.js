import crypto from 'node:crypto';

// Decode base32 to buffer
function base32Decode(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) {
      throw new Error('Invalid base32 character');
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// Generate an HOTP value
export function generateHotp(secret, counter) {
  const keyBuffer = typeof secret === 'string' ? base32Decode(secret) : secret;
  const counterBuffer = Buffer.alloc(8);
  // Write counter as 64-bit integer
  let tmp = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    counterBuffer[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }

  const hmac = crypto.createHmac('sha1', keyBuffer);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0xf;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = code % 1000000;
  return String(otp).padStart(6, '0');
}

// Generate standard TOTP
export function generateTotp(secret, timeStep = 30) {
  const counter = Math.floor(Date.now() / 1000 / timeStep);
  return generateHotp(secret, counter);
}

// Verify TOTP token, allowing window of 1 step before and after
export function verifyTotp(token, secret, window = 1, timeStep = 30) {
  const cleanToken = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanToken)) return false;

  const currentCounter = Math.floor(Date.now() / 1000 / timeStep);
  for (let i = -window; i <= window; i++) {
    if (generateHotp(secret, currentCounter + i) === cleanToken) {
      return true;
    }
  }
  return false;
}

// Helper to generate a random base32 secret
export function generateSecret(length = 20) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

// Helper to get otpauth URL for QR codes
export function getOtpAuthUrl(label, secret, issuer = 'ShaadiShots') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}
