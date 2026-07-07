# SHAADISHOTS REDESIGN — PHASE 8-12

## PHASE 8: GUEST EXPERIENCE — ZERO FRICTION

### Design Principles

1. **No login. No account. No password.** — The guest should never see a login form.
2. **Under 20 seconds.** — From QR scan to "Upload Complete" in <20 seconds.
3. **One primary action.** — The upload button is the only thing that matters.
4. **Works offline.** — Venues have bad cell service. Queue uploads.
5. **Camera-first.** — Mobile camera should open instantly.

### The 10-Second Upload Flow

```
QR SCAN (1s)
  ↓
SPLASH PAGE (2s)
  ├── Shows couple photo + wedding date
  ├── Animated heart icon
  └── Pre-caches upload endpoint
  ↓
TAP UPLOAD (1s)
  ├── Bottom sheet: Camera / Gallery
  └── PhotoKit picker (iOS) / Google Photos picker (Android)
  ↓
SELECT + CONFIRM (3s)
  ├── Multi-select with preview grid
  └── "Upload 5 Photos" button
  ↓
UPLOAD PROGRESS (2-5s)
  ├── Animated ring progress
  ├── Background upload (can close page)
  └── Notifications when complete
  ↓
SUCCESS (1s)
  ├── "Thanks, Ankita!" with name
  ├── Confetti animation
  ├── "Upload More" button
  └── "View Gallery" link
```

### Mobile Upload Flow — Wireframe

```
┌─────────────────────────────────┐
│                                 │
│  ✨ Priya & Raj                 │
│  Feb 14, 2026 · Udaipur        │
│                                 │
│     ┌───────────────────┐      │
│     │                   │      │
│     │   📷  📁  ⬆️      │      │
│     │                   │      │
│     │   Upload Photos   │      │
│     │                   │      │
│     └───────────────────┘      │
│                                 │
│  Ankita (you)          Edit →  │
│                                 │
│  64 guests have shared 156     │
│  photos so far!                │
│                                 │
│  [Share this album with friends]│
│                                 │
└─────────────────────────────────┘
```

### Offline Upload Queue

```typescript
interface UploadQueueItem {
  id: string;
  file: File;
  eventSlug: string;
  uploadToken: string;
  status: 'queued' | 'uploading' | 'completed' | 'failed';
  progress: number;
  retryCount: number;
}

class UploadQueue {
  private db: IDBPDatabase;
  
  async enqueue(file: File, metadata: UploadMetadata): Promise<string> {
    // Store file in IndexedDB
    // Add to queue
    // Start processing if online
    // Register sync event for offline
  }

  async processQueue(): Promise<void> {
    // Upload each item
    // Handle retries with exponential backoff
    // Remove on success
    // Persist failed items for manual retry
  }

  async registerSync(): Promise<void> {
    // Register background sync via service worker
    // Sync when connection is restored
  }
}
```

### Guest Identity Persistence

```typescript
// Guest gets a device fingerprint + optional name cookie
// No login needed, but name persists across visits

function getGuestIdentity(): { id: string; name: string | null } {
  const fingerprint = getDeviceFingerprint(); // Hash of UA + screen + timezone
  const name = getCookie('guest_name');
  return { id: fingerprint, name };
}
```

### Upload Performance Targets

| Metric | Current | Target |
|--------|---------|--------|
| Time to interactive | ~3s | <1s |
| Upload start latency | ~2s | <200ms |
| Upload speed (10MB photo) | ~30s | <5s (compressed) |
| Photo compression | None | WebP, quality 85, ~2MB |
| Video compression | None | H.264, 1080p, ~5MB/min |
| Confirmation time | Instant | Upload while backgrounded |

---

## PHASE 9: PREMIUM FEATURES — DETAILED SPECS

### F9.1 — AI FACE RECOGNITION

**How it works:**
1. Media uploaded → Sent to Face Recognition service (AWS Rekognition / self-hosted DeepFace)
2. Detect faces → Generate embeddings (512-dim vector)
3. Cluster similar faces → Suggest person names
4. Couple reviews → Confirms names → All future photos auto-tagged

