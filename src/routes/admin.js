import express from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { db, getGlobalStorageUsage, getStorageUsage, globalMediaCounts, logAudit, mediaCounts, nowIso, getPlan, listPlans, getSetting, getSettingBool } from '../db.js';
import { requireCsrf } from '../middleware/csrf.js';
import { requireSuperAdmin } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { asyncHandler } from '../lib/async-handler.js';
import { deleteMediaFileAndRow, sendMediaFile, sendMediaThumbnail } from '../lib/storage.js';
import { absoluteUrl, formatBytes, galleryUrl, percent, planLabel, randomToken, uploadUrl } from '../lib/helpers.js';
import { whatsappService } from '../lib/whatsapp.js';

export const adminRouter = express.Router();

adminRouter.use('/admin', requireSuperAdmin);

async function totals() {
  const userCount = (await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count;
  const ownerCount = (await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'").get()).count;
  const superAdminCount = (await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin'").get()).count;
  const suspendedUsers = (await db.prepare("SELECT COUNT(*) AS count FROM users WHERE status = 'suspended'").get()).count;
  const eventCount = (await db.prepare('SELECT COUNT(*) AS count FROM events').get()).count;
  const openUploads = (await db.prepare('SELECT COUNT(*) AS count FROM events WHERE upload_enabled = 1').get()).count;
  const paymentRevenue = (await db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_status = 'paid'").get()).total;

  const plansBreakdown = await db.prepare(`
    SELECT plan_name, COUNT(*) AS count, SUM(amount) AS revenue 
    FROM payments 
    WHERE payment_status = 'paid' 
    GROUP BY plan_name
  `).all();

  const eventPlansBreakdown = await db.prepare(`
    SELECT plan, COUNT(*) AS count 
    FROM events 
    GROUP BY plan
  `).all();

  return {
    userCount,
    ownerCount,
    superAdminCount,
    suspendedUsers,
    eventCount,
    openUploads,
    media: await globalMediaCounts(),
    storageUsed: await getGlobalStorageUsage(),
    storageUsedHuman: formatBytes(await getGlobalStorageUsage()),
    paymentRevenue,
    plansBreakdown,
    eventPlansBreakdown,
  };
}

async function eventStats(eventId) {
  const used = await getStorageUsage(eventId);
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  return {
    used,
    usedHuman: formatBytes(used),
    limitHuman: formatBytes(event?.storage_limit_bytes || 0),
    percent: percent(used, event?.storage_limit_bytes || 0),
    counts: await mediaCounts(eventId),
  };
}

async function listFolders(eventId) {
  return await db.prepare('SELECT * FROM folders WHERE event_id = ? ORDER BY sort_order ASC, id ASC').all(eventId);
}

async function getAdminEvent(eventId) {
  return await db.prepare(`
    SELECT e.*, u.name AS owner_name, u.email AS owner_email, u.status AS owner_status, u.role AS owner_role
    FROM events e
    JOIN users u ON u.id = e.owner_id
    WHERE e.id = ?
  `).get(eventId);
}

async function requireAdminEvent(req, res, next) {
  const eventId = Number(req.params.eventId);
  if (!Number.isInteger(eventId)) return res.status(404).render('error', { title: 'Not found', message: 'Event not found.' });
  const event = await getAdminEvent(eventId);
  if (!event) return res.status(404).render('error', { title: 'Not found', message: 'Event not found.' });
  req.adminEvent = event;
  res.locals.adminEvent = event;
  return next();
}

adminRouter.get('/admin', async (req, res) => {
  const stats = await totals();
  const recentUsers = await db.prepare(`
    SELECT id, name, email, role, status, created_at, last_login_at
    FROM users
    ORDER BY created_at DESC
    LIMIT 6
  `).all();
  const recentEvents = await db.prepare(`
    SELECT e.*, u.name AS owner_name, u.email AS owner_email,
      COUNT(m.id) AS media_count,
      COALESCE(SUM(m.size_bytes), 0) AS storage_used
    FROM events e
    JOIN users u ON u.id = e.owner_id
    LEFT JOIN media m ON m.event_id = e.id
    GROUP BY e.id
    ORDER BY e.created_at DESC
    LIMIT 6
  `).all();
  const recentAudit = await db.prepare(`
    SELECT a.*, u.name AS actor_name, e.title AS event_title
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN events e ON e.id = a.event_id
    ORDER BY a.created_at DESC
    LIMIT 8
  `).all();
  res.render('admin/index', { title: 'Super Admin', stats, recentUsers, recentEvents, recentAudit });
});

adminRouter.get('/admin/users', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const role = ['owner', 'super_admin', 'all'].includes(req.query.role) ? req.query.role : 'all';
  const status = ['active', 'suspended', 'all'].includes(req.query.status) ? req.query.status : 'all';
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(u.name LIKE ? OR u.email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (role !== 'all') {
    conditions.push('u.role = ?');
    params.push(role);
  }
  if (status !== 'all') {
    conditions.push('u.status = ?');
    params.push(status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const users = await db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.status, u.created_at, u.updated_at, u.last_login_at,
      COUNT(DISTINCT e.id) AS event_count,
      COUNT(m.id) AS media_count,
      COALESCE(SUM(m.size_bytes), 0) AS storage_used
    FROM users u
    LEFT JOIN events e ON e.owner_id = u.id
    LEFT JOIN media m ON m.event_id = e.id
    ${where}
    GROUP BY u.id
    ORDER BY u.created_at DESC
    LIMIT 250
  `).all(...params);

  res.render('admin/users', { title: 'Manage Users', users, filters: { q, role, status } });
});

adminRouter.get('/admin/users/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  const user = await db.prepare('SELECT id, name, email, phone_number, google_id, role, status, created_at, updated_at, last_login_at, suspended_at FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });

  const events = await db.prepare(`
    SELECT e.*,
      COUNT(m.id) AS media_count,
      COALESCE(SUM(m.size_bytes), 0) AS storage_used,
      SUM(CASE WHEN m.status = 'pending' THEN 1 ELSE 0 END) AS pending_count
    FROM events e
    LEFT JOIN media m ON m.event_id = e.id
    WHERE e.owner_id = ?
    GROUP BY e.id
    ORDER BY e.created_at DESC
  `).all(user.id);

  const payments = await db.prepare(`
    SELECT p.*, e.title AS event_title
    FROM payments p
    LEFT JOIN events e ON e.id = p.event_id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
    LIMIT 20
  `).all(user.id);

  const storageUsed = events.reduce((sum, event) => sum + Number(event.storage_used || 0), 0);
  res.render('admin/user-detail', { title: user.name, user, events, payments, storageUsed, plans: await listPlans() });
});

const userEditSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(100),
  email: z.string().trim().email('Valid email is required').max(160).transform((v) => v.toLowerCase()),
  phone_number: z.string().trim().max(30).optional().nullable().transform((v) => v ? v : null),
  role: z.enum(['owner', 'super_admin']),
  status: z.enum(['active', 'suspended']),
});

adminRouter.post('/admin/users/:userId/edit', requireCsrf, async (req, res) => {
  const userId = Number(req.params.userId);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });

  const parsed = userEditSchema.safeParse(req.body);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const errorMsg = Object.values(errors).flat().join(', ');
    setFlash(res, 'error', `Validation failed: ${errorMsg}`);
    return res.redirect(`/admin/users/${user.id}`);
  }

  const { name, email, phone_number, role, status } = parsed.data;

  // Safety checks for self-editing
  if (user.id === req.user.id) {
    if (role !== 'super_admin') {
      setFlash(res, 'error', 'You cannot demote your own super admin account.');
      return res.redirect(`/admin/users/${user.id}`);
    }
    if (status !== 'active') {
      setFlash(res, 'error', 'You cannot suspend your own super admin account.');
      return res.redirect(`/admin/users/${user.id}`);
    }
  }

  // Check unique email
  const existingEmail = await db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, user.id);
  if (existingEmail) {
    setFlash(res, 'error', 'This email is already in use by another account.');
    return res.redirect(`/admin/users/${user.id}`);
  }

  // Check unique phone number
  if (phone_number) {
    const existingPhone = await db.prepare('SELECT id FROM users WHERE phone_number = ? AND id != ?').get(phone_number, user.id);
    if (existingPhone) {
      setFlash(res, 'error', 'This phone number is already in use by another account.');
      return res.redirect(`/admin/users/${user.id}`);
    }
  }

  const isSuspending = user.status === 'active' && status === 'suspended';
  const isActivating = user.status === 'suspended' && status === 'active';

  await db.prepare(`
    UPDATE users 
    SET name = ?, email = ?, phone_number = ?, role = ?, status = ?, 
        suspended_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name, 
    email, 
    phone_number, 
    role, 
    status,
    isSuspending ? nowIso() : (isActivating ? null : user.suspended_at),
    nowIso(),
    user.id
  );

  await logAudit({
    actorUserId: req.user.id,
    action: 'super_admin_user_edit',
    metadata: { userId: user.id, name, email, phone_number, role, status },
    ip: req.ip
  });

  setFlash(res, 'success', 'User details updated successfully.');
  return res.redirect(`/admin/users/${user.id}`);
});

adminRouter.post('/admin/users/:userId/delete', requireCsrf, asyncHandler(async (req, res) => {
  const userId = Number(req.params.userId);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });

  if (user.id === req.user.id) {
    setFlash(res, 'error', 'You cannot delete your own active super admin account.');
    return res.redirect(`/admin/users/${user.id}`);
  }

  const confirmation = String(req.body.confirmation || '').trim();
  if (confirmation.toLowerCase() !== user.email.toLowerCase()) {
    setFlash(res, 'error', `Type the user's email address "${user.email}" to confirm deletion.`);
    return res.redirect(`/admin/users/${user.id}`);
  }

  // Deleting user's wedding media assets from Google Drive / S3 / local disk
  const userEvents = await db.prepare('SELECT * FROM events WHERE owner_id = ?').all(user.id);
  let deletedMediaCount = 0;
  for (const event of userEvents) {
    const mediaRows = await db.prepare('SELECT * FROM media WHERE event_id = ?').all(event.id);
    for (const media of mediaRows) {
      await deleteMediaFileAndRow(media, req.user.id, req);
      deletedMediaCount++;
    }
    // Delete event row (the cascade will handle folders, payments, and audit logs)
    await db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
  }

  // Delete the user
  await db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

  await logAudit({
    actorUserId: req.user.id,
    action: 'super_admin_user_delete',
    metadata: { userId: user.id, email: user.email, name: user.name, eventsDeleted: userEvents.length, mediaDeleted: deletedMediaCount },
    ip: req.ip
  });

  setFlash(res, 'success', `User ${user.email} and all associated data permanently deleted.`);
  return res.redirect('/admin/users');
}));

adminRouter.post('/admin/events/:eventId/plan', requireAdminEvent, requireCsrf, async (req, res) => {
  const planSlug = String(req.body.plan || '').trim();
  const plan = await getPlan(planSlug);
  if (!plan) {
    setFlash(res, 'error', 'Invalid plan selected.');
    return res.redirect(req.get('referer') || `/admin/events/${req.adminEvent.id}`);
  }
  const used = await getStorageUsage(req.adminEvent.id);
  const storageLimit = Math.max(plan.storageLimitBytes, used);
  
  await db.prepare(`
    UPDATE events SET plan = ?, storage_limit_bytes = ?, updated_at = ?
    WHERE id = ?
  `).run(planSlug, storageLimit, nowIso(), req.adminEvent.id);

  await logAudit({
    actorUserId: req.user.id,
    eventId: req.adminEvent.id,
    action: 'super_admin_event_plan_update',
    metadata: { plan: planSlug, storageLimit },
    ip: req.ip
  });

  setFlash(res, 'success', `Plan updated to ${plan.label} successfully.`);
  return res.redirect(req.get('referer') || `/admin/events/${req.adminEvent.id}`);
});


adminRouter.get('/admin/events', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const plan = ['basic', 'premium', 'royal', 'all'].includes(req.query.plan) ? req.query.plan : 'all';
  const upload = ['open', 'closed', 'all'].includes(req.query.upload) ? req.query.upload : 'all';
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(e.title LIKE ? OR e.slug LIKE ? OR e.city LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (plan !== 'all') {
    conditions.push('e.plan = ?');
    params.push(plan);
  }
  if (upload !== 'all') {
    conditions.push('e.upload_enabled = ?');
    params.push(upload === 'open' ? 1 : 0);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const events = await db.prepare(`
    SELECT e.*, u.name AS owner_name, u.email AS owner_email, u.status AS owner_status,
      COUNT(m.id) AS media_count,
      COALESCE(SUM(m.size_bytes), 0) AS storage_used,
      SUM(CASE WHEN m.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN m.status = 'approved' THEN 1 ELSE 0 END) AS approved_count
    FROM events e
    JOIN users u ON u.id = e.owner_id
    LEFT JOIN media m ON m.event_id = e.id
    ${where}
    GROUP BY e.id
    ORDER BY e.created_at DESC
    LIMIT 300
  `).all(...params);
  res.render('admin/events', { title: 'Manage Events', events, filters: { q, plan, upload }, plans: await listPlans() });
});

adminRouter.get('/admin/events/:eventId', requireAdminEvent, asyncHandler(async (req, res) => {
  const event = req.adminEvent;
  const stats = await eventStats(event.id);
  const folders = await listFolders(event.id);
  const recentMedia = await db.prepare(`
    SELECT m.*, f.name AS folder_name
    FROM media m
    JOIN folders f ON f.id = m.folder_id
    WHERE m.event_id = ?
    ORDER BY m.created_at DESC
    LIMIT 12
  `).all(event.id);
  const payments = await db.prepare('SELECT * FROM payments WHERE event_id = ? ORDER BY created_at DESC LIMIT 10').all(event.id);
  const qrDataUrl = await QRCode.toDataURL(uploadUrl(req, event), { width: 420, margin: 2, errorCorrectionLevel: 'M' });
  res.render('admin/event-detail', {
    title: event.title,
    event,
    stats,
    folders,
    recentMedia,
    payments,
    plans: await listPlans(),
    uploadLink: uploadUrl(req, event),
    galleryLink: galleryUrl(req, event),
    qrDataUrl,
  });
}));

const adminEventSettingsSchema = z.object({
  plan: z.string().min(1).max(50),
  storage_limit_mb: z.coerce.number().min(1).max(102400).optional(),
});

adminRouter.post('/admin/events/:eventId/settings', requireAdminEvent, requireCsrf, async (req, res) => {
  const parsed = adminEventSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(res, 'error', 'Invalid plan or storage limit.');
    return res.redirect(`/admin/events/${req.adminEvent.id}`);
  }
  const used = await getStorageUsage(req.adminEvent.id);
  const plan = await getPlan(parsed.data.plan);
  const customLimit = parsed.data.storage_limit_mb ? parsed.data.storage_limit_mb * 1024 * 1024 : plan.storageLimitBytes;
  const storageLimit = Math.max(customLimit, used);
  const uploadEnabled = req.body.upload_enabled === 'on' ? 1 : 0;
  const galleryEnabled = req.body.gallery_enabled === 'on' ? 1 : 0;
  const publicDownloadEnabled = req.body.public_download_enabled === 'on' ? 1 : 0;

  await db.prepare(`
    UPDATE events SET plan = ?, storage_limit_bytes = ?, upload_enabled = ?, gallery_enabled = ?, public_download_enabled = ?, updated_at = ?
    WHERE id = ?
  `).run(parsed.data.plan, storageLimit, uploadEnabled, galleryEnabled, publicDownloadEnabled, nowIso(), req.adminEvent.id);

  await logAudit({ actorUserId: req.user.id, eventId: req.adminEvent.id, action: 'super_admin_event_settings_update', metadata: { plan: parsed.data.plan, storageLimit, uploadEnabled, galleryEnabled, publicDownloadEnabled }, ip: req.ip });
  setFlash(res, 'success', 'Event settings updated by super admin.');
  return res.redirect(`/admin/events/${req.adminEvent.id}`);
});

adminRouter.post('/admin/events/:eventId/regenerate-token', requireAdminEvent, requireCsrf, async (req, res) => {
  const token = randomToken(24);
  await db.prepare('UPDATE events SET upload_token = ?, updated_at = ? WHERE id = ?').run(token, nowIso(), req.adminEvent.id);
  await logAudit({ actorUserId: req.user.id, eventId: req.adminEvent.id, action: 'super_admin_upload_token_regenerate', ip: req.ip });
  setFlash(res, 'success', 'Upload QR token regenerated. Old QR links will stop working.');
  return res.redirect(`/admin/events/${req.adminEvent.id}`);
});

adminRouter.post('/admin/events/:eventId/delete', requireAdminEvent, requireCsrf, asyncHandler(async (req, res) => {
  const confirmation = String(req.body.confirmation || '').trim();
  if (confirmation !== req.adminEvent.slug) {
    setFlash(res, 'error', `Type the event slug "${req.adminEvent.slug}" to delete.`);
    return res.redirect(`/admin/events/${req.adminEvent.id}`);
  }
  const mediaRows = await db.prepare('SELECT * FROM media WHERE event_id = ?').all(req.adminEvent.id);
  for (const row of mediaRows) {
    await deleteMediaFileAndRow(row, req.user.id, req);
  }
  await db.prepare('DELETE FROM events WHERE id = ?').run(req.adminEvent.id);
  await logAudit({ actorUserId: req.user.id, action: 'super_admin_event_delete', metadata: { eventId: req.adminEvent.id, slug: req.adminEvent.slug }, ip: req.ip });
  setFlash(res, 'success', 'Event and its media were permanently deleted.');
  return res.redirect('/admin/events');
}));

adminRouter.get('/admin/events/:eventId/media', requireAdminEvent, async (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'all'].includes(req.query.status) ? req.query.status : 'pending';
  const folderId = req.query.folder ? Number(req.query.folder) : null;
  const folders = await listFolders(req.adminEvent.id);
  const conditions = ['m.event_id = ?'];
  const params = [req.adminEvent.id];
  if (status !== 'all') {
    conditions.push('m.status = ?');
    params.push(status);
  }
  if (folderId && folders.some((folder) => folder.id === folderId)) {
    conditions.push('m.folder_id = ?');
    params.push(folderId);
  }
  const media = await db.prepare(`
    SELECT m.*, f.name AS folder_name
    FROM media m
    JOIN folders f ON f.id = m.folder_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY m.created_at DESC
    LIMIT 500
  `).all(...params);
  res.render('admin/media', { title: `${req.adminEvent.title} Media`, event: req.adminEvent, stats: await eventStats(req.adminEvent.id), folders, media, status, folderId });
});

async function mutateMediaStatus(req, res, action, mediaId) {
  const media = await db.prepare('SELECT * FROM media WHERE id = ? AND event_id = ?').get(mediaId, req.adminEvent.id);
  if (!media) {
    setFlash(res, 'error', 'Media not found.');
    return res.redirect(`/admin/events/${req.adminEvent.id}/media`);
  }
  if (action === 'delete') {
    await deleteMediaFileAndRow(media, req.user.id, req);
    setFlash(res, 'success', 'Media deleted.');
  } else if (action === 'approve') {
    await db.prepare("UPDATE media SET status = 'approved', approved_at = ?, rejected_at = NULL WHERE id = ? AND event_id = ?").run(nowIso(), mediaId, req.adminEvent.id);
    await logAudit({ actorUserId: req.user.id, eventId: req.adminEvent.id, action: 'super_admin_media_approve', metadata: { mediaId }, ip: req.ip });
    setFlash(res, 'success', 'Media approved.');
  } else if (action === 'reject') {
    await db.prepare("UPDATE media SET status = 'rejected', rejected_at = ?, approved_at = NULL WHERE id = ? AND event_id = ?").run(nowIso(), mediaId, req.adminEvent.id);
    await logAudit({ actorUserId: req.user.id, eventId: req.adminEvent.id, action: 'super_admin_media_reject', metadata: { mediaId }, ip: req.ip });
    setFlash(res, 'success', 'Media rejected.');
  }
  const back = req.get('referer')?.includes(`/admin/events/${req.adminEvent.id}`) ? req.get('referer') : `/admin/events/${req.adminEvent.id}/media`;
  return res.redirect(back);
}

adminRouter.post('/admin/events/:eventId/media/:mediaId/approve', requireAdminEvent, requireCsrf, asyncHandler((req, res) => mutateMediaStatus(req, res, 'approve', req.params.mediaId)));
adminRouter.post('/admin/events/:eventId/media/:mediaId/reject', requireAdminEvent, requireCsrf, asyncHandler((req, res) => mutateMediaStatus(req, res, 'reject', req.params.mediaId)));
adminRouter.post('/admin/events/:eventId/media/:mediaId/delete', requireAdminEvent, requireCsrf, asyncHandler((req, res) => mutateMediaStatus(req, res, 'delete', req.params.mediaId)));

adminRouter.post('/admin/events/:eventId/media/bulk', requireAdminEvent, requireCsrf, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.media_ids) ? req.body.media_ids : req.body.media_ids ? [req.body.media_ids] : [];
  const action = req.body.action;
  if (!['approve', 'reject', 'delete'].includes(action) || ids.length === 0) {
    setFlash(res, 'error', 'Select media and a valid action.');
    return res.redirect(`/admin/events/${req.adminEvent.id}/media`);
  }
  let done = 0;
  for (const id of ids.slice(0, 300)) {
    const media = await db.prepare('SELECT * FROM media WHERE id = ? AND event_id = ?').get(id, req.adminEvent.id);
    if (!media) continue;
    if (action === 'delete') await deleteMediaFileAndRow(media, req.user.id, req);
    if (action === 'approve') await db.prepare("UPDATE media SET status = 'approved', approved_at = ?, rejected_at = NULL WHERE id = ? AND event_id = ?").run(nowIso(), id, req.adminEvent.id);
    if (action === 'reject') await db.prepare("UPDATE media SET status = 'rejected', rejected_at = ?, approved_at = NULL WHERE id = ? AND event_id = ?").run(nowIso(), id, req.adminEvent.id);
    done += 1;
  }
  await logAudit({ actorUserId: req.user.id, eventId: req.adminEvent.id, action: `super_admin_media_bulk_${action}`, metadata: { count: done }, ip: req.ip });
  setFlash(res, 'success', `${done} item(s) processed.`);
  return res.redirect(`/admin/events/${req.adminEvent.id}/media?status=${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'all'}`);
}));

