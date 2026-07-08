import express from 'express';
import bcrypt from 'bcryptjs';
import archiver from 'archiver';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { db, getStorageUsage, logAudit } from '../db.js';
import { requireCsrf } from '../middleware/csrf.js';
import { uploadLimiter } from '../middleware/security.js';
import { config } from '../config.js';
import { resolveStoragePath, safeUnlink, sendMediaFile, sendMediaThumbnail, uploadMiddleware, validateAndStoreUploads, UploadValidationError, StorageQuotaError, s3Client, GetObjectCommand } from '../lib/storage.js';
import { formatBytes, percent, absoluteUrl } from '../lib/helpers.js';
import { asyncHandler } from '../lib/async-handler.js';
import { generateCaptcha, verifyCaptcha } from '../lib/captcha.js';
import { setFlash } from '../middleware/flash.js';

export const publicRouter = express.Router();

const galleryCookiePrefix = 'wd_gallery_';

function galleryCookieName(eventId) {
  return `${galleryCookiePrefix}${eventId}`;
}

async function findEventBySlug(slug) {
  return await db.prepare(`
    SELECT e.*, u.status AS owner_status
    FROM events e
    JOIN users u ON u.id = e.owner_id
    WHERE e.slug = ?
  `).get(slug);
}

function tokenMatches(req, event) {
  const submitted = String(req.query.token || req.body?.token || '');
  return submitted && submitted === event.upload_token;
}

async function requireUploadAccess(req, res, next) {
  const event = await findEventBySlug(req.params.slug);
  if (!event || event.owner_status !== 'active' || !tokenMatches(req, event)) {
    return res.status(404).render('error', { title: 'Upload link not found', message: 'This QR upload link is invalid or expired.' });
  }
  if (!event.upload_enabled) {
    return res.status(403).render('error', { title: 'Uploads closed', message: 'Uploads for this wedding album are currently closed.' });
  }
  req.event = event;
  res.locals.event = event;
  return next();
}

function hasGalleryAccess(req, event) {
  if (!event.gallery_pin_hash) return true;
  return req.signedCookies?.[galleryCookieName(event.id)] === 'ok';
}

async function requireGalleryAccess(req, res, next) {
  const event = await findEventBySlug(req.params.slug);
  if (!event || event.owner_status !== 'active' || !event.gallery_enabled) {
    return res.status(404).render('error', { title: 'Gallery not found', message: 'This gallery is private or disabled.' });
  }
  req.event = event;
  res.locals.event = event;
  if (!hasGalleryAccess(req, event)) {
    return res.status(403).render('public/gallery-lock', { title: `${event.title} Gallery`, event, errors: {} });
  }
  return next();
}

async function folderList(eventId) {
  return await db.prepare('SELECT * FROM folders WHERE event_id = ? ORDER BY sort_order ASC, id ASC').all(eventId);
}

publicRouter.get('/', async (req, res) => {
  res.render('home', {
    title: 'Wedding QR Photo Collect App',
    structuredData: {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "ShaadiShots",
      "operatingSystem": "All",
      "applicationCategory": "BusinessApplication",
      "description": "Secure QR-based wedding photo and video collection platform with admin moderation, galleries, and storage management.",
      "offers": {
        "@type": "Offer",
        "price": "499",
        "priceCurrency": "INR",
        "category": "Standard"
      }
    }
  });
});

publicRouter.get('/privacy', async (req, res) => {
  res.render('public/privacy', { title: 'Privacy Policy' });
});

publicRouter.get('/contact', async (req, res) => {
  res.render('public/contact', { title: 'Contact Us', errors: {}, values: {} });
});

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().email('Valid email is required').max(160),
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(150),
  message: z.string().trim().min(10, 'Message must be at least 10 characters').max(1000),
});

publicRouter.post('/contact', requireCsrf, async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).render('public/contact', {
      title: 'Contact Us',
      errors: parsed.error.flatten().fieldErrors,
      values: req.body,
    });
  }

  const { name, email, subject, message } = parsed.data;
  await logAudit({
    action: 'contact_message_submitted',
    metadata: { name, email, subject, messageLength: message.length },
    ip: req.ip,
  });

  console.log(`\n========================================\n[SUPPORT CONTACT MESSAGE] from ${name} (${email}):\nSubject: ${subject}\nMessage: ${message}\n========================================\n`);

  setFlash(res, 'success', 'Your message has been sent successfully. We will get back to you shortly!');
  return res.redirect('/contact');
});

publicRouter.get('/e/:slug/upload', requireUploadAccess, async (req, res) => {
  const folders = await folderList(req.event.id);
  const used = await getStorageUsage(req.event.id);
  
  const challenge = generateCaptcha();
  res.cookie('ss_captcha', challenge.token, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    signed: true,
    maxAge: 24 * 60 * 60 * 1000,
  });

  res.render('public/upload', {
    title: `${req.event.title} Upload`,
    event: req.event,
    folders,
    uploadToken: req.event.upload_token,
    storage: {
      usedHuman: formatBytes(used),
      limitHuman: formatBytes(req.event.storage_limit_bytes),
      percent: percent(used, req.event.storage_limit_bytes),
    },
  });
});