**Implementation:**
```typescript
// After upload completes
async function processMediaFaces(mediaId: string): Promise<void> {
  const media = await db.media.findUnique(mediaId);
  const imageBytes = await storage.download(media.storagePath);
  
  // Detect faces
  const faces = await faceDetection.detect(imageBytes);
  
  // Generate embeddings
  const embeddings = await Promise.all(
    faces.map(f => faceRecognition.embed(f.crop))
  );
  
  // Cluster with existing event faces
  const clusters = await clustering.assignToClusters(
    media.eventId,
    embeddings
  );
  
  // Store face metadata
  await db.face.createMany(
    clusters.map((c, i) => ({
      mediaId,
      boundingBox: faces[i].bbox,
      embedding: embeddings[i],
      personClusterId: c.clusterId,
      confidence: c.confidence,
    }))
  );
  
  // Auto-suggest person names for high-confidence matches
  const known = await db.personCluster.findMany({
    where: { eventId: media.eventId, name: { not: null } }
  });
  
  return { faces: clusters.length, known: known.length };
}
```

**UI:**
```
Photo Viewer →
  [Face Tag] Tap a face → "Who is this?"
  → Type name or select from suggestions
  → Auto-fill all photos with same person
  → "Find all photos of Priya" search
```

### F9.2 — SMART CULLING

**Filters available to owners:**
- Auto-reject blurry photos (Laplacian variance threshold)
- Auto-reject duplicates (perceptual hash, not SHA-256)
- Auto-reject closed-eye group (face landmark detection)
- Auto-reject underexposed (<10 lux equivalent)
- Keep only best from burst sequences

```typescript
interface CullingResult {
  mediaId: string;
  score: number;        // 0-100 quality score
  reasons: string[];    // Why this score
  action: 'keep' | 'reject' | 'flag';
  isDuplicate: boolean;
  isBlurry: boolean;
  isClosedEyes: boolean;
  isLowLight: boolean;
}

async function smartCull(mediaId: string): Promise<CullingResult> {
  const image = await loadImage(mediaId);
  
  return {
    score: await computeQualityScore(image),
    isBlurry: detectBlur(image) < threshold,
    isClosedEyes: await detectClosedEyes(image),
    isLowLight: image.exif?.iso > 3200 || detectNoise(image) > 0.3,
    isDuplicate: await findPerceptualDuplicates(mediaId),
  };
}
```

### F9.3 — AI HIGHLIGHT REEL

**Input:** All approved photos + videos + wedding date
**Output:** 60-second video with transitions + music

**Pipeline:**
1. Select top 30 photos (quality score + diversity)
2. Select top 3 video clips
3. Arrange chronologically
4. Add Ken Burns effect to photos
5. Crossfade transitions
6. Background music from royalty-free library
7. Overlay text: couple names + date + location

**Monetization:** $19 per reel OR included in Premium plan

### F9.4 — GUEST TIMELINE

Interactive timeline showing:
- When each guest uploaded
- What they uploaded (thumbnail preview)
- Time since wedding
- Animated scroll from start to present

Creates emotional experience: "Look, uncle just uploaded the ceremony!"

### F9.5 — LIVE UPLOAD FEED

Real-time feed for wedding venue screens:
- Auto-updating grid of new uploads
- Full-screen slideshow mode
- QR displayed alongside for more uploads
- Push to projector/TV via Chromecast

### F9.6 — COUPLE WEBSITE

Mini wedding website included in Premium:
- `/e/:slug` — Beautiful landing page
- Couple story + photos
- Event details + map
- Countdown timer
- Gift registry links
- Guest upload integration
- RSVP form (optional)

### F9.7 — CUSTOM DOMAIN

Couples can use their own domain:
- DNS setup wizard (CNAME record)
- Automatic SSL via Let's Encrypt
- White-label (no ShaadiShots branding)
- Custom email: memories@theirwedding.com

---

## PHASE 10: ADMIN & SUPER ADMIN CONSOLE

### ADMIN DASHBOARD — METRICS OVERVIEW

