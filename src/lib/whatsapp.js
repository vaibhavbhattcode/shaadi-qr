import path from 'node:path';
import fs from 'node:fs';
import QRCode from 'qrcode';
import { config } from '../config.js';

const AUTH_DIR = path.resolve(config.storageDir, 'whatsapp-auth');

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.qrDataUrl = null;
    this.connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
    this.pairedNumber = null;
    this.initPromise = null;
    this.qrString = null;
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._startSocket();
    return this.initPromise;
  }

  async _startSocket() {
    try {
      // Dynamic imports to prevent application crash if there are native compilation issues
      const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import('@whiskeysockets/baileys');
      const { default: pino } = await import('pino');

      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
      });

      this.connectionStatus = 'connecting';

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrString = qr;
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, { width: 320 });
            QRCode.toString(qr, { type: 'terminal', small: true }, (err, qrText) => {
              if (!err) {
                console.log('\n📱 --- SCAN THIS QR TO CONNECT TO WHATSAPP ---');
                console.log(qrText);
                console.log('---------------------------------------------\n');
              }
            });
          } catch (err) {
            console.error('Failed to generate WhatsApp QR code data URL:', err);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          this.connectionStatus = 'disconnected';
          this.qrDataUrl = null;
          this.qrString = null;
          this.pairedNumber = null;
          console.warn(`[WHATSAPP SERVICE] Closed. Code: ${statusCode}, Reconnecting: ${shouldReconnect}`);

          if (shouldReconnect) {
            this.initPromise = null;
            setTimeout(() => this.init(), 5000); // Reconnect with a brief delay
          }
        } else if (connection === 'open') {
          this.connectionStatus = 'connected';
          this.qrDataUrl = null;
          this.qrString = null;
          const userJid = this.sock.user?.id || '';
          this.pairedNumber = userJid.split(':')[0] || userJid.split('@')[0] || 'Unknown';
          console.log(`[WHATSAPP SERVICE] Connected successfully to number: ${this.pairedNumber}`);
        }
      });

      this.sock.ev.on('creds.update', saveCreds);
    } catch (err) {
      console.error('[WHATSAPP SERVICE] Initialization failed:', err);
      this.connectionStatus = 'disconnected';
      this.initPromise = null;
    }
  }

  async sendOtp(phoneNumber, code) {
    let formatted = String(phoneNumber).replace(/[^0-9]/g, '');
    if (formatted.length === 10 && !formatted.startsWith('91')) {
      formatted = '91' + formatted; // Default to India country code
    }

    const maxRetries = 3;
    let sent = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[WHATSAPP SERVICE] Sending OTP to +${formatted} (Attempt ${attempt}/${maxRetries}): code=${code}`);

        if (this.connectionStatus !== 'connected' || !this.sock) {
          console.warn(`[WHATSAPP SERVICE STATUS: ${this.connectionStatus}] Client not paired or active. Logging code to console: ${code}`);
          break; // Stop retries if connection is completely offline
        }

        const jid = `${formatted}@s.whatsapp.net`;
        const message = `💍 *ShaadiShots Secure OTP* 💍\n\nYour one-time verification code is: *${code}*\n\nThis code is valid for 10 minutes. Safe sharing!`;

        await this.sock.sendMessage(jid, { text: message });
        console.log(`[WHATSAPP SERVICE] Message sent successfully to +${formatted}`);
        sent = true;
        break; // Success, stop retrying
      } catch (err) {
        console.error(`[WHATSAPP SERVICE] Attempt ${attempt} failed to send to +${formatted}:`, err.message);
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds before next attempt
        }
      }
    }

    return sent;
  }

  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout().catch(() => {});
      }
    } catch {}

    this.connectionStatus = 'disconnected';
    this.qrDataUrl = null;
    this.qrString = null;
    this.pairedNumber = null;
    this.initPromise = null;

    try {
      if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
    } catch (err) {
      console.error('Failed to clean up authentication directory:', err);
    }

    await this.init();
  }
}

export const whatsappService = new WhatsAppService();