const guestUploadFieldsSchema = z.object({
  folder_id: z.coerce.number().int().positive(),
  uploader_name: z.string().trim().max(80).optional().default(''),
  uploader_side: z.enum(['', 'bride', 'groom', 'family', 'friend', 'other']).optional().default(''),
});

publicRouter.post(
  '/e/:slug/upload',
  uploadLimiter,
  requireUploadAccess,
  requireCsrf,
  uploadMiddleware.array('media', config.maxFilesPerUpload),
  asyncHandler(async (req, res) => {
    const wantsJson = req.get('accept')?.includes('application/json') || req.get('content-type')?.includes('multipart/form-data');
    const fail = async (status, message, details = []) => {
      if (req.files?.length) await Promise.all(req.files.map((f) => safeUnlink(f.path)));
      if (wantsJson) return res.status(status).json({ ok: false, error: message, details });
      return res.status(status).render('error', { title: 'Upload failed', message });
    };

    try {
      const honeypot = req.body.website_url;
      const cookieVal = req.signedCookies.ss_captcha;
      if (!verifyCaptcha(honeypot, cookieVal)) {
        return fail(400, 'Incorrect security CAPTCHA answer. Please refresh the page to get a new code and try again.');
      }

      const parsed = guestUploadFieldsSchema.safeParse(req.body);
      if (!parsed.success) {
        return fail(400, 'Please select a valid event folder.', parsed.error.flatten().fieldErrors);
      }

      const folder = await db.prepare('SELECT * FROM folders WHERE id = ? AND event_id = ?').get(parsed.data.folder_id, req.event.id);
      if (!folder) return fail(400, 'Selected folder is invalid.');

      const result = await validateAndStoreUploads({
        event: req.event,
        folderId: folder.id,
        uploaderName: parsed.data.uploader_name,
        uploaderSide: parsed.data.uploader_side,
        files: req.files,
        req,
      });

      return res.json({ ok: true, message: 'Upload complete. Media is pending admin approval.', ...result });
    } catch (error) {
      const status = error.statusCode || 500;
      const message = error instanceof UploadValidationError || error instanceof StorageQuotaError ? error.message : 'Upload failed. Please try again.';
      console.error('guest_upload_error', error);
      return fail(status, message, error.details || []);
    }
  })
);

publicRouter.get('/e/:slug/gallery', requireGalleryAccess, async (req, res) => {
  const folders = await folderList(req.event.id);
  const rows = await db.prepare(`
    SELECT m.*, f.name AS folder_name, f.sort_order
    FROM media m
    JOIN folders f ON f.id = m.folder_id
    WHERE m.event_id = ? AND m.status = 'approved'
    ORDER BY f.sort_order ASC, m.created_at DESC
  `).all(req.event.id);

  res.render('public/gallery', {
    title: `${req.event.title} Gallery`,
    event: req.event,
    folders,
    media: rows,
  });
});

const pinSchema = z.object({ pin: z.string().trim().regex(/^\d{4,12}$/, 'Enter a valid 4-12 digit PIN.') });

publicRouter.post('/e/:slug/gallery/unlock', requireCsrf, asyncHandler(async (req, res) => {
  const event = await findEventBySlug(req.params.slug);
  if (!event || event.owner_status !== 'active' || !event.gallery_enabled || !event.gallery_pin_hash) {
    return res.status(404).render('error', { title: 'Gallery not found', message: 'This gallery is not available.' });
  }
  const parsed = pinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).render('public/gallery-lock', { title: `${event.title} Gallery`, event, errors: parsed.error.flatten().fieldErrors });
  }
  const ok = await bcrypt.compare(parsed.data.pin, event.gallery_pin_hash);
  if (!ok) {
    await logAudit({ eventId: event.id, action: 'gallery_pin_failed', ip: req.ip });
    return res.status(401).render('public/gallery-lock', { title: `${event.title} Gallery`, event, errors: { pin: ['Incorrect PIN.'] } });
  }
  res.cookie(galleryCookieName(event.id), 'ok', {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    signed: true,
    maxAge: 24 * 60 * 60 * 1000,
  });
  await logAudit({ eventId: event.id, action: 'gallery_pin_unlocked', ip: req.ip });
  return res.redirect(`/e/${encodeURIComponent(event.slug)}/gallery`);
}));

publicRouter.get('/e/:slug/media/:mediaId', requireGalleryAccess, asyncHandler(async (req, res) => {
  const media = await db.prepare('SELECT * FROM media WHERE id = ? AND event_id = ? AND status = ?').get(req.params.mediaId, req.event.id, 'approved');
  if (!media) return res.status(404).render('error', { title: 'Not found', message: 'Media not found.' });
  return await sendMediaFile(res, media, { private: Boolean(req.event.gallery_pin_hash) });
}));