adminRouter.get('/admin/media/:mediaId/file', asyncHandler(async (req, res) => {
  const media = await db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.mediaId);
  if (!media) return res.status(404).render('error', { title: 'Not found', message: 'Media not found.' });
  return await sendMediaFile(res, media, { private: true });
}));

adminRouter.get('/admin/media/:mediaId/thumbnail', asyncHandler(async (req, res) => {
  const media = await db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.mediaId);
  if (!media) return res.status(404).render('error', { title: 'Not found', message: 'Media not found.' });
  return await sendMediaThumbnail(res, media, { private: true });
}));

adminRouter.get('/admin/audit', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(a.action LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR e.title LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const logs = await db.prepare(`
    SELECT a.*, u.name AS actor_name, u.email AS actor_email, e.title AS event_title
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN events e ON e.id = a.event_id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT 500
  `).all(...params);
  res.render('admin/audit', { title: 'Audit Logs', logs, filters: { q } });
});

adminRouter.get('/admin/payments', async (req, res) => {
  const payments = await db.prepare(`
    SELECT p.*, u.name AS user_name, u.email AS user_email, e.title AS event_title
    FROM payments p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN events e ON e.id = p.event_id
    ORDER BY p.created_at DESC
    LIMIT 300
  `).all();
  const users = await db.prepare("SELECT id, name, email FROM users WHERE status = 'active' ORDER BY name ASC").all();
  const events = await db.prepare('SELECT id, title FROM events ORDER BY created_at DESC LIMIT 300').all();
  const revenue = (await db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_status = 'paid'").get()).total;
  res.render('admin/payments', { title: 'Payments', payments, users, events, revenue });
});

const paymentSchema = z.object({
  user_id: z.coerce.number().int().positive().optional(),
  event_id: z.coerce.number().int().positive().optional(),
  plan_name: z.string().trim().min(2).max(40),
  amount: z.coerce.number().int().min(0).max(10000000),
  payment_status: z.enum(['pending', 'paid', 'failed', 'refunded']).default('paid'),
  provider: z.string().trim().max(40).optional().default('manual'),
  provider_payment_id: z.string().trim().max(100).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
});

adminRouter.post('/admin/payments', requireCsrf, async (req, res) => {
  const parsed = paymentSchema.safeParse({
    ...req.body,
    user_id: req.body.user_id || undefined,
    event_id: req.body.event_id || undefined,
  });
  if (!parsed.success) {
    setFlash(res, 'error', 'Invalid payment details.');
    return res.redirect('/admin/payments');
  }
  const data = parsed.data;
  await db.prepare(`
    INSERT INTO payments (user_id, event_id, plan_name, amount, payment_status, provider, provider_payment_id, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.user_id || null, data.event_id || null, data.plan_name, data.amount, data.payment_status, data.provider || 'manual', data.provider_payment_id || null, data.notes || null, nowIso(), nowIso());
  await logAudit({ actorUserId: req.user.id, eventId: data.event_id || null, action: 'super_admin_payment_record_create', metadata: { userId: data.user_id, amount: data.amount, status: data.payment_status }, ip: req.ip });
  setFlash(res, 'success', 'Payment record added.');
  return res.redirect('/admin/payments');
});

adminRouter.get('/admin/links.json', async (req, res) => {
  res.json({
    dashboard: absoluteUrl(req, '/admin'),
    users: absoluteUrl(req, '/admin/users'),
    events: absoluteUrl(req, '/admin/events'),
    audit: absoluteUrl(req, '/admin/audit'),
    security: absoluteUrl(req, '/admin/security'),
  });
});

adminRouter.get('/admin/security', async (req, res) => {
  const blockedIps = await db.prepare('SELECT * FROM blocked_ips ORDER BY blocked_at DESC').all();
  const securityLogs = await db.prepare(`
    SELECT a.*, u.name AS actor_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.action LIKE '%2fa%'
       OR a.action LIKE '%blocked%'
       OR a.action LIKE '%ip%'
       OR a.action = 'suspicious_activity'
       OR a.action = '2fa_enabled'
       OR a.action = '2fa_disabled'
       OR a.action = 'media_flagged_nsfw'
    ORDER BY a.created_at DESC
    LIMIT 100
  `).all();

  const flaggedMedia = await db.prepare(`
    SELECT m.*, e.title AS event_title, u.name AS owner_name
    FROM media m
    JOIN events e ON e.id = m.event_id
    JOIN users u ON u.id = e.owner_id
    WHERE m.is_nsfw = 1
    ORDER BY m.created_at DESC
  `).all();

  res.render('admin/security', { title: 'Security Center', blockedIps, securityLogs, flaggedMedia });
});

const blockIpSchema = z.object({
  ip: z.string().trim().ip('Valid IP address is required'),
  reason: z.string().trim().max(200).optional().default(''),
});

adminRouter.post('/admin/security/block', requireCsrf, async (req, res) => {
  const parsed = blockIpSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(res, 'error', parsed.error.flatten().fieldErrors.ip?.[0] || 'Invalid input.');
    return res.redirect('/admin/security');
  }

  const { ip, reason } = parsed.data;
  try {
    await db.prepare('INSERT OR REPLACE INTO blocked_ips (ip, reason, blocked_at) VALUES (?, ?, ?)')
      .run(ip, reason || null, nowIso());
    await logAudit({ actorUserId: req.user.id, action: 'super_admin_ip_blocked', metadata: { ip, reason }, ip: req.ip });
    setFlash(res, 'success', `IP ${ip} has been blocked.`);
  } catch (err) {
    console.error('Failed to block IP:', err);
    setFlash(res, 'error', 'Database error while blocking IP.');
  }
  res.redirect('/admin/security');
});

adminRouter.post('/admin/security/unblock', requireCsrf, async (req, res) => {
  const ip = String(req.body.ip || '').trim();
  if (!ip) {
    setFlash(res, 'error', 'IP address is missing.');
    return res.redirect('/admin/security');
  }

  try {
    await db.prepare('DELETE FROM blocked_ips WHERE ip = ?').run(ip);
    await logAudit({ actorUserId: req.user.id, action: 'super_admin_ip_unblocked', metadata: { ip }, ip: req.ip });
    setFlash(res, 'success', `IP ${ip} has been unblocked.`);
  } catch (err) {
    console.error('Failed to unblock IP:', err);
    setFlash(res, 'error', 'Database error while unblocking IP.');
  }
  res.redirect('/admin/security');
});

adminRouter.get('/admin/plans', async (req, res) => {
  const plans = await db.prepare('SELECT * FROM plans ORDER BY price ASC').all();
  res.render('admin/plans', { title: 'Manage Plans', plans });
});

adminRouter.get('/admin/plans/new', async (req, res) => {
  res.render('admin/edit-plan', { title: 'Create Plan', plan: {}, errors: {} });
});

const planCreateSchema = z.object({
  name: z.string().trim().min(2).max(50),
  slug: z.string().trim().min(2).max(50),
  price: z.coerce.number().int().min(0),
  storage_limit_mb: z.coerce.number().int().min(1),
  photo_max_mb: z.coerce.number().int().min(1),
  video_max_mb: z.coerce.number().int().min(1),
  max_files_per_upload: z.coerce.number().int().min(1),
  max_folders: z.coerce.number().int().min(1),
});

adminRouter.post('/admin/plans', requireCsrf, async (req, res) => {
  const parsed = planCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).render('admin/edit-plan', {
      title: 'Create Plan',
      plan: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const data = parsed.data;
  const videoEnabled = req.body.video_enabled === 'on' ? 1 : 0;
  const zipDownloadEnabled = req.body.zip_download_enabled === 'on' ? 1 : 0;
  const pinGalleryEnabled = req.body.pin_gallery_enabled === 'on' ? 1 : 0;
  const customBrandingEnabled = req.body.custom_branding_enabled === 'on' ? 1 : 0;

  try {
    await db.prepare(`
      INSERT INTO plans (
        name, slug, price, storage_limit_bytes, photo_max_bytes, video_max_bytes,
        max_files_per_upload, max_folders, video_enabled, zip_download_enabled, pin_gallery_enabled, custom_branding_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.name,
      data.slug,
      data.price,
      data.storage_limit_mb * 1024 * 1024,
      data.photo_max_mb * 1024 * 1024,
      data.video_max_mb * 1024 * 1024,
      data.max_files_per_upload,
      data.max_folders,
      videoEnabled,
      zipDownloadEnabled,
      pinGalleryEnabled,
      customBrandingEnabled
    );

    await logAudit({ actorUserId: req.user.id, action: 'super_admin_plan_create', metadata: { slug: data.slug }, ip: req.ip });
    setFlash(res, 'success', `Plan ${data.name} created successfully.`);
    res.redirect('/admin/plans');
  } catch (err) {
    console.error('Failed to create plan:', err);
    return res.status(400).render('admin/edit-plan', {
      title: 'Create Plan',
      plan: req.body,
      errors: { slug: ['Plan slug must be unique and valid.'] },
    });
  }
});

adminRouter.get('/admin/plans/:id/edit', async (req, res) => {
  const plan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).render('error', { title: 'Not found', message: 'Plan not found.' });

  const planMapped = {
    ...plan,
    storage_limit_mb: Math.floor(plan.storage_limit_bytes / (1024 * 1024)),
    photo_max_mb: Math.floor(plan.photo_max_bytes / (1024 * 1024)),
    video_max_mb: Math.floor(plan.video_max_bytes / (1024 * 1024)),
  };

  res.render('admin/edit-plan', { title: `Edit Plan: ${plan.name}`, plan: planMapped, errors: {} });
});

