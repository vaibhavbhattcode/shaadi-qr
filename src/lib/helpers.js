import crypto from 'node:crypto';
import slugifyLib from 'slugify';
import { db } from '../db.js';
import { config, PLAN_LIMITS } from '../config.js';

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function formatBytes(bytes = 0) {
  const num = Number(bytes || 0);
  if (num < 1024) return `${num} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = num / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

export function percent(used, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((Number(used || 0) / Number(total)) * 100));
}

export function planLabel(plan) {
  return PLAN_LIMITS[plan]?.label || 'Basic';
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: value.includes?.('T') || value.includes?.(':') ? 'short' : undefined,
  }).format(date);
}

export function shortNumber(value = 0) {
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));
}

export function cleanSlug(input) {
  return slugifyLib(String(input || ''), {
    lower: true,
    strict: true,
    trim: true,
  }).slice(0, 60);
}

export async function uniqueSlug(baseText) {
  const base = cleanSlug(baseText) || `wedding-${Date.now()}`;
  let slug = base;
  let i = 1;
  while (await db.prepare('SELECT id FROM events WHERE slug = ?').get(slug)) {
    i += 1;
    slug = `${base}-${i}`;
  }
  return slug;
}

export function absoluteUrl(req, pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (req && typeof req.get === 'function') {
    const protocol = req.headers?.['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host');
    if (host) {
      return `${protocol}://${host}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
    }
  }
  const appUrl = (config.appUrl || '').replace(/\/$/, '');
  if (appUrl) return `${appUrl}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
  const protocol = req ? req.protocol : 'http';
  const host = req && typeof req.get === 'function' ? req.get('host') : 'localhost:3000';
  return `${protocol}://${host}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

export function uploadUrl(req, event) {
  return absoluteUrl(req, `/e/${encodeURIComponent(event.slug)}/upload?token=${encodeURIComponent(event.upload_token)}`);
}

export function galleryUrl(req, event) {
  return absoluteUrl(req, `/e/${encodeURIComponent(event.slug)}/gallery`);
}

export function clampText(value, max = 120) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

export function yesNo(value) {
  return value ? 'Yes' : 'No';
}