publicRouter.get('/e/:slug/media/:mediaId/thumbnail', requireGalleryAccess, asyncHandler(async (req, res) => {
  const media = await db.prepare('SELECT * FROM media WHERE id = ? AND event_id = ? AND status = ?').get(req.params.mediaId, req.event.id, 'approved');
  if (!media) return res.status(404).render('error', { title: 'Not found', message: 'Media not found.' });
  return await sendMediaThumbnail(res, media, { private: Boolean(req.event.gallery_pin_hash) });
}));

publicRouter.get('/e/:slug/download.zip', requireGalleryAccess, asyncHandler(async (req, res, next) => {
  if (!req.event.public_download_enabled) {
    return res.status(403).render('error', { title: 'Download disabled', message: 'Public album download is disabled by the couple/admin.' });
  }
  const rows = await db.prepare(`
    SELECT m.*, f.name AS folder_name
    FROM media m
    JOIN folders f ON f.id = m.folder_id
    WHERE m.event_id = ? AND m.status = 'approved'
    ORDER BY f.sort_order ASC, m.created_at ASC
  `).all(req.event.id);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${req.event.slug}-approved-album.zip"`);
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
  await logAudit({ eventId: req.event.id, action: 'public_album_download', metadata: { count: rows.length }, ip: req.ip });
}));

publicRouter.get('/e/:slug/slideshow', requireGalleryAccess, async (req, res) => {
  const uploadLink = absoluteUrl(req, `/e/${encodeURIComponent(req.event.slug)}/upload?token=${encodeURIComponent(req.event.upload_token)}`);
  res.render('public/slideshow', {
    title: `${req.event.title} Live Cast`,
    event: req.event,
    uploadLink,
    layout: false, // Don't use standard navigation layout for full screen slideshow
  });
});

publicRouter.get('/e/:slug/slideshow/media', requireGalleryAccess, asyncHandler(async (req, res) => {
  const rows = await db.prepare(`
    SELECT id, original_name, uploader_name, uploader_side
    FROM media
    WHERE event_id = ? AND status = 'approved' AND media_type = 'image'
    ORDER BY created_at DESC
  `).all(req.event.id);
  res.json({ ok: true, media: rows });
}));

// ==========================================
// PUBLIC BLOGS & CMS
// ==========================================

publicRouter.get('/blog', asyncHandler(async (req, res) => {
  const blogs = await db.prepare(`
    SELECT b.*, u.name AS author_name 
    FROM blogs b 
    JOIN users u ON u.id = b.author_id 
    WHERE b.status = 'published' 
    ORDER BY b.published_at DESC
  `).all();

  res.render('public/blogs/index', {
    title: 'Wedding Photography & Planning Blogs',
    metaDescription: 'Discover the best tips, ideas, and checklists for wedding photography, planning, guest books, and photo sharing.',
    metaKeywords: 'wedding blog, photography tips, wedding planning checklist, qr code album, wedding templates',
    blogs
  });
}));

publicRouter.get('/blog/:slug', asyncHandler(async (req, res) => {
  const blog = await db.prepare(`
    SELECT b.*, u.name AS author_name 
    FROM blogs b 
    JOIN users u ON u.id = b.author_id 
    WHERE b.slug = ? AND b.status = 'published'
  `).get(req.params.slug);

  if (!blog) {
    return res.status(404).render('error', { title: 'Blog post not found', message: 'The blog article you are looking for does not exist.' });
  }

  const blogUrl = `${res.locals.appUrl}/blog/${blog.slug}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": blog.title,
    "description": blog.summary || blog.title,
    "image": blog.cover_image ? (blog.cover_image.startsWith('http') ? blog.cover_image : `${res.locals.appUrl}${blog.cover_image}`) : `${res.locals.appUrl}/logo.png`,
    "author": {
      "@type": "Person",
      "name": blog.author_name
    },
    "publisher": {
      "@type": "Organization",
      "name": "ShaadiShots",
      "logo": {
        "@type": "ImageObject",
        "url": `${res.locals.appUrl}/logo.png`
      }
    },
    "datePublished": blog.published_at || blog.created_at,
    "dateModified": blog.updated_at || blog.created_at,
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": blogUrl
    }
  };

  res.render('public/blogs/detail', {
    title: blog.meta_title || blog.title,
    metaDescription: blog.meta_description || blog.summary || blog.title,
    metaKeywords: blog.meta_keywords || 'wedding blog, wedding photography',
    ogTitle: blog.meta_title || blog.title,
    ogDescription: blog.meta_description || blog.summary,
    ogImage: blog.cover_image ? (blog.cover_image.startsWith('http') ? blog.cover_image : `${res.locals.appUrl}${blog.cover_image}`) : null,
    ogUrl: blogUrl,
    structuredData,
    blog
  });
}));

publicRouter.get('/blog/media/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.resolve('storage/blogs', filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).render('error', { title: 'Not found', message: 'Image not found.' });
  }
  res.sendFile(filePath);
});

