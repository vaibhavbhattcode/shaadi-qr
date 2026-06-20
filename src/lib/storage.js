import fs from 'node:fs';
import { Readable } from 'node:stream';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { fileTypeFromFile } from 'file-type';
import { db, getStorageUsage, logAudit, nowIso, getPlan } from '../db.js';
import { ALLOWED_MIME_TYPES, MIME_TO_EXTENSION, config } from '../config.js';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { stripMetadata } from './metadata.js';
import sharp from 'sharp';
import { detectNudity } from './moderation.js';
import { getValidAccessToken, uploadFile, downloadFile } from './google-drive.js';

export const s3Client = (config.storageProvider === 'r2' || config.storageProvider === 's3')
  ? new S3Client({
      region: config.s3.region || 'auto',
      endpoint: config.s3.endpoint || undefined,
      credentials: {
        accessKeyId: config.s3.accessKeyId || '',
        secretAccessKey: config.s3.secretAccessKey || '',
      },
    })
  : null;

export { GetObjectCommand };

export const STORAGE_ROOT = config.storageDir;
export const TMP_DIR = path.join(STORAGE_ROOT, 'tmp');
export const MEDIA_ROOT = path.join(STORAGE_ROOT, 'media');

fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(MEDIA_ROOT, { recursive: true });

const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.mp4', '.mov', '.webm']);

export class UploadValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'UploadValidationError';
    this.statusCode = 400;
    this.details = details;
  }
}

export class StorageQuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageQuotaError';
    this.statusCode = 413;
  }
}