```
╔══════════════════════════════════════════════════════════════╗
║  ☰ Admin Console                    🔍 Search...  👤  ⚙️  ║
╠══════════════════════════════════════════════════════════════╣
║                                                            ║
║  Good morning, Aditya!             📅 Jul 2, 2026          ║
║                                                            ║
║  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     ║
║  │ $12,450  │ │ 2,341    │ │ 4,567    │ │ 89.2%    │     ║
║  │ MRR      │ │ Active   │ │ Events   │ │ Uptime   │     ║
║  │ ▲ 12%    │ │ Users    │ │ Created  │ │ This mo  │     ║
║  └──────────┘ └──────────┘ └──────────┘ └──────────┘     ║
║                                                            ║
║  ┌─────────────────────────────────────┐ ┌──────────────┐ ║
║  │ Revenue Trend (30 days)             │ │ Quick Actions│ ║
║  │                                     │ │ • New user   │ ║
║  │  ██▇█▆███▅▄▃▂▁▁  $12,450           │ │ • Add event  │ ║
║  │                                     │ │ • Broadcast  │ ║
║  └─────────────────────────────────────┘ │ • Export     │ ║
║                                          └──────────────┘ ║
║                                                            ║
║  ┌──────────────────────────────────────────────────────┐  ║
║  │ User Growth                  │ Plan Distribution     │  ║
║  │ ┌────────────────────────────┐│ ┌──────────────────┐ │  ║
║  │ │ ████████████░░░░ 1,200    ││ │ Free: 60%        │ │  ║
║  │ │ New this month             ││ │ Basic: 20%       │ │  ║
║  │ └────────────────────────────┘│ │ Premium: 15%     │ │  ║
║  │                              ││ │ Royal: 5%        │ │  ║
║  │ Churn: 3.2% (▼ 0.5%)        ││ └──────────────────┘ │  ║
║  └──────────────────────────────────────────────────────┘  ║
║                                                            ║
║  ┌─ Pending Reviews ───────────────────────────────────┐  ║
║  │ 12 events have pending media                        │  ║
║  │ [View all] [Send reminder]                          │  ║
║  └──────────────────────────────────────────────────────┘  ║
║                                                            ║
╚══════════════════════════════════════════════════════════════╝
```

### USER MANAGEMENT — DETAIL VIEW

```
╔══════════════════════════════════════════════════════════════╗
║  Users > Priya Sharma                                       ║
╠══════════════════════════════════════════════════════════════╣
║                                                            ║
║  ┌── Profile ─────────────────────────────────────────┐    ║
║  │ 👤 Priya Sharma         Role: Owner    Status: ● Active│  ║
║  │ priya@example.com       Plan: Premium                │  ║
║  │ Joined: Jan 15, 2026   Last Login: 2 hours ago      │  ║
║  │ [Edit] [Suspend] [Impersonate] [Delete]              │  ║
║  └────────────────────────────────────────────────────────┘ ║
║                                                            ║
║  ┌── Events (3) ──────────────────────────────────────────┐║
║  │ 🎉 Priya & Raj's Wedding   │ 156 media │ 85% storage │║
║  │ 🎉 Engagement Party        │ 45 media  │ 20% storage │║
║  │ 🎉 Mehendi Ceremony        │ 23 media  │ 10% storage │║
║  └────────────────────────────────────────────────────────┘║
║                                                            ║
║  ┌── Activity Timeline ───────────────────────────────────┐║
║  │ 2h ago  · Login · Chrome on Windows                   │║
║  │ 3h ago  · Approved 12 photos · Wedding album          │║
║  │ 1d ago  · Downloaded ZIP (156 items)                  │║
║  │ 3d ago  · Shared QR via WhatsApp                      │║
║  │ 5d ago  · Upgraded to Premium via Razorpay            │║
║  │ 7d ago  · Created event "Priya & Raj's Wedding"       │║
║  └────────────────────────────────────────────────────────┘║
║                                                            ║
║  ┌── Payments (5) ───────────────────────────────────────┐ ║
║  │ Feb 1  · Premium · $19  · Paid · INV-2026-00123      │ ║
║  │ Jan 1  · Basic   · $9   · Paid · INV-2026-00098      │ ║
║  └────────────────────────────────────────────────────────┘ ║
║                                                            ║
╚══════════════════════════════════════════════════════════════╝
```

### SUPER ADMIN — FEATURE FLAGS

```json
{
  "ai_face_recognition": { "enabled": true, "rollout": 50, "plans": ["premium", "royal"] },
  "custom_domain": { "enabled": true, "rollout": 100, "plans": ["royal"] },
  "highlight_reel": { "enabled": false, "rollout": 10, "plans": ["premium", "royal"] },
  "new_onboarding_flow": { "enabled": true, "rollout": 25, "plans": ["*"] },
  "guest_leaderboard": { "enabled": true, "rollout": 100, "plans": ["*"] }
}
```

