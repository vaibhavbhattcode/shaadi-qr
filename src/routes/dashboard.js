import express from 'express';
import bcrypt from 'bcryptjs';
import archiver from 'archiver';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db, getStorageUsage, logAudit, mediaCounts, nowIso } from '../db.js';
import { PLAN_LIMITS, config } from '../config.js';
import { requireAuth, requireEventOwner } from '../middleware/auth.js';
import { requireCsrf } from '../middleware/csrf.js';
import { setFlash } from '../middleware/flash.js';
import { deleteMediaFileAndRow, resolveStoragePath, sendMediaFile, sendMediaThumbnail, s3Client, GetObjectCommand } from '../lib/storage.js';
import { absoluteUrl, cleanSlug, formatBytes, galleryUrl, percent, planLabel, randomToken, uniqueSlug, uploadUrl } from '../lib/helpers.js';
import { asyncHandler } from '../lib/async-handler.js';
import { generateSecret, getOtpAuthUrl, verifyTotp } from '../lib/totp.js';
import { getAuthUrl, getTokens } from '../lib/google-drive.js';


export const dashboardRouter = express.Router();

dashboardRouter.use(requireAuth);

function eventStats(event) {
  const used = getStorageUsage(event.id);
  const counts = mediaCounts(event.id);
  return {
    used,
    usedHuman: formatBytes(used),
    limitHuman: formatBytes(event.storage_limit_bytes),
    percent: percent(used, event.storage_limit_bytes),
    counts,
    planLabel: planLabel(event.plan),
  };
}

function listFolders(eventId) {
  return db.prepare('SELECT * FROM folders WHERE event_id = ? ORDER BY sort_order ASC, id ASC').all(eventId);
}

const eventCreateSchema = z.object({
  title: z.string().trim().min(2, 'Wedding title is required').max(120),
  bride_name: z.string().trim().max(80).optional().default(''),
  groom_name: z.string().trim().max(80).optional().default(''),
  wedding_date: z.string().trim().max(30).optional().default(''),
  venue: z.string().trim().max(160).optional().default(''),
  city: z.string().trim().max(80).optional().default(''),
  slug: z.string().trim().max(70).optional().default(''),
  folders: z.string().trim().max(500).optional().default('Haldi, Mehndi, Baraat, Reception'),
});

const settingsSchema = z.object({
  title: z.string().trim().min(2, 'Wedding title is required').max(120),
  bride_name: z.string().trim().max(80).optional().default(''),
  groom_name: z.string().trim().max(80).optional().default(''),
  wedding_date: z.string().trim().max(30).optional().default(''),
  venue: z.string().trim().max(160).optional().default(''),
  city: z.string().trim().max(80).optional().default(''),
  gallery_pin: z.string().trim().max(12).optional().default(''),
});

const folderSchema = z.object({
  name: z.string().trim().min(2, 'Folder name is required').max(50),
});

dashboardRouter.get('/dashboard', (req, res) => {
  const events = db.prepare('SELECT * FROM events WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.id);
  const enriched = events.map((event) => ({ ...event, stats: eventStats(event), uploadUrl: uploadUrl(req, event), galleryUrl: galleryUrl(req, event) }));
  res.render('dashboard/index', { title: 'Dashboard', events: enriched });
});

dashboardRouter.get('/dashboard/events/new', (req, res) => {
  res.render('dashboard/new-event', {
    title: 'Create wedding event',
    values: { folders: 'Haldi, Mehndi, Baraat, Reception', plan: 'basic' },
    errors: {},
    plans: PLAN_LIMITS,
  });
});

dashboardRouter.post('/dashboard/events', requireCsrf, (req, res) => {
  const parsed = eventCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).render('dashboard/new-event', {
      title: 'Create wedding event',
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
      plans: PLAN_LIMITS,
    });
  }

  const data = parsed.data;
  let slug = data.slug ? cleanSlug(data.slug) : uniqueSlug(data.title);
  if (!slug) slug = uniqueSlug(data.title);
  if (data.slug && db.prepare('SELECT id FROM events WHERE slug = ?').get(slug)) {
    return res.status(409).render('dashboard/new-event', {
      title: 'Create wedding event',
      values: req.body,
      errors: { slug: ['This link slug is already taken.'] },
      plans: PLAN_LIMITS,
    });
  }
  if (!data.slug) slug = uniqueSlug(data.title);

  const plan = PLAN_LIMITS.basic;
  const folderNames = data.folders
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (folderNames.length === 0) folderNames.push('Wedding');

  const createEvent = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO events (
        owner_id, title, bride_name, groom_name, slug, upload_token, wedding_date, venue, city, plan, storage_limit_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      data.title,
      data.bride_name || null,
      data.groom_name || null,
      slug,
      randomToken(24),
      data.wedding_date || null,
      data.venue || null,
      data.city || null,
      'basic',
      plan.storageLimitBytes
    );

    const eventId = Number(result.lastInsertRowid);
    const insertFolder = db.prepare('INSERT OR IGNORE INTO folders (event_id, name, sort_order) VALUES (?, ?, ?)');
    folderNames.forEach((name, index) => insertFolder.run(eventId, name, index));
    return eventId;
  });

  const eventId = createEvent();
  logAudit({ actorUserId: req.user.id, eventId, action: 'event_create', ip: req.ip });
  setFlash(res, 'success', 'Wedding event created. Download QR and share it with guests.');
  return res.redirect(`/dashboard/events/${eventId}`);
});

