import { db, nowIso, getSettingBool } from '../db.js';
import { verifyPassword, hashPassword } from '../middleware/auth.js';
import { ValidationError, UnauthorizedError, ForbiddenError, ConflictError } from '../lib/errors.js';
import { whatsappService } from '../lib/whatsapp.js';
import { randomToken } from '../lib/helpers.js';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { sendEmail } from '../lib/email.js';

export class AuthService {
  /**
   * Verify email/password credentials.
   */
  static async verifyCredentials(email, password, isAdminMode = false) {
    if (!isAdminMode && !(await getSettingBool('email_login_enabled', true))) {
      throw new ForbiddenError('Email/Password login is currently disabled by the administrator.');
    }

    const user = await db.prepare('SELECT id, name, email, password_hash, role, status, two_factor_secret, two_factor_enabled FROM users WHERE email = ?').get(email);
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    
    if (!ok) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    if (user.status !== 'active') {
      throw new ForbiddenError('This account is suspended. Please contact support.');
    }

    return user;
  }

  /**
   * Complete standard user registration.
   */
  static async registerUser(name, email, password) {
    if (!(await getSettingBool('registration_enabled', true))) {
      throw new ForbiddenError('Registration is disabled.');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) {
      throw new ConflictError('This email is already registered.');
    }

    const pwHash = await hashPassword(password);
    const insert = await db.prepare("INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, 'owner', 'active')")
      .run(name, normalizedEmail, pwHash);

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(insert.lastInsertRowid);

    // Send Welcome Email
    try {
      await sendEmail({
        to: normalizedEmail,
        subject: 'Welcome to ShaadiShots! 📸',
        html: `
          <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #b83280;">Welcome to ShaadiShots, ${name}!</h2>
            <p>We are absolutely thrilled to help you capture your special wedding moments.</p>
            <p>Log in to your dashboard to create folders, print displays, and customize your live gallery.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${config.appUrl}/login" style="background: linear-gradient(135deg, #b83280 0%, #ff7a59 100%); color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 999px; font-weight: bold; display: inline-block;">Go to Dashboard</a>
            </div>
            <p>If you have any questions, feel free to reply to this email.</p>
          </div>
        `
      });
    } catch (err) {
      console.error('Failed to send welcome email:', err);
    }

    return user;
  }