Each flag has: `enabled`, `rolloutPercent`, `targetPlans`, `startDate`, `metrics` tracking conversion.

---

## PHASE 11: BACKEND ARCHITECTURE — COMPLETE REWRITE

### TECHNOLOGY STACK

```
┌──────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                             │
│  Next.js 14 (App Router) · Tailwind · Radix · Framer Motion │
│  React Query · Zustand · i18next · PWA · Service Worker     │
└──────────────────────────────────────────────────────────────┘
                            │ REST + WebSocket + Upload
┌──────────────────────────────────────────────────────────────┐
│                     API GATEWAY                              │
│  Cloudflare / AWS CloudFront                                 │
│  Rate limiting · WAF · DDoS protection · TLS termination    │
└──────────────────────────────────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────────┐
│                     APPLICATION LAYER                        │
│  Express/Fastify API (Node.js 20+, ESM, TypeScript)         │
│  GraphQL (Apollo) + REST (tRPC)                             │
│  Socket.IO for real-time                                     │
│  Middleware: Auth · Rate limit · Validation · Audit         │
└──────────────────────────────────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────────┐
│                     BACKGROUND WORKERS                       │
│  BullMQ (Redis-based job queue)                              │
│  Workers:                                                     │
│  ├── ThumbnailGenerator    — Sharp, multi-size              │
│  ├── VideoTranscoder       — FFmpeg, HLS + thumbnails       │
│  ├── FaceDetector          — AI face recognition            │
│  ├── NSFWScanner           — AI nudity detection            │
│  ├── VirusScanner          — ClamAV integration             │
│  ├── EmailDispatcher       — Resend/SendGrid                │
│  ├── ZipGenerator          — Background ZIP creation        │
│  ├── AnalyticsAggregator   — Hourly/daily rollups           │
│  └── CleanupWorker         — Temp files, expired tokens     │
└──────────────────────────────────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────────┐
│                     DATA LAYER                               │
│  PostgreSQL 16 (Primary + Read Replicas)                     │
│  Redis 7 (Cache + Queue + Session + Pub/Sub)                │
│  S3/R2 (Media storage + CDN origin)                         │
│  ElasticSearch (Full-text search)                            │
└──────────────────────────────────────────────────────────────┘
```

### API ARCHITECTURE

```typescript
// src/server.ts
import { createServer } from './app';
import { createWorker } from './workers';
import { connectDatabase } from './db';
import { connectRedis } from './redis';

async function bootstrap() {
  const db = await connectDatabase();
  const redis = await connectRedis();
  const app = await createServer(db, redis);
  const worker = await createWorker(db, redis);
  
  app.listen(3000);
  worker.run();
}

bootstrap();
```

### FOLDER STRUCTURE

