import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');

function boolFromEnv(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

function toAbs(projectRelativeOrAbs) {
  if (path.isAbsolute(projectRelativeOrAbs)) return projectRelativeOrAbs;
  return path.resolve(PROJECT_ROOT, projectRelativeOrAbs);
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-dev-jwt-secret-minimum-32-characters';
const COOKIE_SECRET = process.env.COOKIE_SECRET || JWT_SECRET;

if (isProduction) {
  if (!process.env.JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.includes('change-this')) {
    throw new Error('Production JWT_SECRET is missing/weak. Set a long random JWT_SECRET in .env.');
  }
  if (!process.env.COOKIE_SECRET || COOKIE_SECRET.length < 32 || COOKIE_SECRET.includes('change-this')) {
    throw new Error('Production COOKIE_SECRET is missing/weak. Set a long random COOKIE_SECRET in .env.');
  }
}

export const config = {
  env: NODE_ENV,
  isProduction,
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  jwtSecret: JWT_SECRET,
  cookieSecret: COOKIE_SECRET,
  databasePath: toAbs(process.env.DATABASE_PATH || './data/app.db'),
  storageDir: toAbs(process.env.STORAGE_DIR || './storage'),
  registrationEnabled: boolFromEnv(process.env.REGISTRATION_ENABLED, true),
  trustProxy: boolFromEnv(process.env.TRUST_PROXY, false),
  maxFilesPerUpload: Math.min(Number(process.env.MAX_FILES_PER_UPLOAD || 20), 50),
  globalMaxFileSizeBytes: Number(process.env.GLOBAL_MAX_FILE_SIZE_MB || 200) * 1024 * 1024,
  cookie: {
    secure: isProduction,
    sameSite: 'lax',
    httpOnly: true,
  },
  storageProvider: process.env.STORAGE_PROVIDER || 'local',
  s3: {
    endpoint: process.env.S3_ENDPOINT || null,
    bucketName: process.env.S3_BUCKET_NAME || null,
    accessKeyId: process.env.S3_ACCESS_KEY_ID || null,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || null,
    region: process.env.S3_REGION || 'auto',
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || null,
    keySecret: process.env.RAZORPAY_KEY_SECRET || null,
  },
};

export const PLAN_LIMITS = {
  basic: {
    label: 'Basic',
    storageLimitBytes: 500 * 1024 * 1024,
    photoMaxBytes: 12 * 1024 * 1024,
    videoMaxBytes: 100 * 1024 * 1024,
    maxFilesPerUpload: 10,
  },
  premium: {
    label: 'Premium',
    storageLimitBytes: 2 * 1024 * 1024 * 1024,
    photoMaxBytes: 20 * 1024 * 1024,
    videoMaxBytes: 200 * 1024 * 1024,
    maxFilesPerUpload: 20,
  },
  royal: {
    label: 'Royal',
    storageLimitBytes: 10 * 1024 * 1024 * 1024,
    photoMaxBytes: 30 * 1024 * 1024,
    videoMaxBytes: 500 * 1024 * 1024,
    maxFilesPerUpload: 30,
  },
};

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

export const MIME_TO_EXTENSION = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};