function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sanitizeOriginalName(name = 'file') {
  const justName = path.basename(String(name));
  return justName
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120) || 'file';
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function resolveStoragePath(relativePath) {
  const full = path.resolve(STORAGE_ROOT, relativePath);
  if (!isPathInside(STORAGE_ROOT, full)) {
    throw new Error('Unsafe storage path');
  }
  return full;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

export async function safeUnlink(filePath) {
  try {
    if (filePath) await fsp.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('unlink_failed', error.message);
  }
}

const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${randomId(10)}.upload`),
});

export const uploadMiddleware = multer({
  storage: multerStorage,
  limits: {
    fileSize: config.globalMaxFileSizeBytes,
    files: config.maxFilesPerUpload,
    fields: 10,
    fieldNameSize: 80,
    fieldSize: 1024 * 64,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    // We still do real magic-byte validation after upload. This early filter only improves UX.
    if (ALLOWED_MIME_TYPES.has(file.mimetype) || allowedExtensions.has(ext)) {
      cb(null, true);
      return;
    }
    cb(new UploadValidationError('Only wedding photos/videos are allowed: JPG, PNG, WEBP, HEIC, MP4, MOV, WEBM.'));
  },
});

function mediaTypeFromMime(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

async function detectAndValidateFile(file, plan) {
  const detected = await fileTypeFromFile(file.path);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    throw new UploadValidationError(`${sanitizeOriginalName(file.originalname)} is not a supported/valid photo or video file.`);
  }

  const mediaType = mediaTypeFromMime(detected.mime);
  if (!mediaType) {
    throw new UploadValidationError(`${sanitizeOriginalName(file.originalname)} has an unsupported media type.`);
  }

  const maxBytes = mediaType === 'image' ? plan.photoMaxBytes : plan.videoMaxBytes;
  if (file.size > maxBytes) {
    const maxMb = Math.floor(maxBytes / (1024 * 1024));
    throw new UploadValidationError(`${sanitizeOriginalName(file.originalname)} is too large. Max ${mediaType} size is ${maxMb} MB on this plan.`);
  }

  return {
    mime: detected.mime,
    mediaType,
    extension: MIME_TO_EXTENSION[detected.mime] || `.${detected.ext}`,
  };
}

export async function validateAndStoreUploads({ event, folderId, uploaderName, uploaderSide, files, req }) {
  const plan = getPlan(event.plan);
  const accepted = [];
  const skipped = [];
  const rejected = [];

  if (!files || files.length === 0) {
    throw new UploadValidationError('Please select at least one photo or video.');
  }
  if (files.length > plan.maxFilesPerUpload) {
    await Promise.all(files.map((f) => safeUnlink(f.path)));
    throw new UploadValidationError(`Maximum ${plan.maxFilesPerUpload} files can be uploaded at once on this plan.`);
  }

  const batchHashes = new Set();
  const candidates = [];

  for (const file of files) {
    try {
      const detected = await detectAndValidateFile(file, plan);
      const sha256 = await sha256File(file.path);

      const duplicateInBatch = batchHashes.has(sha256);
      const duplicateInDb = db
        .prepare('SELECT id FROM media WHERE event_id = ? AND sha256 = ? LIMIT 1')
        .get(event.id, sha256);

      if (duplicateInBatch || duplicateInDb) {
        skipped.push({ name: sanitizeOriginalName(file.originalname), reason: 'Duplicate file skipped' });
        await safeUnlink(file.path);
        continue;
      }

      batchHashes.add(sha256);
      candidates.push({ file, detected, sha256 });
    } catch (error) {
      rejected.push({ name: sanitizeOriginalName(file.originalname), reason: error.message || 'Invalid file' });
      await safeUnlink(file.path);
    }
  }

  if (candidates.length === 0) {
    return { accepted, skipped, rejected };
  }

  const incomingBytes = candidates.reduce((sum, item) => sum + item.file.size, 0);
  const usedBytes = getStorageUsage(event.id);
  if (usedBytes + incomingBytes > event.storage_limit_bytes) {
    await Promise.all(candidates.map((item) => safeUnlink(item.file.path)));
    throw new StorageQuotaError('This wedding album storage limit is full. Please ask the couple/admin to upgrade or delete rejected media.');
  }

  const folderRow = db.prepare('SELECT name FROM folders WHERE id = ?').get(folderId);
  const folderName = folderRow ? folderRow.name : 'uploads';
  const folderSlug = folderName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'folder';

  const insert = db.prepare(`
    INSERT INTO media (
      id, event_id, folder_id, uploader_name, uploader_side, original_name, stored_name, storage_path,
      mime_type, media_type, size_bytes, sha256, status, created_at, thumbnail_path, is_nsfw
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const item of candidates) {
    const mediaId = randomId(12);
    const storedName = `${mediaId}${item.detected.extension}`;
    const sanitizedName = sanitizeOriginalName(item.file.originalname);

    let isNsfw = 0;
    let classification = { isNsfw: false, confidence: 0, reason: 'Not analyzed' };
    if (item.detected.mediaType === 'image') {
      classification = await detectNudity(item.file.path, sanitizedName);
      if (classification.isNsfw) {
        isNsfw = 1;
      }
    }

    const relativePath = isNsfw
      ? (s3Client
          ? `flagged/${event.id}/${mediaId}-${sanitizedName}`
          : path.join('media', 'flagged', String(event.id), storedName).replaceAll('\\', '/'))
      : (s3Client
          ? `events/${event.id}/${folderSlug}/${mediaId}-${sanitizedName}`
          : path.join('media', String(event.id), storedName).replaceAll('\\', '/'));
      
    const destination = s3Client ? null : resolveStoragePath(relativePath);
    try {
      const buffer = await fsp.readFile(item.file.path);
      const cleanBuffer = stripMetadata(buffer, item.detected.mime);
      if (cleanBuffer.length !== buffer.length) {
        await fsp.writeFile(item.file.path, cleanBuffer);
        item.file.size = cleanBuffer.length;
      }
    } catch (err) {
      console.error('[METADATA STRIP ERROR] Continuing with original file:', err);
    }

    let thumbnailPath = null;
    if (item.detected.mediaType === 'image') {
      try {
        const thumbBuffer = await sharp(item.file.path)
          .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
          
        const thumbRelative = s3Client
          ? `events/${event.id}/${folderSlug}/thumb-${mediaId}-${sanitizedName.replace(/\.[^/.]+$/, '')}.webp`
          : path.join('media', String(event.id), `thumb-${mediaId}.webp`).replaceAll('\\', '/');
          
        if (s3Client) {
          await s3Client.send(new PutObjectCommand({
            Bucket: config.s3.bucketName,
            Key: thumbRelative,
            Body: thumbBuffer,
            ContentType: 'image/webp',
          }));
        } else {
          const destThumb = resolveStoragePath(thumbRelative);
          await fsp.mkdir(path.dirname(destThumb), { recursive: true });
          await fsp.writeFile(destThumb, thumbBuffer);
        }
        thumbnailPath = thumbRelative;
      } catch (thumbErr) {
        console.error('[THUMBNAIL GENERATION ERROR] Continuing without thumbnail:', thumbErr);
      }
    }

    let saved = false;
    let finalStoragePath = relativePath;
    try {
      if (event.storage_provider === 'google_drive') {
        const configData = JSON.parse(event.storage_config || '{}');
        if (configData.mock) {
          const destDir = path.dirname(destination);
          await fsp.mkdir(destDir, { recursive: true });
          await fsp.rename(item.file.path, destination);
          saved = true;
          finalStoragePath = relativePath;
          console.log(`[GOOGLE DRIVE MOCK] Saved file locally: ${destination}`);
        } else {
          const accessToken = await getValidAccessToken(event.id);
          const fileBuffer = await fsp.readFile(item.file.path);
          
          const fileId = await uploadFile({
            name: storedName,
            mimeType: item.detected.mime,
            buffer: fileBuffer,
            accessToken
          });
          
          await safeUnlink(item.file.path);
          saved = true;
          finalStoragePath = fileId;
          console.log(`[GOOGLE DRIVE] Successfully uploaded file ID: ${fileId}`);
        }
      } else if (s3Client) {
        const fileStream = fs.createReadStream(item.file.path);
        await s3Client.send(new PutObjectCommand({
          Bucket: config.s3.bucketName,
          Key: relativePath,
          Body: fileStream,
          ContentType: item.detected.mime,
        }));
        await safeUnlink(item.file.path);
        saved = true;
        finalStoragePath = relativePath;
      } else {
        const destDir = path.dirname(destination);
        await fsp.mkdir(destDir, { recursive: true });
        await fsp.rename(item.file.path, destination);
        saved = true;
        finalStoragePath = relativePath;
      }
      
      insert.run(
        mediaId,
        event.id,
        folderId,
        uploaderName || null,
        uploaderSide || null,
        sanitizedName,
        storedName,
        finalStoragePath,
        item.detected.mime,
        item.detected.mediaType,
        item.file.size,
        item.sha256,
        isNsfw ? 'rejected' : 'pending',
        nowIso(),
        thumbnailPath,
        isNsfw
      );

      if (isNsfw) {
        logAudit({
          actorUserId: null,
          eventId: event.id,
          action: 'media_flagged_nsfw',
          metadata: { mediaId, confidence: classification.confidence, reason: classification.reason },
          ip: req ? req.ip : null
        });
      }
      accepted.push({ id: mediaId, name: sanitizedName, size: item.file.size });
    } catch (error) {
      if (saved && !s3Client) await safeUnlink(destination);
      else await safeUnlink(item.file.path);
      
      if (thumbnailPath) {
        try {
          if (s3Client) {
            await s3Client.send(new DeleteObjectCommand({ Bucket: config.s3.bucketName, Key: thumbnailPath }));
          } else {
            await safeUnlink(resolveStoragePath(thumbnailPath));
          }
        } catch {}
      }
      
      rejected.push({ name: sanitizedName, reason: 'Could not save this file. Please retry.' });
      console.error('store_upload_failed', error);
    }
  }

  logAudit({
    eventId: event.id,
    action: 'guest_upload',
    metadata: { accepted: accepted.length, skipped: skipped.length, rejected: rejected.length },
    ip: req?.ip,
  });

  return { accepted, skipped, rejected };
}