adminRouter.post('/admin/plans/:id', requireCsrf, async (req, res) => {
  const plan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).render('error', { title: 'Not found', message: 'Plan not found.' });

  const parsed = planCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).render('admin/edit-plan', {
      title: `Edit Plan: ${plan.name}`,
      plan: { ...req.body, id: plan.id },
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const data = parsed.data;
  const videoEnabled = req.body.video_enabled === 'on' ? 1 : 0;
  const zipDownloadEnabled = req.body.zip_download_enabled === 'on' ? 1 : 0;
  const pinGalleryEnabled = req.body.pin_gallery_enabled === 'on' ? 1 : 0;
  const customBrandingEnabled = req.body.custom_branding_enabled === 'on' ? 1 : 0;
  const isActive = req.body.is_active === 'on' ? 1 : 0;

  try {
    await db.prepare(`
      UPDATE plans SET
        name = ?, slug = ?, price = ?, storage_limit_bytes = ?, photo_max_bytes = ?, video_max_bytes = ?,
        max_files_per_upload = ?, max_folders = ?, video_enabled = ?, zip_download_enabled = ?, pin_gallery_enabled = ?, custom_branding_enabled = ?, is_active = ?
      WHERE id = ?
    `).run(
      data.name,
      data.slug,
      data.price,
      data.storage_limit_mb * 1024 * 1024,
      data.photo_max_mb * 1024 * 1024,
      data.video_max_mb * 1024 * 1024,
      data.max_files_per_upload,
      data.max_folders,
      videoEnabled,
      zipDownloadEnabled,
      pinGalleryEnabled,
      customBrandingEnabled,
      isActive,
      plan.id
    );

    await logAudit({ actorUserId: req.user.id, action: 'super_admin_plan_update', metadata: { slug: data.slug }, ip: req.ip });
    setFlash(res, 'success', `Plan ${data.name} updated successfully.`);
    res.redirect('/admin/plans');
  } catch (err) {
    console.error('Failed to update plan:', err);
    return res.status(400).render('admin/edit-plan', {
      title: `Edit Plan: ${plan.name}`,
      plan: { ...req.body, id: plan.id },
      errors: { slug: ['Plan slug must be unique and valid.'] },
    });
  }
});