```
src/
├── server.ts                  # Entry point
├── app.ts                     # Express app setup
├── config/
│   ├── index.ts               # Environment config
│   ├── plans.ts               # Plan definitions
│   ├── limits.ts              # Rate limits, quotas
│   └── features.ts            # Feature flags
│
├── db/
│   ├── client.ts              # Prisma client
│   ├── schema.prisma          # Database schema
│   ├── migrations/            # Prisma migrations
│   └── seeds/                 # Seed data
│
├── modules/                   # Feature modules
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.middleware.ts
│   │   ├── auth.schema.ts     # Zod validation
│   │   ├── strategies/        # Google, Apple, WhatsApp
│   │   └── __tests__/
│   │
│   ├── events/
│   │   ├── events.controller.ts
│   │   ├── events.service.ts
│   │   ├── events.schema.ts
│   │   ├── events.middleware.ts
│   │   └── __tests__/
│   │
│   ├── uploads/
│   │   ├── uploads.controller.ts
│   │   ├── uploads.service.ts
│   │   ├── uploads.validation.ts
│   │   ├── upload.queue.ts     # BullMQ queue
│   │   └── __tests__/
│   │
│   ├── media/
│   │   ├── media.controller.ts
│   │   ├── media.service.ts
│   │   ├── media.processor.ts  # Background jobs
│   │   └── __tests__/
│   │
│   ├── gallery/
│   ├── moderation/
│   ├── analytics/
│   ├── billing/
│   ├── admin/
│   ├── notifications/
│   ├── search/
│   └── ai/
│       ├── face.service.ts
│       ├── culling.service.ts
│       ├── nsfw.service.ts
│       └── highlight.service.ts
│
├── common/
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── csrf.ts
│   │   ├── rate-limit.ts
│   │   ├── audit.ts
│   │   ├── validate.ts
│   │   └── error-handler.ts
│   │
│   ├── services/
│   │   ├── storage/
│   │   │   ├── storage.interface.ts
│   │   │   ├── local.ts
│   │   │   ├── s3.ts
│   │   │   └── google-drive.ts
│   │   │
│   │   ├── email/
│   │   ├── sms/
│   │   ├── queue/
│   │   └── cache/
│   │
│   ├── errors/
│   │   ├── AppError.ts
│   │   ├── NotFoundError.ts
│   │   ├── ValidationError.ts
│   │   ├── AuthError.ts
│   │   └── QuotaError.ts
│   │
│   ├── types/
│   │   ├── express.d.ts
│   │   ├── event.ts
│   │   ├── media.ts
│   │   ├── user.ts
│   │   └── common.ts
│   │
│   ├── utils/
│   │   ├── logger.ts
│   │   ├── crypto.ts
│   │   ├── slug.ts
│   │   ├── pagination.ts
│   │   └── date.ts
│   │
│   └── constants/
│       ├── roles.ts
│       ├── plans.ts
│       ├── limits.ts
│       └── events.ts
│
├── lib/
│   ├── redis.ts
│   ├── prisma.ts
│   ├── queue.ts
│   └── sentry.ts
│
└── __tests__/
    ├── integration/
    ├── e2e/
    │   └── upload.spec.ts
    └── fixtures/
```

### DATABASE SCHEMA (PostgreSQL + Prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  owner
  super_admin
}

enum UserStatus {
  active
  suspended
  deleted
}

enum MediaStatus {
  pending
  approved
  rejected
}

enum MediaType {
  image
  video
}

enum StorageProvider {
  platform
  google_drive
  s3
  r2
}

enum PaymentStatus {
  pending
  paid
  failed
  refunded
}

model User {
  id            String     @id @default(uuid()) @db.Uuid
  name          String
  email         String     @unique
  emailVerified Boolean    @default(false)
  passwordHash  String?
  phoneNumber   String?    @unique
  googleId      String?    @unique
  appleId       String?    @unique
  avatarUrl     String?
  role          UserRole   @default(owner)
  status        UserStatus @default(active)
  twoFactorSecret String?
  twoFactorEnabled Boolean @default(false)
  
  // Subscription
  subscriptionId String?
  planSlug      String?
  trialEndsAt   DateTime?
  
  // Metadata
  lastLoginAt   DateTime?
  suspendedAt   DateTime?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  // Relations
  events        Event[]
  payments      Payment[]
  auditLogs     AuditLog[]
  sessions      Session[]
  
  @@index([email])
  @@index([role, status])
}

model Event {
  id            String   @id @default(uuid()) @db.Uuid
  ownerId       String   @db.Uuid
  owner         User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  
  title         String
  brideName     String?
  groomName     String?
  slug          String   @unique
  uploadToken   String   @unique
  weddingDate   DateTime?
  venue         String?
  city          String?
  
  // Plan & Storage
  planSlug      String   @default("free")
  storageLimitBytes BigInt
  storageProvider StorageProvider @default(platform)
  storageConfig Json?
  
  // Settings
  uploadEnabled    Boolean  @default(true)
  galleryEnabled   Boolean  @default(true)
  publicDownloadEnabled Boolean @default(false)
  galleryPinHash   String?
  customDomain     String?  @unique
  
  // Theme
  themeSlug       String   @default("classic-rose")
  coverPhotoUrl   String?
  accentColor     String   @default("#b83280")
  
  // Metadata
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  // Relations
  folders       Folder[]
  media         Media[]
  payments      Payment[]
  auditLogs     AuditLog[]
  
  @@index([ownerId])
  @@index([slug])
  @@index([planSlug])
  @@index([createdAt])
}

model Folder {
  id        String   @id @default(uuid()) @db.Uuid
  eventId   String   @db.Uuid
  event     Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  name      String
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  
  media     Media[]
  
  @@unique([eventId, name])
  @@index([eventId])
}