export async function deleteMediaFileAndRow(mediaRow, actorUserId = null, req = null) {
  if (!mediaRow) return;
  if (s3Client) {
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: config.s3.bucketName,
        Key: mediaRow.storage_path,
      }));
    } catch (err) {
      console.error('Failed to delete S3 object:', err);
    }
    if (mediaRow.thumbnail_path) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: config.s3.bucketName,
          Key: mediaRow.thumbnail_path,
        }));
      } catch (err) {
        console.error('Failed to delete S3 thumbnail:', err);
      }
    }
  } else {
    try {
      const abs = resolveStoragePath(mediaRow.storage_path);
      await safeUnlink(abs);
    } catch (err) {
      console.error('Failed to delete local file:', err);
    }
    if (mediaRow.thumbnail_path) {
      try {
        const abs = resolveStoragePath(mediaRow.thumbnail_path);
        await safeUnlink(abs);
      } catch (err) {
        console.error('Failed to delete local thumbnail:', err);
      }
    }
  }
  db.prepare('DELETE FROM media WHERE id = ?').run(mediaRow.id);
  logAudit({
    actorUserId,
    eventId: mediaRow.event_id,
    action: 'media_delete',
    metadata: { mediaId: mediaRow.id, originalName: mediaRow.original_name },
    ip: req?.ip,
  });
}