adminRouter.get('/admin/settings', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM platform_settings').all();
  const settings = {};
  rows.forEach((r) => {
    settings[r.key] = r.value;
  });
  res.render('admin/settings', { title: 'Platform Settings', settings });
});

adminRouter.post('/admin/settings', requireCsrf, async (req, res) => {
  const keys = ['registration_enabled', 'whatsapp_login_enabled', 'email_login_enabled', 'brand_name', 'support_email', 'allowed_file_types'];
  const updateSetting = await db.prepare('INSERT OR REPLACE INTO platform_settings (key, value, type, updated_at) VALUES (?, ?, ?, ?)');

  const booleanKeys = ['registration_enabled', 'whatsapp_login_enabled', 'email_login_enabled'];

  await db.transaction(async () => {
    for (const key of keys) {
      let val = req.body[key] || '';
      if (booleanKeys.includes(key)) {
        val = req.body[key] === 'on' ? 'true' : 'false';
      }
      await updateSetting.run(key, val, booleanKeys.includes(key) ? 'boolean' : 'string', nowIso());
    }
  });

  await logAudit({ actorUserId: req.user.id, action: 'super_admin_settings_update', ip: req.ip });
  setFlash(res, 'success', 'Platform settings updated successfully.');
  res.redirect('/admin/settings');
});