model Media {
  id            String      @id @default(uuid()) @db.Uuid
  eventId       String      @db.Uuid
  event         Event       @relation(fields: [eventId], references: [id], onDelete: Cascade)
  folderId      String      @db.Uuid
  folder        Folder      @relation(fields: [folderId], references: [id], onDelete: Cascade)
  
  uploaderName  String?
  uploaderSide  String?
  uploaderFingerprint String?
  
  originalName  String
  storedName    String
  storagePath   String
  thumbnailPath String?
  mimeType      String
  mediaType     MediaType
  sizeBytes     BigInt
  
  sha256        String
  phash         String?     // Perceptual hash for duplicate detection
  
  status        MediaStatus @default(pending)
  qualityScore  Float?      // 0-100 AI quality score
  isNsfw        Boolean     @default(false)
  isFlagged     Boolean     @default(false)
  
  // AI metadata
  faceCount     Int?
  hasSmiles     Boolean?
  isBlurry      Boolean?
  dominantColors String[]?
  
  // Dates
  approvedAt    DateTime?
  rejectedAt    DateTime?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  
  // Relations
  faces         Face[]
  
  @@index([eventId, status])
  @@index([eventId, sha256])
  @@index([phash])
  @@index([createdAt])
}

model Face {
  id              String   @id @default(uuid()) @db.Uuid
  mediaId         String   @db.Uuid
  media           Media    @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  
  boundingBox     Json     // { x, y, width, height }
  embedding       Bytes    // 512-dim vector
  personClusterId String?  @db.Uuid
  
  confidence      Float
  createdAt       DateTime @default(now())
  
  @@index([personClusterId])
}

model PersonCluster {
  id        String   @id @default(uuid()) @db.Uuid
  eventId   String   @db.Uuid
  event     Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  
  name      String?  // Assigned by couple
  faceCount Int      @default(0)
  coverFace String?  // URL to best face thumbnail
  createdAt DateTime @default(now())
  
  faces     Face[]
  
  @@unique([eventId, name])
  @@index([eventId])
}

model Payment {
  id            String        @id @default(uuid()) @db.Uuid
  userId        String?       @db.Uuid
  user          User?         @relation(fields: [userId], references: [id])
  eventId       String?       @db.Uuid
  event         Event?        @relation(fields: [eventId], references: [id])
  
  planName      String
  amount        Int
  currency      String        @default("INR")
  status        PaymentStatus @default(pending)
  provider      String?       // stripe, razorpay, manual
  providerId    String?       // Stripe payment intent ID
  invoiceId     String?       @unique
  
  metadata      Json?
  
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  
  @@index([userId])
  @@index([eventId])
  @@index([status])
}

model AuditLog {
  id          String   @id @default(uuid()) @db.Uuid
  actorId     String?  @db.Uuid
  actor       User?    @relation(fields: [actorId], references: [id])
  eventId     String?  @db.Uuid
  event       Event?   @relation(fields: [eventId], references: [id])
  
  action      String
  metadata    Json?
  ipAddress   String?
  userAgent   String?
  
  createdAt   DateTime @default(now())
  
  @@index([actorId])
  @@index([eventId])
  @@index([action])
  @@index([createdAt])
}

model Session {
  id          String   @id @default(uuid()) @db.Uuid
  userId      String   @db.Uuid
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  token       String   @unique
  deviceInfo  String?
  ipAddress   String?
  lastActive  DateTime @default(now())
  
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  
  @@index([userId])
  @@index([token])
}

model ApiKey {
  id          String   @id @default(uuid()) @db.Uuid
  userId      String?  @db.Uuid
  name        String
  key         String   @unique
  scopes      String[] // ["events:read", "media:write"]
  lastUsed    DateTime?
  expiresAt   DateTime?
  createdAt   DateTime @default(now())
  
  @@index([key])
}
```

### BACKGROUND JOB QUEUES (BullMQ)

```typescript
// upload.queue.ts
import { Queue, Worker } from 'bullmq';

export const uploadQueue = new Queue('media-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600 * 24 },
    removeOnFail: { age: 3600 * 24 * 7 },
  },
});