dashboardRouter.get('/dashboard/events/:eventId', requireEventOwner(), asyncHandler(async (req, res) => {
  const folders = listFolders(req.event.id);
  const stats = eventStats(req.event);
  const qrDataUrl = await QRCode.toDataURL(uploadUrl(req, req.event), { width: 520, margin: 2, errorCorrectionLevel: 'M' });
  res.render('dashboard/event', {
    title: req.event.title,
    event: req.event,
    folders,
    stats,
    plans: PLAN_LIMITS,
    uploadLink: uploadUrl(req, req.event),
    galleryLink: galleryUrl(req, req.event),
    qrDataUrl,
    errors: {},
  });
}));

dashboardRouter.post('/dashboard/events/:eventId/settings', requireEventOwner(), requireCsrf, asyncHandler(async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  const folders = listFolders(req.event.id);
  const stats = eventStats(req.event);
  if (!parsed.success) {
    return res.status(400).render('dashboard/event', {
      title: req.event.title,
      event: { ...req.event, ...req.body },
      folders,
      stats,
      plans: PLAN_LIMITS,
      uploadLink: uploadUrl(req, req.event),
      galleryLink: galleryUrl(req, req.event),
      qrDataUrl: await QRCode.toDataURL(uploadUrl(req, req.event), { width: 520, margin: 2 }),
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const data = parsed.data;
  const uploadEnabled = req.body.upload_enabled === 'on' ? 1 : 0;
  const galleryEnabled = req.body.gallery_enabled === 'on' ? 1 : 0;
  const publicDownloadEnabled = req.body.public_download_enabled === 'on' ? 1 : 0;
  let galleryPinHash = req.event.gallery_pin_hash;
  if (req.body.clear_pin === 'on') galleryPinHash = null;
  if (data.gallery_pin) {
    if (!/^\d{4,12}$/.test(data.gallery_pin)) {
      setFlash(res, 'error', 'Gallery PIN must be 4 to 12 digits.');
      return res.redirect(`/dashboard/events/${req.event.id}`);
    }
    galleryPinHash = await bcrypt.hash(data.gallery_pin, 12);
  }

  db.prepare(`
    UPDATE events SET
      title = ?, bride_name = ?, groom_name = ?, wedding_date = ?, venue = ?, city = ?,
      upload_enabled = ?, gallery_enabled = ?, public_download_enabled = ?, gallery_pin_hash = ?, updated_at = ?
    WHERE id = ? AND owner_id = ?
  `).run(
    data.title,
    data.bride_name || null,
    data.groom_name || null,
    data.wedding_date || null,
    data.venue || null,
    data.city || null,
    uploadEnabled,
    galleryEnabled,
    publicDownloadEnabled,
    galleryPinHash,
    nowIso(),
    req.event.id,
    req.user.id
  );

  logAudit({ actorUserId: req.user.id, eventId: req.event.id, action: 'event_settings_update', ip: req.ip });
  setFlash(res, 'success', 'Event settings updated.');
  return res.redirect(`/dashboard/events/${req.event.id}`);
}));

dashboardRouter.post('/dashboard/events/:eventId/folders', requireEventOwner(), requireCsrf, (req, res) => {
  const parsed = folderSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(res, 'error', parsed.error.flatten().fieldErrors.name?.[0] || 'Invalid folder name.');
    return res.redirect(`/dashboard/events/${req.event.id}`);
  }
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM folders WHERE event_id = ?').get(req.event.id);
  try {
    db.prepare('INSERT INTO folders (event_id, name, sort_order) VALUES (?, ?, ?)').run(req.event.id, parsed.data.name, Number(maxSort.maxSort || 0) + 1);
    setFlash(res, 'success', 'Folder added.');
  } catch {
    setFlash(res, 'error', 'This folder already exists.');
  }
  return res.redirect(`/dashboard/events/${req.event.id}`);
});

dashboardRouter.post('/dashboard/events/:eventId/folders/:folderId/delete', requireEventOwner(), requireCsrf, (req, res) => {
  const folderId = Number(req.params.folderId);
  const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND event_id = ?').get(folderId, req.event.id);
  if (!folder) {
    setFlash(res, 'error', 'Folder not found.');
    return res.redirect(`/dashboard/events/${req.event.id}`);
  }
  const count = db.prepare('SELECT COUNT(*) AS count FROM media WHERE folder_id = ?').get(folderId).count;
  if (count > 0) {
    setFlash(res, 'error', 'Folder has media. Delete/move media first.');
    return res.redirect(`/dashboard/events/${req.event.id}`);
  }
  db.prepare('DELETE FROM folders WHERE id = ? AND event_id = ?').run(folderId, req.event.id);
  setFlash(res, 'success', 'Folder deleted.');
  return res.redirect(`/dashboard/events/${req.event.id}`);
});

dashboardRouter.get('/dashboard/events/:eventId/media', requireEventOwner(), (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'all'].includes(req.query.status) ? req.query.status : 'pending';
  const folderId = req.query.folder ? Number(req.query.folder) : null;
  const folders = listFolders(req.event.id);
  const conditions = ['m.event_id = ?'];
  const params = [req.event.id];
  if (status !== 'all') {
    conditions.push('m.status = ?');
    params.push(status);
  }
  if (folderId && folders.some((f) => f.id === folderId)) {
    conditions.push('m.folder_id = ?');
    params.push(folderId);
  }
  const media = db.prepare(`
    SELECT m.*, f.name AS folder_name
    FROM media m
    JOIN folders f ON f.id = m.folder_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY m.created_at DESC
    LIMIT 500
  `).all(...params);

  res.render('dashboard/media', {
    title: `${req.event.title} Media`,
    event: req.event,
    media,
    folders,
    status,
    folderId,
    stats: eventStats(req.event),
  });
});