adminRouter.get('/admin/whatsapp', async (req, res) => {
  res.render('admin/whatsapp', {
    title: 'WhatsApp Settings',
    status: whatsappService.connectionStatus,
    qrDataUrl: whatsappService.qrDataUrl,
    pairedNumber: whatsappService.pairedNumber,
  });
});

adminRouter.post('/admin/whatsapp/logout', requireCsrf, asyncHandler(async (req, res) => {
  await whatsappService.logout();
  await logAudit({ actorUserId: req.user.id, action: 'super_admin_whatsapp_disconnect', ip: req.ip });
  setFlash(res, 'success', 'WhatsApp connection has been reset. You can now pair a new device.');
  res.redirect('/admin/whatsapp');
}));

adminRouter.post('/admin/media/:mediaId/approve-flagged', requireCsrf, asyncHandler(async (req, res) => {
  const mediaId = req.params.mediaId;
  const media = await db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
  if (!media) {
    setFlash(res, 'error', 'Media not found.');
    return res.redirect('/admin/security');
  }

  await db.prepare("UPDATE media SET is_nsfw = 0, status = 'approved', approved_at = ?, rejected_at = NULL WHERE id = ?")
    .run(nowIso(), mediaId);

  await logAudit({
    actorUserId: req.user.id,
    eventId: media.event_id,
    action: 'super_admin_media_approve_flagged',
    metadata: { mediaId },
    ip: req.ip
  });

  setFlash(res, 'success', 'Media cleared and approved successfully.');
  res.redirect('/admin/security');
}));

adminRouter.post('/admin/media/:mediaId/delete-flagged', requireCsrf, asyncHandler(async (req, res) => {
  const mediaId = req.params.mediaId;
  const media = await db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
  if (!media) {
    setFlash(res, 'error', 'Media not found.');
    return res.redirect('/admin/security');
  }

  await deleteMediaFileAndRow(media, req.user.id, req);

  await logAudit({
    actorUserId: req.user.id,
    eventId: media.event_id,
    action: 'super_admin_media_delete_flagged',
    metadata: { mediaId },
    ip: req.ip
  });

  setFlash(res, 'success', 'Flagged media permanently deleted.');
  res.redirect('/admin/security');
}));
