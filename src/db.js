import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import pg from 'pg';
import { config, PLAN_LIMITS } from './config.js';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

// Connection variables
let sqliteDb = null;
let pgPool = null;
export const isPostgres = !!process.env.DATABASE_URL;

if (isPostgres) {
  console.log('[DATABASE] Connecting to PostgreSQL using DATABASE_URL...');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
  });
} else {
  console.log('[DATABASE] Connecting to SQLite local database...');
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  sqliteDb = new Database(config.databasePath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.pragma('busy_timeout = 5000');
}

/**
 * Helper to translate SQLite specific syntax and placeholders to PostgreSQL
 */
function translateSql(sql) {
  let index = 1;
  let pgSql = sql.replace(/\?/g, () => `$${index++}`);

  // Handle specific sqlite-to-postgres conversions
  if (pgSql.includes('INSERT OR IGNORE INTO folders')) {
    pgSql = pgSql.replace('INSERT OR IGNORE INTO folders', 'INSERT INTO folders');
    pgSql += ' ON CONFLICT (event_id, name) DO NOTHING';
  } else if (pgSql.includes('INSERT OR REPLACE INTO blocked_ips')) {
    pgSql = pgSql.replace('INSERT OR REPLACE INTO blocked_ips', 'INSERT INTO blocked_ips');
    pgSql += ' ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason, blocked_at = EXCLUDED.blocked_at';
  } else if (pgSql.includes('INSERT OR REPLACE INTO platform_settings')) {
    pgSql = pgSql.replace('INSERT OR REPLACE INTO platform_settings', 'INSERT INTO platform_settings');
    pgSql += ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, type = EXCLUDED.type, updated_at = EXCLUDED.updated_at';
  }

  // Adjustments for timestamp functions and types
  pgSql = pgSql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  
  return pgSql;
}

// Statement wrapper class matching better-sqlite3 API but returns promises
class Statement {
  constructor(sql) {
    this.sql = sql;
  }

  async get(...params) {
    if (isPostgres) {
      const translated = translateSql(this.sql);
      const res = await pgPool.query(translated, params);
      return res.rows[0] || null;
    } else {
      return sqliteDb.prepare(this.sql).get(...params) || null;
    }
  }

  async all(...params) {
    if (isPostgres) {
      const translated = translateSql(this.sql);
      const res = await pgPool.query(translated, params);
      return res.rows;
    } else {
      return sqliteDb.prepare(this.sql).all(...params);
    }
  }

  async run(...params) {
    if (isPostgres) {
      let translated = translateSql(this.sql);
      // Automatically append RETURNING id for insert statements to fetch lastInsertRowid
      if (translated.trim().toUpperCase().startsWith('INSERT') && !translated.toUpperCase().includes('RETURNING')) {
        translated += ' RETURNING id';
      }
      const res = await pgPool.query(translated, params);
      const lastInsertRowid = res.rows[0]?.id || null;
      return {
        changes: res.rowCount,
        lastInsertRowid
      };
    } else {
      const info = sqliteDb.prepare(this.sql).run(...params);
      return {
        changes: info.changes,
        lastInsertRowid: info.lastInsertRowid
      };
    }
  }
}

// Database client abstraction
export const db = {
  prepare(sql) {
    return new Statement(sql);
  },

  pragma(sql) {
    if (isPostgres) return; // Pragma is SQLite-specific
    sqliteDb.pragma(sql);
  },

  async exec(sql) {
    if (isPostgres) {
      await pgPool.query(sql);
    } else {
      sqliteDb.exec(sql);
    }
  },

  async transaction(fn) {
    // Basic transaction support
    if (isPostgres) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        const res = await fn(client);
        await client.query('COMMIT');
        return res;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      // better-sqlite3 transactions cannot be async. Since our Statements return Promises,
      // we execute transaction BEGIN/COMMIT statements directly to support async operations.
      try {
        sqliteDb.prepare('BEGIN').run();
        const res = await fn(null);
        sqliteDb.prepare('COMMIT').run();
        return res;
      } catch (err) {
        try {
          sqliteDb.prepare('ROLLBACK').run();
        } catch {}
        throw err;
      }
    }
  },
};