async function mutateMediaStatus(req, res, action, mediaId) {
  const media = db.prepare('SELECT * FROM media WHERE id = ? AND event_id = ?').get(mediaId, req.event.id);
  if (!media) {
    setFlash(res, 'error', 'Media not found.');
    return res.redirect(`/dashboard/events/${req.event.id}/media`);
  }

  if (action === 'delete') {
    await deleteMediaFileAndRow(media, req.user.id, req);
    setFlash(res, 'success', 'Media deleted.');
  } else if (action === 'approve') {
    db.prepare("UPDATE media SET status = 'approved', approved_at = ?, rejected_at = NULL WHERE id = ? AND event_id = ?").run(nowIso(), mediaId, req.event.id);
    logAudit({ actorUserId: req.user.id, eventId: req.event.id, action: 'media_approve', metadata: { mediaId }, ip: req.ip });
    setFlash(res, 'success', 'Media approved.');
  } else if (action === 'reject') {
    db.prepare("UPDATE media SET status = 'rejected', rejected_at = ?, approved_at = NULL WHERE id = ? AND event_id = ?").run(nowIso(), mediaId, req.event.id);
    logAudit({ actorUserId: req.user.id, eventId: req.event.id, action: 'media_reject', metadata: { mediaId }, ip: req.ip });
    setFlash(res, 'success', 'Media rejected.');
  }
  const back = req.get('referer')?.includes(`/dashboard/events/${req.event.id}`) ? req.get('referer') : `/dashboard/events/${req.event.id}/media`;
  return res.redirect(back);
}

dashboardRouter.post('/dashboard/events/:eventId/media/:mediaId/approve', requireEventOwner(), requireCsrf, asyncHandler((req, res) => mutateMediaStatus(req, res, 'approve', req.params.mediaId)));
dashboardRouter.post('/dashboard/events/:eventId/media/:mediaId/reject', requireEventOwner(), requireCsrf, asyncHandler((req, res) => mutateMediaStatus(req, res, 'reject', req.params.mediaId)));
dashboardRouter.post('/dashboard/events/:eventId/media/:mediaId/delete', requireEventOwner(), requireCsrf, asyncHandler((req, res) => mutateMediaStatus(req, res, 'delete', req.params.mediaId)));