// Jobs
await uploadQueue.add('thumbnail', { mediaId }, { priority: 1 });
await uploadQueue.add('face-detect', { mediaId }, { priority: 2 });
await uploadQueue.add('nsfw-scan', { mediaId }, { priority: 1 });
await uploadQueue.add('virus-scan', { mediaId }, { priority: 3 });
await uploadQueue.add('strip-metadata', { mediaId }, { priority: 1 });
```

---

## PHASE 12: SECURITY — ENTERPRISE-GRADE

### AUTHENTICATION LAYER

```
┌──────────────────────────────────────────────┐
│              AUTH STRATEGIES                  │
├──────────────────────────────────────────────┤
│  Password (bcrypt, 12 rounds)                │
│  Google SSO (OAuth 2.0)                      │
│  Apple SSO (OAuth 2.0 + private relay)       │
│  WhatsApp OTP (passwordless)                 │
│  Magic Link (email)                          │
│  Passkeys (WebAuthn, FIDO2)                  │
│  API Keys (for integrations)                 │
└──────────────────────────────────────────────┘
```

### JWT STRATEGY

```typescript
// Access Token (15 min) — short-lived, in memory
// Refresh Token (7 days) — HTTP-only cookie, rotated
// Session Token (30 days) — For "remember me"

function generateTokens(user: User): TokenPair {
  const accessToken = jwt.sign(
    { sub: user.id, role: user.role },
    config.jwt.accessSecret,
    { expiresIn: '15m' }
  );
  
  const refreshToken = jwt.sign(
    { sub: user.id, tokenVersion: user.tokenVersion },
    config.jwt.refreshSecret,
    { expiresIn: '7d' }
  );
  
  return { accessToken, refreshToken };
}

// Rotation: Every refresh invalidates old refresh token
// Revocation: Increment tokenVersion to invalidate all sessions
```

### RATE LIMITING (Multi-Layer)

```typescript
// Layer 1: Global (IP-based)
// Layer 2: Per-route (auth, upload, API)
// Layer 3: Per-user (authenticated)
// Layer 4: Per-API-key (developer)

const rateLimitConfig = {
  global: { window: '15m', max: 500 },
  auth: { window: '15m', max: 10 },
  upload: { window: '15m', max: 40 },
  api: { window: '1m', max: 100 },
  apiKey: { window: '1m', max: 1000 },
};
```

### FILE UPLOAD SECURITY

```typescript
// 1. File extension check (quick)
// 2. Magic byte validation (accurate, `file-type`)
// 3. Virus scan (ClamAV, async)
// 4. NSFW detection (AI, async)
// 5. EXIF stripping (GPS removal)
// 6. SHA-256 dedup (prevent duplicates)
// 7. File size enforcement (per-plan limits)
// 8. Storage quota check (per-event)
// 9. Virus: auto-reject infected
// 10. NSFW: auto-flag for review
```

### WEBHOOK SECURITY

```typescript
// Every webhook request includes:
// 1. Signature: HMAC-SHA256 of payload + secret
// 2. Timestamp: Reject if >5 min old
// 3. Idempotency key: Prevent duplicate processing

function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return timingSafeEqual(signature, expected);
}
```

### COMPLETE SECURITY CHECKLIST

| Control | Current | Target | Priority |
|---------|---------|--------|----------|
| CSP with nonces | 'unsafe-inline' | Nonce-based scripts | Critical |
| HSTS | Missing | max-age=31536000; includeSubDomains | Critical |
| Expect-CT | Missing | Enforce for certificate transparency | High |
| Permissions-Policy | Missing | Restrict camera, mic, geolocation | High |
| SRI for CDN scripts | Missing | integrity attribute on all CDN | High |
| API keys | Missing | Scoped, revocable, rate-limited | High |
| Session management | None | View/revoke active sessions | High |
| WebAuthn/Passkeys | None | Phishing-resistant MFA | High |
| Email verification | None | Verify before access | Medium |
| Login notifications | None | Email on new device/ip | Medium |
| Backup codes | None | Recovery on 2FA loss | Medium |
| Brute force lockout | None | Progressive lockout | Medium |
| Virus scanning | None | ClamAV on upload | High |
| Rate limit per user | IP only | User-based limits | Medium |
| Audit log retention | Unlimited | 90-day rotation + export | Medium |
| GDPR data export | None | One-click export | High |
| GDPR account deletion | Manual | Automated with confirm | High |
| Secrets rotation | Manual | Automated via vault | Medium |
| Penetration testing | None | Annual third-party audit | High |
| Bug bounty program | None | HackerOne / private invite | Low |
