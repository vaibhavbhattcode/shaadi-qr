import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Honeypot + Signed Timestamp-based invisible bot protection.
 * Completely cookie-less to prevent blocks on strict mobile browsers (Safari, Brave, Incognito).
 */

/**
 * Generate a cryptographically signed challenge token containing the current timestamp.
 * 
 * @returns {string} The signed token
 */
export function generateChallenge() {
  const ts = Date.now();
  const signature = crypto
    .createHmac('sha256', config.cookieSecret)
    .update(String(ts))
    .digest('hex');
  return `${ts}.${signature}`;
}

/**
 * Verify the submission is from a real user (not a bot).
 * 
 * Checks:
 * 1. Honeypot field must be EMPTY (bots fill hidden fields)
 * 2. Token signature must be valid (prevents timestamp forging)
 * 3. Minimum 2 seconds must have elapsed since page load (bots submit instantly)
 * 4. Maximum 24 hours window (prevents token reuse after a day)
 * 
 * @param {string} honeypotValue - Value of the hidden honeypot field
 * @param {string} tokenValue - Signed challenge token
 * @returns {boolean}
 */
export function verifyChallenge(honeypotValue, tokenValue) {
  // Bot trap: if the hidden honeypot field has any value, it's a bot
  if (honeypotValue && String(honeypotValue).trim().length > 0) {
    return false;
  }

  if (!tokenValue) return false;

  const parts = tokenValue.split('.');
  if (parts.length !== 2) return false;

  const [tsStr, signature] = parts;
  
  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', config.cookieSecret)
    .update(tsStr)
    .digest('hex');

  if (signature !== expectedSignature) {
    return false;
  }

  const timestamp = Number(tsStr);
  if (isNaN(timestamp)) return false;

  const elapsed = Date.now() - timestamp;

  // Expired: page was loaded more than 24 hours ago
  if (elapsed > 24 * 60 * 60 * 1000) return false;

  // Too fast: submission in under 2 seconds is bot-like
  if (elapsed < 2000) return false;

  return true;
}

// Keep old exports for backward compatibility
export const generateCaptcha = () => ({ token: generateChallenge() });
export const verifyCaptcha = (submitted, tokenValue) => verifyChallenge(submitted, tokenValue);