export function contentDispositionInline(filename) {
  const safe = sanitizeOriginalName(filename).replace(/"/g, '');
  return `inline; filename="${safe}"`;
}

export async function sendMediaFile(res, mediaRow, options = {}) {
  const event = db.prepare('SELECT storage_provider, storage_config FROM events WHERE id = ?').get(mediaRow.event_id);
  
  if (event && event.storage_provider === 'google_drive') {
    const configData = JSON.parse(event.storage_config || '{}');
    if (configData.mock) {
      const abs = resolveStoragePath(mediaRow.storage_path);
      res.setHeader('Content-Type', mediaRow.mime_type);
      res.setHeader('Content-Length', mediaRow.size_bytes);
      res.setHeader('Content-Disposition', options.download ? `attachment; filename="${sanitizeOriginalName(mediaRow.original_name)}"` : contentDispositionInline(mediaRow.original_name));
      res.setHeader('Cache-Control', options.private ? 'private, max-age=300' : 'public, max-age=3600');
      return res.sendFile(abs);
    } else {
      try {
        const accessToken = await getValidAccessToken(mediaRow.event_id);
        const driveResponse = await downloadFile({ fileId: mediaRow.storage_path, accessToken });
        
        res.setHeader('Content-Type', mediaRow.mime_type);
        const cl = driveResponse.headers.get('content-length');
        if (cl) res.setHeader('Content-Length', cl);
        
        res.setHeader('Content-Disposition', options.download 
          ? `attachment; filename="${sanitizeOriginalName(mediaRow.original_name)}"` 
          : contentDispositionInline(mediaRow.original_name));
        res.setHeader('Cache-Control', 'private, max-age=300');
        
        return Readable.fromWeb(driveResponse.body).pipe(res);
      } catch (err) {
        console.error('[GOOGLE DRIVE SEND FILE ERROR]', err);
        return res.status(500).send('Failed to stream file from Google Drive');
      }
    }
  }

  if (s3Client) {
    const disposition = options.download
      ? `attachment; filename="${sanitizeOriginalName(mediaRow.original_name)}"`
      : contentDispositionInline(mediaRow.original_name);
    
    const command = new GetObjectCommand({
      Bucket: config.s3.bucketName,
      Key: mediaRow.storage_path,
      ResponseContentDisposition: disposition,
      ResponseContentType: mediaRow.mime_type,
    });
    
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });
    return res.redirect(signedUrl);
  }

  const abs = resolveStoragePath(mediaRow.storage_path);
  res.setHeader('Content-Type', mediaRow.mime_type);
  res.setHeader('Content-Length', mediaRow.size_bytes);
  res.setHeader('Content-Disposition', options.download ? `attachment; filename="${sanitizeOriginalName(mediaRow.original_name)}"` : contentDispositionInline(mediaRow.original_name));
  res.setHeader('Cache-Control', options.private ? 'private, max-age=300' : 'public, max-age=3600');
  return res.sendFile(abs);
}

export async function sendMediaThumbnail(res, mediaRow, options = {}) {
  if (!mediaRow.thumbnail_path) {
    return sendMediaFile(res, mediaRow, options);
  }

  if (s3Client) {
    const command = new GetObjectCommand({
      Bucket: config.s3.bucketName,
      Key: mediaRow.thumbnail_path,
      ResponseContentType: 'image/webp',
    });
    
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });
    return res.redirect(signedUrl);
  }

  const abs = resolveStoragePath(mediaRow.thumbnail_path);
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', options.private ? 'private, max-age=300' : 'public, max-age=3600');
  return res.sendFile(abs);
}