dashboardRouter.post('/dashboard/events/:eventId/media/bulk', requireEventOwner(), requireCsrf, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.media_ids) ? req.body.media_ids : req.body.media_ids ? [req.body.media_ids] : [];
  const action = req.body.action;
  if (!['approve', 'reject', 'delete'].includes(action) || ids.length === 0) {
    setFlash(res, 'error', 'Select media and a valid action.');
    return res.redirect(`/dashboard/events/${req.event.id}/media`);
  }

  let done = 0;
  for (const id of ids.slice(0, 200)) {
    const media = db.prepare('SELECT * FROM media WHERE id = ? AND event_id = ?').get(id, req.event.id);
    if (!media) continue;
    if (action === 'delete') await deleteMediaFileAndRow(media, req.user.id, req);
    if (action === 'approve') db.prepare("UPDATE media SET status = 'approved', approved_at = ?, rejected_at = NULL WHERE id = ? AND event_id = ?").run(nowIso(), id, req.event.id);
    if (action === 'reject') db.prepare("UPDATE media SET status = 'rejected', rejected_at = ?, approved_at = NULL WHERE id = ? AND event_id = ?").run(nowIso(), id, req.event.id);
    done += 1;
  }
  logAudit({ actorUserId: req.user.id, eventId: req.event.id, action: `media_bulk_${action}`, metadata: { count: done }, ip: req.ip });
  setFlash(res, 'success', `${done} item(s) processed.`);
  return res.redirect(`/dashboard/events/${req.event.id}/media?status=${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'all'}`);
}));

dashboardRouter.get('/dashboard/media/:mediaId/file', (req, res) => {
  const media = db.prepare(`
    SELECT m.* FROM media m
    JOIN events e ON e.id = m.event_id
    WHERE m.id = ? AND e.owner_id = ?
  `).get(req.params.mediaId, req.user.id);
  if (!media) return res.status(404).render('error', { title: 'Not found', message: 'Media not found.' });
  return sendMediaFile(res, media, { private: true });
});

dashboardRouter.get('/dashboard/media/:mediaId/thumbnail', (req, res) => {
  const media = db.prepare(`
    SELECT m.* FROM media m
    JOIN events e ON e.id = m.event_id
    WHERE m.id = ? AND e.owner_id = ?
  `).get(req.params.mediaId, req.user.id);
  if (!media) return res.status(404).render('error', { title: 'Not found', message: 'Media not found.' });
  return sendMediaThumbnail(res, media, { private: true });
});

dashboardRouter.get('/dashboard/events/:eventId/qr.png', requireEventOwner(), asyncHandler(async (req, res) => {
  res.setHeader('Content-Type', 'image/png');
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${req.event.slug}-upload-qr.png"`);
  }
  return QRCode.toFileStream(res, uploadUrl(req, req.event), { width: 1024, margin: 2, errorCorrectionLevel: 'M' });
}));

dashboardRouter.get('/dashboard/events/:eventId/poster', requireEventOwner(), asyncHandler(async (req, res) => {
  const qrDataUrl = await QRCode.toDataURL(uploadUrl(req, req.event), { width: 900, margin: 2, errorCorrectionLevel: 'M' });
  res.render('dashboard/poster', {
    title: `${req.event.title} QR Poster`,
    layout: false,
    event: req.event,
    uploadLink: uploadUrl(req, req.event),
    qrDataUrl,
  });
}));

dashboardRouter.get('/dashboard/events/:eventId/download.zip', requireEventOwner(), asyncHandler(async (req, res, next) => {
  const status = ['pending', 'approved', 'rejected', 'all'].includes(req.query.status) ? req.query.status : 'approved';
  const conditions = ['m.event_id = ?'];
  const params = [req.event.id];
  if (status !== 'all') {
    conditions.push('m.status = ?');
    params.push(status);
  }
  const rows = db.prepare(`
    SELECT m.*, f.name AS folder_name
    FROM media m
    JOIN folders f ON f.id = m.folder_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY f.sort_order ASC, m.created_at ASC
  `).all(...params);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${req.event.slug}-${status}-album.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', next);
  archive.pipe(res);

  const usedNames = new Set();
  for (const row of rows) {
    let name = `${row.folder_name}/${row.original_name}`.replace(/[\\/]+/g, '/');
    if (usedNames.has(name)) name = `${row.folder_name}/${row.id}-${row.original_name}`;
    usedNames.add(name);

    if (s3Client) {
      try {
        const response = await s3Client.send(new GetObjectCommand({
          Bucket: config.s3.bucketName,
          Key: row.storage_path,
        }));
        archive.append(response.Body, { name });
      } catch (err) {
        console.error('Failed to append S3 file to zip:', err);
      }
    } else {
      const abs = resolveStoragePath(row.storage_path);
      archive.file(abs, { name });
    }
  }
  archive.finalize();
  logAudit({ actorUserId: req.user.id, eventId: req.event.id, action: 'album_download', metadata: { status, count: rows.length }, ip: req.ip });
}));

