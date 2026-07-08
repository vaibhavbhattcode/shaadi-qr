/**
 * Honeypot + Timestamp-based invisible bot protection.
 * 
 * Replaces the old math CAPTCHA ("What is 5 + 3?") which was a major
 * guest drop-off point — elderly guests and non-technical users struggle 
 * with it, and it feels unprofessional for a premium wedding product.
 * 
 * Defense layers:
 * 1. Honeypot field — hidden field that bots auto-fill but humans don't see
 * 2. Timestamp validation — submissions faster than 2 seconds are bot-like
 * 3. Rate limiter (external) — handled by uploadLimiter middleware
 */

/**
 * Generate a challenge token containing the page load timestamp.
 * This is stored in a signed cookie so it can't be forged.
 * 
 * @returns {{ token: string }}
 */
export function generateChallenge() {
  const token = String(Date.now());
  return { token };
}

/**
 * Verify the submission is from a real user (not a bot).
 * 
 * Checks:
 * 1. Honeypot field must be EMPTY (bots fill hidden fields)
 * 2. Cookie timestamp must exist and not be expired (10 min window)
 * 3. Minimum 2 seconds must have elapsed since page load (bots submit instantly)
 * 
 * @param {string} honeypotValue - Value of the hidden honeypot field
 * @param {string} cookieValue - Signed cookie value containing page load timestamp
 * @returns {boolean}
 */
export function verifyChallenge(honeypotValue, cookieValue) {
  // Bot trap: if the hidden honeypot field has any value, it's a bot
  if (honeypotValue && String(honeypotValue).trim().length > 0) {
    return false;
  }

  // Validate timestamp cookie
  if (!cookieValue) return false;

  const timestamp = Number(cookieValue);
  if (isNaN(timestamp)) return false;

  const elapsed = Date.now() - timestamp;

  // Expired: page was loaded more than 24 hours ago
  if (elapsed > 24 * 60 * 60 * 1000) return false;

  // Too fast: submission in under 2 seconds is bot-like
  if (elapsed < 2000) return false;

  return true;
}

// Keep old exports for backward compatibility during transition
export const generateCaptcha = generateChallenge;
export const verifyCaptcha = (submitted, cookieValue) => verifyChallenge(submitted, cookieValue);
