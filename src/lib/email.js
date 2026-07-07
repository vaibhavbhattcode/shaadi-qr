import { config } from '../config.js';

/**
 * Transactional Email Service.
 * Speaks directly to Resend API using lightweight native fetch.
 * Defaults to logging to console in development if no key is configured.
 */
export async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';

  if (!apiKey) {
    console.log(`
============================================================
[EMAIL MOCK FALLBACK]
To: ${to}
Subject: ${subject}
From: ${fromEmail}

${html.replace(/<[^>]*>/g, '')}
============================================================
`);
    return { mock: true, sent: true };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: `ShaadiShots <${fromEmail}>`,
        to: Array.isArray(to) ? to : [to],
        subject,
        html
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Failed to send email via Resend');
    }

    return { id: data.id, sent: true };
  } catch (err) {
    console.error('[EMAIL ERROR] Failed to send email via Resend:', err);
    throw err;
  }
}