// Small utility endpoint shown in event page for copying absolute links safely.
dashboardRouter.get('/dashboard/events/:eventId/links.json', requireEventOwner(), (req, res) => {
  res.json({
    uploadUrl: uploadUrl(req, req.event),
    galleryUrl: galleryUrl(req, req.event),
    posterUrl: absoluteUrl(req, `/dashboard/events/${req.event.id}/poster`),
  });
});

dashboardRouter.get('/dashboard/security', asyncHandler(async (req, res) => {
  const user = db.prepare('SELECT two_factor_secret, two_factor_enabled FROM users WHERE id = ?').get(req.user.id);
  const twoFactorEnabled = user?.two_factor_enabled === 1;
  let secret = '';
  let qrDataUrl = '';

  if (!twoFactorEnabled) {
    secret = generateSecret();
    const otpauth = getOtpAuthUrl(req.user.email, secret);
    qrDataUrl = await QRCode.toDataURL(otpauth);
  }

  res.render('dashboard/security', {
    title: 'Security Settings',
    twoFactorEnabled,
    secret,
    qrDataUrl,
  });
}));

dashboardRouter.post('/dashboard/security/2fa/enable', requireCsrf, asyncHandler(async (req, res) => {
  const { secret, code } = req.body;
  if (!secret || !code) {
    setFlash(res, 'error', 'Secret and code are required.');
    return res.redirect('/dashboard/security');
  }

  const isValid = verifyTotp(code, secret);
  if (!isValid) {
    setFlash(res, 'error', 'Invalid verification code. Please try scanning again.');
    return res.redirect('/dashboard/security');
  }

  db.prepare('UPDATE users SET two_factor_secret = ?, two_factor_enabled = 1, updated_at = ? WHERE id = ?')
    .run(secret, nowIso(), req.user.id);

  logAudit({ actorUserId: req.user.id, action: '2fa_enabled', ip: req.ip });
  setFlash(res, 'success', 'Two-Factor Authentication (2FA) is now enabled.');
  res.redirect('/dashboard/security');
}));

dashboardRouter.post('/dashboard/security/2fa/disable', requireCsrf, asyncHandler(async (req, res) => {
  db.prepare('UPDATE users SET two_factor_secret = NULL, two_factor_enabled = 0, updated_at = ? WHERE id = ?')
    .run(nowIso(), req.user.id);

  logAudit({ actorUserId: req.user.id, action: '2fa_disabled', ip: req.ip });
  setFlash(res, 'success', 'Two-Factor Authentication (2FA) has been disabled.');
  res.redirect('/dashboard/security');
}));

dashboardRouter.get('/dashboard/events/:eventId/upgrade', requireEventOwner(), asyncHandler(async (req, res) => {
  const plans = db.prepare('SELECT * FROM plans WHERE is_active = 1 ORDER BY price ASC').all();
  const planList = plans.map(p => ({
    name: p.name,
    slug: p.slug,
    price: p.price,
    storageLimitBytes: p.storage_limit_bytes,
    storageLimitHuman: formatBytes(p.storage_limit_bytes),
    photoMaxBytes: p.photo_max_bytes,
    videoMaxBytes: p.video_max_bytes,
    videoEnabled: p.video_enabled === 1,
    zipDownloadEnabled: p.zip_download_enabled === 1,
    pinGalleryEnabled: p.pin_gallery_enabled === 1,
    customBrandingEnabled: p.custom_branding_enabled === 1,
  }));

  res.render('dashboard/upgrade', {
    title: 'Upgrade Album Plan',
    event: req.event,
    plans: planList,
    razorpayKeyId: config.razorpay.keyId,
  });
}));

const orderSchema = z.object({
  planSlug: z.string().trim()
});