async function tableColumns(tableName) {
  if (isPostgres) {
    const res = await pgPool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [tableName]
    );
    return res.rows.map(r => r.column_name);
  } else {
    return sqliteDb.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
  }
}

async function ensureColumn(tableName, columnName, definition) {
  const columns = await tableColumns(tableName);
  if (!columns.includes(columnName.toLowerCase())) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export async function migrate() {
  if (isPostgres) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'owner',
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        last_login_at TIMESTAMP WITH TIME ZONE,
        suspended_at TIMESTAMP WITH TIME ZONE,
        two_factor_secret VARCHAR(255),
        two_factor_enabled INTEGER NOT NULL DEFAULT 0,
        phone_number VARCHAR(100),
        google_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        bride_name VARCHAR(255),
        groom_name VARCHAR(255),
        slug VARCHAR(255) NOT NULL UNIQUE,
        upload_token VARCHAR(255) NOT NULL UNIQUE,
        wedding_date VARCHAR(255),
        venue VARCHAR(255),
        city VARCHAR(255),
        plan VARCHAR(50) NOT NULL DEFAULT 'basic',
        storage_limit_bytes BIGINT NOT NULL,
        upload_enabled INTEGER NOT NULL DEFAULT 1,
        gallery_enabled INTEGER NOT NULL DEFAULT 1,
        public_download_enabled INTEGER NOT NULL DEFAULT 0,
        gallery_pin_hash VARCHAR(255),
        storage_provider VARCHAR(50) NOT NULL DEFAULT 'platform',
        storage_config TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS folders (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_id, name),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS media (
        id VARCHAR(255) PRIMARY KEY,
        event_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        uploader_name VARCHAR(255),
        uploader_side VARCHAR(50),
        original_name VARCHAR(255) NOT NULL,
        stored_name VARCHAR(255) NOT NULL,
        storage_path VARCHAR(555) NOT NULL UNIQUE,
        mime_type VARCHAR(255) NOT NULL,
        media_type VARCHAR(50) NOT NULL CHECK(media_type IN ('image', 'video')),
        size_bytes BIGINT NOT NULL,
        sha256 VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        approved_at TIMESTAMP WITH TIME ZONE,
        rejected_at TIMESTAMP WITH TIME ZONE,
        thumbnail_path VARCHAR(555),
        is_nsfw INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        event_id INTEGER,
        plan_name VARCHAR(255) NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
        provider VARCHAR(50),
        provider_payment_id VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        actor_user_id INTEGER,
        event_id INTEGER,
        action VARCHAR(255) NOT NULL,
        metadata TEXT,
        ip_address VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS blocked_ips (
        ip VARCHAR(100) PRIMARY KEY,
        reason VARCHAR(255),
        blocked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS otp_verifications (
        id SERIAL PRIMARY KEY,
        phone_number VARCHAR(50) NOT NULL,
        code VARCHAR(10) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS email_otp_verifications (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        code VARCHAR(10) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL UNIQUE,
        price INTEGER NOT NULL DEFAULT 0,
        storage_limit_bytes BIGINT NOT NULL,
        photo_max_bytes BIGINT NOT NULL,
        video_max_bytes BIGINT NOT NULL,
        max_files_per_upload INTEGER NOT NULL DEFAULT 10,
        max_folders INTEGER NOT NULL DEFAULT 10,
        video_enabled INTEGER NOT NULL DEFAULT 1,
        zip_download_enabled INTEGER NOT NULL DEFAULT 1,
        pin_gallery_enabled INTEGER NOT NULL DEFAULT 1,
        custom_branding_enabled INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS platform_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        type VARCHAR(50) NOT NULL DEFAULT 'string',
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS blogs (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL UNIQUE,
        summary TEXT,
        content TEXT NOT NULL,
        cover_image VARCHAR(555),
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        author_id INTEGER NOT NULL,
        meta_title VARCHAR(255),
        meta_description TEXT,
        meta_keywords VARCHAR(255),
        published_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // PostgreSQL index creations
    await db.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_verifications(phone_number);
      CREATE INDEX IF NOT EXISTS idx_otp_email ON email_otp_verifications(email);
      CREATE INDEX IF NOT EXISTS idx_blogs_slug ON blogs(slug);
      CREATE INDEX IF NOT EXISTS idx_blogs_status ON blogs(status);
    `);
  } else {
    // SQLite migrations
    sqliteDb.exec(`
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
        is_nsfw INTEGER NOT NULL DEFAULT 0,
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

      CREATE TABLE IF NOT EXISTS otp_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_number TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS email_otp_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_verifications(phone_number);
      CREATE INDEX IF NOT EXISTS idx_otp_email ON email_otp_verifications(email);

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

      CREATE TABLE IF NOT EXISTS blogs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        summary TEXT,
        content TEXT NOT NULL,
        cover_image TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        author_id INTEGER NOT NULL,
        meta_title TEXT,
        meta_description TEXT,
        meta_keywords TEXT,
        published_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_blogs_slug ON blogs(slug);
      CREATE INDEX IF NOT EXISTS idx_blogs_status ON blogs(status);
    `);
  }

  // Column updates for SQLite or PG
  await ensureColumn('users', 'status', "VARCHAR(50) NOT NULL DEFAULT 'active'");
  await ensureColumn('users', 'last_login_at', 'VARCHAR(255)');
  await ensureColumn('users', 'suspended_at', 'VARCHAR(255)');
  await ensureColumn('users', 'two_factor_secret', 'VARCHAR(255)');
  await ensureColumn('users', 'two_factor_enabled', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('events', 'storage_provider', "VARCHAR(50) NOT NULL DEFAULT 'platform'");
  await ensureColumn('events', 'storage_config', 'TEXT');
  await ensureColumn('media', 'thumbnail_path', 'VARCHAR(555)');
  await ensureColumn('users', 'phone_number', 'VARCHAR(100)');
  await ensureColumn('users', 'google_id', 'VARCHAR(255)');
  await ensureColumn('media', 'is_nsfw', 'INTEGER NOT NULL DEFAULT 0');

  // PG vs SQLite Unique Indexes
  if (isPostgres) {
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number) WHERE phone_number IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_id) WHERE google_id IS NOT NULL;
    `);
  } else {
    sqliteDb.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number) WHERE phone_number IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_id) WHERE google_id IS NOT NULL;
    `);
  }

  // Seed default plans if empty
  const plansCount = (await db.prepare('SELECT COUNT(*) AS count FROM plans').get()).count;
  if (Number(plansCount) === 0) {
    const insertPlan = db.prepare(`
      INSERT INTO plans (
        name, slug, price, storage_limit_bytes, photo_max_bytes, video_max_bytes,
        max_files_per_upload, max_folders, video_enabled, zip_download_enabled, pin_gallery_enabled, custom_branding_enabled, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    
    await insertPlan.run('Basic', 'basic', 499, 500 * 1024 * 1024, 12 * 1024 * 1024, 100 * 1024 * 1024, 10, 10, 1, 1, 1, 0);
    await insertPlan.run('Premium', 'premium', 1499, 2 * 1024 * 1024 * 1024, 20 * 1024 * 1024, 200 * 1024 * 1024, 20, 20, 1, 1, 1, 0);
    await insertPlan.run('Royal', 'royal', 2999, 10 * 1024 * 1024 * 1024, 30 * 1024 * 1024, 500 * 1024 * 1024, 30, 30, 1, 1, 1, 1);
  }

  // Seed default settings if empty
  const settingsCount = (await db.prepare('SELECT COUNT(*) AS count FROM platform_settings').get()).count;
  if (Number(settingsCount) === 0) {
    const insertSetting = db.prepare('INSERT INTO platform_settings (key, value, type) VALUES (?, ?, ?)');
    await insertSetting.run('registration_enabled', 'true', 'boolean');
    await insertSetting.run('brand_name', 'ShaadiShots', 'string');
    await insertSetting.run('support_email', 'support@shaadishots.com', 'string');
    await insertSetting.run('allowed_file_types', 'image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm', 'string');
  }

  // Ensure whatsapp_login_enabled setting exists
  const whatsappSetting = await db.prepare("SELECT key FROM platform_settings WHERE key = 'whatsapp_login_enabled'").get();
  if (!whatsappSetting) {
    await db.prepare("INSERT INTO platform_settings (key, value, type) VALUES ('whatsapp_login_enabled', 'true', 'boolean')").run();
  }

  // Ensure email_login_enabled setting exists
  const emailSetting = await db.prepare("SELECT key FROM platform_settings WHERE key = 'email_login_enabled'").get();
  if (!emailSetting) {
    await db.prepare("INSERT INTO platform_settings (key, value, type) VALUES ('email_login_enabled', 'true', 'boolean')").run();
  }

  // Seed default super admin user if users table is empty
  const usersCount = (await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count;
  if (Number(usersCount) === 0) {
    const passwordHash = bcrypt.hashSync('SuperAdmin123!', 12);
    await db.prepare("INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, 'super_admin', 'active')")
      .run('Platform Super Admin', 'superadmin@example.com', passwordHash);
    console.log('[DATABASE SEED] Seeded default super admin user: superadmin@example.com / SuperAdmin123!');
    console.log('[SECURITY WARNING] ⚠️  Change the default super admin password immediately in production!');
  }
}

export async function getStorageUsage(eventId) {
  const row = await db
    .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS used FROM media WHERE event_id = ?')
    .get(eventId);
  return Number(row?.used || 0);
}

export async function getGlobalStorageUsage() {
  const row = await db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS used FROM media').get();
  return Number(row?.used || 0);
}

export async function mediaCounts(eventId) {
  const rows = await db
    .prepare('SELECT status, COUNT(*) AS count FROM media WHERE event_id = ? GROUP BY status')
    .all(eventId);
  const out = { pending: 0, approved: 0, rejected: 0, total: 0 };
  for (const row of rows) {
    out[row.status] = Number(row.count || 0);
    out.total += Number(row.count || 0);
  }
  return out;
}

export async function globalMediaCounts() {
  const rows = await db.prepare('SELECT status, COUNT(*) AS count FROM media GROUP BY status').all();
  const out = { pending: 0, approved: 0, rejected: 0, total: 0 };
  for (const row of rows) {
    out[row.status] = Number(row.count || 0);
    out.total += Number(row.count || 0);
  }
  return out;
}

export async function logAudit({ actorUserId = null, eventId = null, action, metadata = null, ip = null }) {
  try {
    await db.prepare(
      'INSERT INTO audit_logs (actor_user_id, event_id, action, metadata, ip_address) VALUES (?, ?, ?, ?, ?)'
    ).run(actorUserId, eventId, action, metadata ? JSON.stringify(metadata) : null, ip);
  } catch (error) {
    console.error('audit_log_failed', error);
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export async function getPlan(planSlug) {
  try {
    const row = await db.prepare('SELECT * FROM plans WHERE slug = ?').get(planSlug);
    if (row) {
      return {
        id: row.id,
        label: row.name,
        storageLimitBytes: Number(row.storage_limit_bytes),
        photoMaxBytes: Number(row.photo_max_bytes),
        videoMaxBytes: Number(row.video_max_bytes),
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

export async function listPlans() {
  try {
    return await db.prepare('SELECT * FROM plans WHERE is_active = 1 ORDER BY price ASC').all();
  } catch {
    return [];
  }
}

export async function getSetting(key, fallback = null) {
  try {
    const row = await db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  } catch {
    return fallback;
  }
}

export async function getSettingBool(key, fallback = false) {
  const val = await getSetting(key);
  if (val === null) return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(val).toLowerCase());
}