  /**
   * Verify Google OAuth ID token and return user.
   */
  static async verifyGoogleLogin(credential) {
    const client = new OAuth2Client(config.google.clientId);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: config.google.clientId,
    });
    const payload = ticket.getPayload();

    const email = payload.email?.toLowerCase();
    const name = payload.name || 'Google User';
    const googleId = payload.sub;

    if (!email || !googleId) {
      throw new ValidationError('Incomplete Google account profile details.');
    }

    let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);

    if (!user) {
      user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (user) {
        await db.prepare('UPDATE users SET google_id = ?, updated_at = ? WHERE id = ?').run(googleId, nowIso(), user.id);
        user.google_id = googleId;
      } else {
        const dummyPasswordHash = await hashPassword(randomToken(16));
        const insert = await db.prepare('INSERT INTO users (name, email, password_hash, role, google_id) VALUES (?, ?, ?, ?, ?)')
          .run(name, email, dummyPasswordHash, 'owner', googleId);
        
        user = await db.prepare('SELECT * FROM users WHERE id = ?').get(insert.lastInsertRowid);
      }
    }

    if (user.status !== 'active') {
      throw new ForbiddenError('This account is suspended.');
    }

    return user;
  }

  /**
   * Verify Google Mock sandbox login.
   */
  static async verifyGoogleMockLogin() {
    if (config.google.clientId) {
      throw new ValidationError('Mock login is disabled when real Google Client ID is configured.');
    }

    const mockEmail = 'demo.google@shaadishots.local';
    const mockGoogleId = 'mock_google_1234567890';
    const mockName = 'Demo Google User';

    let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').get(mockGoogleId);
    if (!user) {
      user = await db.prepare('SELECT * FROM users WHERE email = ?').get(mockEmail);
      if (user) {
        await db.prepare('UPDATE users SET google_id = ?, updated_at = ? WHERE id = ?').run(mockGoogleId, nowIso(), user.id);
        user.google_id = mockGoogleId;
      } else {
        const dummyPasswordHash = await hashPassword(randomToken(16));
        const insert = await db.prepare('INSERT INTO users (name, email, password_hash, role, google_id) VALUES (?, ?, ?, ?, ?)')
          .run(mockName, mockEmail, dummyPasswordHash, 'owner', mockGoogleId);
        
        user = await db.prepare('SELECT * FROM users WHERE id = ?').get(insert.lastInsertRowid);
      }
    }

    if (user.status !== 'active') {
      throw new ForbiddenError('Demo account is suspended.');
    }

    return user;
  }

  /**
   * Send WhatsApp OTP.
   */
  static async sendOtp(phone) {
    if (!(await getSettingBool('whatsapp_login_enabled', true))) {
      throw new ForbiddenError('WhatsApp OTP login is disabled by the administrator.');
    }

    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length === 10 && !cleanPhone.startsWith('91')) {
      cleanPhone = '91' + cleanPhone;
    }

    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      throw new ValidationError('Please enter a valid phone number with country code.');
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await db.prepare('DELETE FROM otp_verifications WHERE phone_number = ?').run(cleanPhone);
    await db.prepare('INSERT INTO otp_verifications (phone_number, code, expires_at) VALUES (?, ?, ?)')
      .run(cleanPhone, code, expiresAt);

    const sent = await whatsappService.sendOtp(cleanPhone, code);

    return { cleanPhone, code, sent };
  }

  /**
   * Verify WhatsApp OTP.
   */
  static async verifyOtp(phone, code) {
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length === 10 && !cleanPhone.startsWith('91')) {
      cleanPhone = '91' + cleanPhone;
    }

    const cleanCode = String(code).trim();

    const record = await db.prepare('SELECT * FROM otp_verifications WHERE phone_number = ? AND code = ?').get(cleanPhone, cleanCode);
    if (!record || new Date(record.expires_at) < new Date()) {
      throw new ValidationError('Invalid or expired verification code.');
    }

    await db.prepare('DELETE FROM otp_verifications WHERE id = ?').run(record.id);

    let user = await db.prepare('SELECT * FROM users WHERE phone_number = ?').get(cleanPhone);
    
    if (!user) {
      const email = `phone-${cleanPhone}@shaadishots.local`;
      const name = `User +${cleanPhone.slice(-10)}`;
      const dummyPasswordHash = await hashPassword(randomToken(16));
      
      let emailClash = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (emailClash) {
        throw new ConflictError('Registration failed due to email conflict.');
      }

      const insert = await db.prepare('INSERT INTO users (name, email, password_hash, role, phone_number) VALUES (?, ?, ?, ?, ?)')
        .run(name, email, dummyPasswordHash, 'owner', cleanPhone);
      
      user = await db.prepare('SELECT * FROM users WHERE id = ?').get(insert.lastInsertRowid);
    }

    if (user.status !== 'active') {
      throw new ForbiddenError('This account is suspended.');
    }

    return user;
  }

  /**
   * Send Email OTP.
   */
  static async sendEmailOtp(email) {
    const normalizedEmail = email.toLowerCase().trim();

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await db.prepare('DELETE FROM email_otp_verifications WHERE email = ?').run(normalizedEmail);
    await db.prepare('INSERT INTO email_otp_verifications (email, code, expires_at) VALUES (?, ?, ?)')
      .run(normalizedEmail, code, expiresAt);

    // Send transactional email
    try {
      await sendEmail({
        to: normalizedEmail,
        subject: `Your ShaadiShots Verification Code: ${code} 📸`,
        html: `
          <div style="font-family: 'Plus Jakarta Sans', sans-serif; padding: 25px; max-width: 500px; margin: 0 auto; border: 1px solid rgba(184, 50, 128, 0.1); border-radius: 16px; background-color: #fdf8f9;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #b83280; font-family: 'Playfair Display', serif; font-size: 24px; margin: 0;">ShaadiShots</h2>
              <p style="color: #7c6578; font-size: 14px; margin: 5px 0 0 0;">Capture Every Candid Moment</p>
            </div>
            <div style="background: #ffffff; padding: 20px; border-radius: 12px; border: 1px solid rgba(184, 50, 128, 0.08); text-align: center; box-shadow: 0 4px 12px rgba(78, 30, 62, 0.03);">
              <h3 style="color: #24111f; margin-top: 0; font-size: 18px;">Email Verification Code</h3>
              <p style="color: #7c6578; font-size: 14px; line-height: 1.5;">Use the verification code below to complete your sign-up or login. This code is valid for 10 minutes.</p>
              <div style="display: inline-block; letter-spacing: 0.1em; font-size: 32px; font-weight: 900; color: #b83280; padding: 10px 25px; background: rgba(184, 50, 128, 0.05); border-radius: 8px; margin: 15px 0; border: 1px dashed rgba(184, 50, 128, 0.25);">
                ${code}
              </div>
              <p style="color: #7c6578; font-size: 12px; margin: 10px 0 0 0;">If you did not request this code, you can safely ignore this email.</p>
            </div>
            <div style="text-align: center; margin-top: 20px; color: #7c6578; font-size: 12px;">
              © 2026 ShaadiShots. Secure wedding memory collection.
            </div>
          </div>
        `
      });
    } catch (err) {
      console.error('Failed to send verification email:', err);
    }

    console.log(`\n========================================\n[EMAIL OTP] Code for ${normalizedEmail}: ${code}\n========================================\n`);

    return { normalizedEmail, code };
  }

  /**
   * Verify Email OTP.
   */
  static async verifyEmailOtp(email, code) {
    const normalizedEmail = email.toLowerCase().trim();
    const cleanCode = String(code).trim();

    const record = await db.prepare('SELECT * FROM email_otp_verifications WHERE email = ? AND code = ?').get(normalizedEmail, cleanCode);
    if (!record || new Date(record.expires_at) < new Date()) {
      throw new ValidationError('Invalid or expired verification code.');
    }

    await db.prepare('DELETE FROM email_otp_verifications WHERE id = ?').run(record.id);
    return true;
  }

  /**
   * Record last login.
   */
  static async updateLastLogin(userId) {
    await db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), userId);
  }
}