dashboardRouter.post('/dashboard/events/:eventId/upgrade/order', requireEventOwner(), requireCsrf, asyncHandler(async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Invalid plan slug.' });
  }

  const { planSlug } = parsed.data;
  const targetPlan = db.prepare('SELECT * FROM plans WHERE slug = ? AND is_active = 1').get(planSlug);
  if (!targetPlan) {
    return res.status(404).json({ ok: false, error: 'Selected plan not found or inactive.' });
  }

  const amountInRupees = targetPlan.price;
  const amountInPaise = amountInRupees * 100;
  const hasRazorpayKeys = config.razorpay.keyId && config.razorpay.keySecret;

  if (!hasRazorpayKeys) {
    return res.json({
      ok: true,
      mock: true,
      amount: amountInRupees,
      planSlug: targetPlan.slug,
      planName: targetPlan.name,
    });
  }

  try {
    const authString = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authString}`,
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `receipt_event_${req.event.id}_${Date.now()}`,
        notes: {
          eventId: req.event.id,
          planSlug: targetPlan.slug,
          userId: req.user.id,
        }
      }),
    });

    const orderData = await response.json();
    if (!response.ok) {
      console.error('Razorpay order creation failed:', orderData);
      return res.status(500).json({ ok: false, error: 'Failed to create order with Razorpay.' });
    }

    db.prepare(`
      INSERT INTO payments (user_id, event_id, plan_name, amount, payment_status, provider, provider_payment_id, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', 'razorpay', ?, ?, ?, ?)
    `).run(
      req.user.id,
      req.event.id,
      targetPlan.name,
      amountInRupees,
      orderData.id,
      `Razorpay Order ID: ${orderData.id}`,
      nowIso(),
      nowIso()
    );

    return res.json({
      ok: true,
      mock: false,
      keyId: config.razorpay.keyId,
      orderId: orderData.id,
      amount: amountInPaise,
      currency: 'INR',
      planName: targetPlan.name,
      user: {
        name: req.user.name,
        email: req.user.email,
      }
    });

  } catch (err) {
    console.error('Razorpay order creation exception:', err);
    return res.status(500).json({ ok: false, error: 'Payment gateway error. Please try again.' });
  }
}));

const verifySchema = z.object({
  mock: z.boolean().optional().default(false),
  planSlug: z.string().trim().optional(),
  razorpay_payment_id: z.string().trim().optional(),
  razorpay_order_id: z.string().trim().optional(),
  razorpay_signature: z.string().trim().optional(),
});

dashboardRouter.post('/dashboard/events/:eventId/upgrade/verify', requireEventOwner(), requireCsrf, asyncHandler(async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Invalid verification parameters.' });
  }

  const { mock, planSlug, razorpay_payment_id, razorpay_order_id, razorpay_signature } = parsed.data;

  if (mock) {
    const hasRazorpayKeys = config.razorpay.keyId && config.razorpay.keySecret;
    if (hasRazorpayKeys) {
      return res.status(400).json({ ok: false, error: 'Mock payments are disabled when payment gateway is active.' });
    }

    const targetPlan = db.prepare('SELECT * FROM plans WHERE slug = ? AND is_active = 1').get(planSlug);
    if (!targetPlan) {
      return res.status(404).json({ ok: false, error: 'Target plan not found.' });
    }

    db.prepare(`
      UPDATE events 
      SET plan = ?, storage_limit_bytes = ?, updated_at = ? 
      WHERE id = ?
    `).run(targetPlan.slug, targetPlan.storage_limit_bytes, nowIso(), req.event.id);

    db.prepare(`
      INSERT INTO payments (user_id, event_id, plan_name, amount, payment_status, provider, provider_payment_id, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'paid', 'mock', ?, '[MOCK MODE] Sandbox simulated plan upgrade.', ?, ?)
    `).run(
      req.user.id,
      req.event.id,
      targetPlan.name,
      targetPlan.price,
      `mock_pay_${crypto.randomBytes(8).toString('hex')}`,
      nowIso(),
      nowIso()
    );

    logAudit({
      actorUserId: req.user.id,
      eventId: req.event.id,
      action: 'event_plan_upgrade_mock',
      metadata: { upgradedTo: targetPlan.slug, limitBytes: targetPlan.storage_limit_bytes },
      ip: req.ip
    });

    setFlash(res, 'success', `Successfully upgraded to ${targetPlan.name} plan!`);
    return res.json({ ok: true });
  }

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ ok: false, error: 'Missing signature verification parameters.' });
  }

  const hmac = crypto.createHmac('sha256', config.razorpay.keySecret);
  hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
  const generatedSignature = hmac.digest('hex');

  if (generatedSignature !== razorpay_signature) {
    db.prepare(`
      UPDATE payments 
      SET payment_status = 'failed', updated_at = ? 
      WHERE event_id = ? AND provider_payment_id = ?
    `).run(nowIso(), req.event.id, razorpay_order_id);

    logAudit({
      actorUserId: req.user.id,
      eventId: req.event.id,
      action: 'event_plan_upgrade_failed_signature',
      metadata: { orderId: razorpay_order_id, paymentId: razorpay_payment_id },
      ip: req.ip
    });

    return res.status(400).json({ ok: false, error: 'Payment signature verification failed. Fraud attempt logged.' });
  }

  const paymentRecord = db.prepare('SELECT * FROM payments WHERE event_id = ? AND provider_payment_id = ? LIMIT 1').get(req.event.id, razorpay_order_id);
  if (!paymentRecord) {
    return res.status(404).json({ ok: false, error: 'Payment record not found for this order.' });
  }

  const targetPlan = db.prepare('SELECT * FROM plans WHERE name = ? AND is_active = 1').get(paymentRecord.plan_name);
  if (!targetPlan) {
    return res.status(404).json({ ok: false, error: 'Target plan not found.' });
  }

  db.prepare(`
    UPDATE events 
    SET plan = ?, storage_limit_bytes = ?, updated_at = ? 
    WHERE id = ?
  `).run(targetPlan.slug, targetPlan.storage_limit_bytes, nowIso(), req.event.id);

  db.prepare(`
    UPDATE payments 
    SET payment_status = 'paid', provider_payment_id = ?, updated_at = ?, notes = ?
    WHERE id = ?
  `).run(
    razorpay_payment_id,
    nowIso(),
    `Razorpay verified payment. Order: ${razorpay_order_id}`,
    paymentRecord.id
  );

  logAudit({
    actorUserId: req.user.id,
    eventId: req.event.id,
    action: 'event_plan_upgrade_success',
    metadata: { upgradedTo: targetPlan.slug, paymentId: razorpay_payment_id, orderId: razorpay_order_id },
    ip: req.ip
  });

  setFlash(res, 'success', `Successfully upgraded to ${targetPlan.name} plan!`);
  return res.json({ ok: true });
}));

const profileUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().email('Valid email is required').max(160).transform((v) => v.toLowerCase()),
  phone_number: z.string().trim().transform(v => v.replace(/[^0-9+]/g, '')).refine(v => {
    if (!v) return true;
    const clean = v.replace(/[^0-9]/g, '');
    return clean.length >= 10 && clean.length <= 15;
  }, 'Phone number must be a valid mobile number with country code (e.g. +91 98765 43210)').optional().or(z.literal(''))
});

dashboardRouter.get('/dashboard/profile', asyncHandler(async (req, res) => {
  const payments = db.prepare(`
    SELECT p.*, e.title AS event_title 
    FROM payments p 
    LEFT JOIN events e ON e.id = p.event_id 
    WHERE p.user_id = ? 
    ORDER BY p.created_at DESC
  `).all(req.user.id);

  res.render('dashboard/profile', {
    title: 'My Profile',
    payments,
    errors: {},
    values: {},
  });
}));

dashboardRouter.post('/dashboard/profile', requireCsrf, asyncHandler(async (req, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  const payments = db.prepare(`
    SELECT p.*, e.title AS event_title 
    FROM payments p 
    LEFT JOIN events e ON e.id = p.event_id 
    WHERE p.user_id = ? 
    ORDER BY p.created_at DESC
  `).all(req.user.id);

  if (!parsed.success) {
    return res.status(400).render('dashboard/profile', {
      title: 'My Profile',
      payments,
      errors: parsed.error.flatten().fieldErrors,
      values: req.body,
    });
  }

  const { name, email, phone_number } = parsed.data;

  // Prevent users who have an active phone number from clearing it (locking themselves out of OTP login).
  if (!phone_number && req.user.phone_number) {
    return res.status(400).render('dashboard/profile', {
      title: 'My Profile',
      payments,
      errors: { phone_number: ['Phone number cannot be removed as it is required for your WhatsApp OTP login.'] },
      values: req.body,
    });
  }

  // Check email conflict
  const emailConflict = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
  if (emailConflict) {
    return res.status(409).render('dashboard/profile', {
      title: 'My Profile',
      payments,
      errors: { email: ['This email is already in use by another account.'] },
      values: req.body,
    });
  }

  // Check phone number conflict
  let cleanPhone = null;
  if (phone_number) {
    cleanPhone = phone_number.replace(/[^0-9]/g, '');
    if (cleanPhone.length === 10 && !cleanPhone.startsWith('91')) {
      cleanPhone = '91' + cleanPhone;
    }
    const phoneConflict = db.prepare('SELECT id FROM users WHERE phone_number = ? AND id != ?').get(cleanPhone, req.user.id);
    if (phoneConflict) {
      return res.status(409).render('dashboard/profile', {
        title: 'My Profile',
        payments,
        errors: { phone_number: ['This phone number is already registered to another account.'] },
        values: req.body,
      });
    }
  }

  // Update details
  db.prepare('UPDATE users SET name = ?, email = ?, phone_number = ?, updated_at = ? WHERE id = ?')
    .run(name, email, cleanPhone, nowIso(), req.user.id);

  // Update session info
  req.user.name = name;
  req.user.email = email;
  req.user.phone_number = cleanPhone;

  logAudit({
    actorUserId: req.user.id,
    action: 'profile_update',
    metadata: { name, email, phone_number: cleanPhone },
    ip: req.ip
  });

  setFlash(res, 'success', 'Profile updated successfully.');
  res.redirect('/dashboard/profile');
}));

dashboardRouter.get('/dashboard/payments/:paymentId/invoice', asyncHandler(async (req, res) => {
  const paymentId = Number(req.params.paymentId);
  if (!Number.isInteger(paymentId)) {
    return res.status(404).render('error', { title: 'Not found', message: 'Invoice not found.' });
  }

  const payment = db.prepare(`
    SELECT p.*, e.title AS event_title 
    FROM payments p 
    LEFT JOIN events e ON e.id = p.event_id 
    WHERE p.id = ? AND p.user_id = ? AND p.payment_status = 'paid'
  `).get(paymentId, req.user.id);

  if (!payment) {
    return res.status(404).render('error', { title: 'Not found', message: 'Invoice not found or unpaid.' });
  }

  const buyer = db.prepare('SELECT id, name, email, phone_number FROM users WHERE id = ?').get(req.user.id);

  res.render('dashboard/invoice', {
    title: `Invoice INV-2026-${String(payment.id).padStart(5, '0')}`,
    layout: false,
    payment,
    buyer,
    eventTitle: payment.event_title,
  });
}));

// Redirect owner to Google Drive authentication consent
dashboardRouter.get('/dashboard/events/:eventId/google-drive/auth', requireEventOwner(), asyncHandler(async (req, res) => {
  const hasGoogleKeys = config.google.clientId && config.google.clientSecret;
  
  if (!hasGoogleKeys) {
    // Sandbox simulated connection fallback
    const configData = { mock: true, connected_at: nowIso() };
    db.prepare("UPDATE events SET storage_provider = 'google_drive', storage_config = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(configData), nowIso(), req.event.id);

    logAudit({
      actorUserId: req.user.id,
      eventId: req.event.id,
      action: 'event_google_drive_connect_mock',
      ip: req.ip
    });

    setFlash(res, 'success', 'Connected successfully to Google Drive Sandbox Simulator.');
    return res.redirect(`/dashboard/events/${req.event.id}`);
  }

  const redirectUri = absoluteUrl(req, '/dashboard/google-drive/callback');
  const authUrl = getAuthUrl(req.event.id, redirectUri);
  return res.redirect(authUrl);
}));

// Google OAuth redirect callback handler
dashboardRouter.get('/dashboard/google-drive/callback', asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  
  if (error) {
    setFlash(res, 'error', `Google access denied: ${error}`);
    return res.redirect('/dashboard');
  }

  if (!code || !state) {
    setFlash(res, 'error', 'Invalid Google callback request parameters.');
    return res.redirect('/dashboard');
  }

  const eventId = Number(state);
  if (!Number.isInteger(eventId)) {
    setFlash(res, 'error', 'Invalid callback state data.');
    return res.redirect('/dashboard');
  }

  // Ensure logged-in user owns the event in state
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND owner_id = ?').get(eventId, req.user.id);
  if (!event) {
    setFlash(res, 'error', 'Authorization failed. Album event not found or unauthorized.');
    return res.redirect('/dashboard');
  }

  try {
    const redirectUri = absoluteUrl(req, '/dashboard/google-drive/callback');
    const tokens = await getTokens(code, redirectUri);

    const expiresAt = Date.now() + (tokens.expires_in * 1000);
    const configData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      connected_at: nowIso()
    };

    db.prepare("UPDATE events SET storage_provider = 'google_drive', storage_config = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(configData), nowIso(), event.id);

    logAudit({
      actorUserId: req.user.id,
      eventId: event.id,
      action: 'event_google_drive_connect',
      ip: req.ip
    });

    setFlash(res, 'success', 'Successfully connected your Google Drive account! Guest uploads will be saved to your Drive.');
  } catch (err) {
    console.error('Google OAuth token exchange failed:', err);
    setFlash(res, 'error', `Google Drive connection failed: ${err.message}`);
  }

  return res.redirect(`/dashboard/events/${eventId}`);
}));

// Disconnect Google Drive integration
dashboardRouter.post('/dashboard/events/:eventId/google-drive/disconnect', requireEventOwner(), requireCsrf, asyncHandler(async (req, res) => {
  db.prepare("UPDATE events SET storage_provider = 'platform', storage_config = NULL, updated_at = ? WHERE id = ?")
    .run(nowIso(), req.event.id);

  logAudit({
    actorUserId: req.user.id,
    eventId: req.event.id,
    action: 'event_google_drive_disconnect',
    ip: req.ip
  });

  setFlash(res, 'success', 'Google Drive storage disconnected. Reverted to default platform storage.');
  return res.redirect(`/dashboard/events/${req.event.id}`);
}));
