import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config, PLAN_LIMITS } from './config.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function tableColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function ensureColumn(tableName, columnName, definition) {
  const columns = tableColumns(tableName);
  if (!columns.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TEXT,
      suspended_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      bride_name TEXT,
      groom_name TEXT,
      slug TEXT NOT NULL UNIQUE,
      upload_token TEXT NOT NULL UNIQUE,
      wedding_date TEXT,
      venue TEXT,
      city TEXT,
      plan TEXT NOT NULL DEFAULT 'basic',
      storage_limit_bytes INTEGER NOT NULL,
      upload_enabled INTEGER NOT NULL DEFAULT 1,
      gallery_enabled INTEGER NOT NULL DEFAULT 1,
      public_download_enabled INTEGER NOT NULL DEFAULT 0,
      gallery_pin_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event_id, name),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      event_id INTEGER NOT NULL,
      folder_id INTEGER NOT NULL,
      uploader_name TEXT,
      uploader_side TEXT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      storage_path TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT,
      rejected_at TEXT,
      thumbnail_path TEXT,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      event_id INTEGER,
      plan_name TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'INR',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT,
      provider_payment_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      event_id INTEGER,
      action TEXT NOT NULL,
      metadata TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_events_owner_id ON events(owner_id);
    CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
    CREATE INDEX IF NOT EXISTS idx_folders_event_id ON folders(event_id);
    CREATE INDEX IF NOT EXISTS idx_media_event_status ON media(event_id, status);
    CREATE INDEX IF NOT EXISTS idx_media_folder_id ON media(folder_id);
    CREATE INDEX IF NOT EXISTS idx_media_sha_event ON media(event_id, sha256);
    CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
    CREATE INDEX IF NOT EXISTS idx_payments_event_id ON payments(event_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status);
    CREATE INDEX IF NOT EXISTS idx_audit_event_id ON audit_logs(event_id);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id);

    CREATE TABLE IF NOT EXISTS blocked_ips (
      ip TEXT PRIMARY KEY,
      reason TEXT,
      blocked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      price INTEGER NOT NULL DEFAULT 0,
      storage_limit_bytes INTEGER NOT NULL,
      photo_max_bytes INTEGER NOT NULL,
      video_max_bytes INTEGER NOT NULL,
      max_files_per_upload INTEGER NOT NULL DEFAULT 10,
      max_folders INTEGER NOT NULL DEFAULT 10,
      video_enabled INTEGER NOT NULL DEFAULT 1,
      zip_download_enabled INTEGER NOT NULL DEFAULT 1,
      pin_gallery_enabled INTEGER NOT NULL DEFAULT 1,
      custom_branding_enabled INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      type TEXT NOT NULL DEFAULT 'string',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Backwards-compatible migrations for databases created before the super-admin release.
  ensureColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn('users', 'last_login_at', 'TEXT');
  ensureColumn('users', 'suspended_at', 'TEXT');
  ensureColumn('users', 'two_factor_secret', 'TEXT');
  ensureColumn('users', 'two_factor_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('events', 'storage_provider', "TEXT NOT NULL DEFAULT 'platform'");
  ensureColumn('events', 'storage_config', 'TEXT');
  ensureColumn('media', 'thumbnail_path', 'TEXT');

  // Seed default plans if empty
  const plansCount = db.prepare('SELECT COUNT(*) AS count FROM plans').get().count;
  if (plansCount === 0) {
    const insertPlan = db.prepare(`
      INSERT INTO plans (
        name, slug, price, storage_limit_bytes, photo_max_bytes, video_max_bytes,
        max_files_per_upload, max_folders, video_enabled, zip_download_enabled, pin_gallery_enabled, custom_branding_enabled, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    
    insertPlan.run('Basic', 'basic', 499, 500 * 1024 * 1024, 12 * 1024 * 1024, 100 * 1024 * 1024, 10, 10, 1, 1, 1, 0);
    insertPlan.run('Premium', 'premium', 1499, 2 * 1024 * 1024 * 1024, 20 * 1024 * 1024, 200 * 1024 * 1024, 20, 20, 1, 1, 1, 0);
    insertPlan.run('Royal', 'royal', 2999, 10 * 1024 * 1024 * 1024, 30 * 1024 * 1024, 500 * 1024 * 1024, 30, 30, 1, 1, 1, 1);
  }

  // Seed default settings if empty
  const settingsCount = db.prepare('SELECT COUNT(*) AS count FROM platform_settings').get().count;
  if (settingsCount === 0) {
    const insertSetting = db.prepare('INSERT INTO platform_settings (key, value, type) VALUES (?, ?, ?)');
    insertSetting.run('registration_enabled', 'true', 'boolean');
    insertSetting.run('brand_name', 'ShaadiShots', 'string');
    insertSetting.run('support_email', 'support@shaadishots.com', 'string');
    insertSetting.run('allowed_file_types', 'image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm', 'string');
  }
}

export function getStorageUsage(eventId) {
  const row = db
    .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS used FROM media WHERE event_id = ?')
    .get(eventId);
  return Number(row?.used || 0);
}

export function getGlobalStorageUsage() {
  const row = db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS used FROM media').get();
  return Number(row?.used || 0);
}

export function mediaCounts(eventId) {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS count FROM media WHERE event_id = ? GROUP BY status')
    .all(eventId);
  const out = { pending: 0, approved: 0, rejected: 0, total: 0 };
  for (const row of rows) {
    out[row.status] = Number(row.count || 0);
    out.total += Number(row.count || 0);
  }
  return out;
}

export function globalMediaCounts() {
  const rows = db.prepare('SELECT status, COUNT(*) AS count FROM media GROUP BY status').all();
  const out = { pending: 0, approved: 0, rejected: 0, total: 0 };
  for (const row of rows) {
    out[row.status] = Number(row.count || 0);
    out.total += Number(row.count || 0);
  }
  return out;
}

export function logAudit({ actorUserId = null, eventId = null, action, metadata = null, ip = null }) {
  try {
    db.prepare(
      'INSERT INTO audit_logs (actor_user_id, event_id, action, metadata, ip_address) VALUES (?, ?, ?, ?, ?)'
    ).run(actorUserId, eventId, action, metadata ? JSON.stringify(metadata) : null, ip);
  } catch (error) {
    console.error('audit_log_failed', error);
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function getPlan(planSlug) {
  try {
    const row = db.prepare('SELECT * FROM plans WHERE slug = ?').get(planSlug);
    if (row) {
      return {
        id: row.id,
        label: row.name,
        storageLimitBytes: row.storage_limit_bytes,
        photoMaxBytes: row.photo_max_bytes,
        videoMaxBytes: row.video_max_bytes,
        maxFilesPerUpload: row.max_files_per_upload,
        maxFolders: row.max_folders,
        videoEnabled: row.video_enabled === 1,
        zipDownloadEnabled: row.zip_download_enabled === 1,
        pinGalleryEnabled: row.pin_gallery_enabled === 1,
        customBrandingEnabled: row.custom_branding_enabled === 1,
        isActive: row.is_active === 1,
      };
    }
  } catch (err) {
    console.error('getPlan error:', err);
  }
  // fallback
  const fallback = PLAN_LIMITS[planSlug] || PLAN_LIMITS.basic;
  return {
    label: fallback.label,
    storageLimitBytes: fallback.storageLimitBytes,
    photoMaxBytes: fallback.photoMaxBytes,
    videoMaxBytes: fallback.videoMaxBytes,
    maxFilesPerUpload: fallback.maxFilesPerUpload,
    maxFolders: 10,
    videoEnabled: true,
    zipDownloadEnabled: true,
    pinGalleryEnabled: true,
    customBrandingEnabled: false,
    isActive: true,
  };
}

export function listPlans() {
  try {
    return db.prepare('SELECT * FROM plans WHERE is_active = 1 ORDER BY price ASC').all();
  } catch {
    return [];
  }
}

export function getSetting(key, fallback = null) {
  try {
    const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  } catch {
    return fallback;
  }
}

export function getSettingBool(key, fallback = false) {
  const val = getSetting(key);
  if (val === null) return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(val).toLowerCase());
}
