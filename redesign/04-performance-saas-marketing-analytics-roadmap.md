# SHAADISHOTS REDESIGN — PHASE 13-17

## PHASE 13: PERFORMANCE ENGINEERING

### CORE WEB VITALS TARGETS

| Metric | Current (EJS) | Target (Next.js) | Tool |
|--------|---------------|------------------|------|
| LCP | ~3.5s | <1.5s | CDN + Image opt + ISR |
| FID | ~150ms | <50ms | Code splitting + lazy JS |
| CLS | ~0.15 | <0.05 | Explicit dimensions + skeleton |
| TTFB | ~500ms | <100ms | CDN + edge caching |
| INP | ~250ms | <100ms | Debounced handlers + workers |
| SI | ~4s | <2s | Critical CSS + preload |

### IMAGE OPTIMIZATION PIPELINE

```
Upload → 
  ├── Original → Store raw in S3/R2 (cold storage)
  ├── 1920px → Gallery display, WebP, quality 85
  ├── 800px  → Grid thumbnail, WebP, quality 80
  ├── 400px  → Card thumbnail, WebP, quality 75
  ├── 200px  → Blur placeholder, WebP, quality 20
  └── Tiny placeholder → LQIP (10x10px, base64 inline)

All generated via Sharp worker. CDN cached with 1-year TTL.
```

### VIDEO OPTIMIZATION

```
Upload →
  └── FFmpeg transcoding pipeline:
      ├── HLS (master.m3u8 + 480p/720p/1080p segments)
      ├── Thumbnail (at 10s, 30s, 60s)
      ├── GIF preview (3-second, 480px wide)
      └── Progressive WebM fallback
```

### CACHING STRATEGY

```typescript
// Layer 1: CDN (Cloudflare)
// Static assets: 1 year immutable
// Public pages (landing, pricing): 1 hour, stale-while-revalidate
// Gallery thumbnails: 1 week
// API responses: vary by auth

// Layer 2: Redis
// Session data: 7 days
// User profile: 5 minutes (or until DB update)
// Event meta (storage, counts): 1 minute
// Plan definitions: 1 hour
// Feature flags: 5 minutes
// Rate limit counters: sliding window

// Layer 3: React Query (client)
// Stale: 30 seconds
// Cache: 5 minutes
// Background refetch on window focus
// Optimistic updates for mutations

// Layer 4: Next.js ISR
// Marketing pages: on-demand revalidation
// Gallery pages: revalidate on media change
```

### DATABASE PERFORMANCE

```typescript
// Indexes to add
CREATE INDEX CONCURRENTLY idx_media_quality ON media(quality_score DESC) WHERE status = 'approved';
CREATE INDEX CONCURRENTLY idx_media_phash ON media USING hash(phash);
CREATE INDEX CONCURRENTLY idx_events_owner_plan ON events(owner_id, plan_slug);
CREATE INDEX CONCURRENTLY idx_audit_created ON audit_logs(created_at DESC);

// Materialized view for dashboard
CREATE MATERIALIZED VIEW mv_event_stats AS
SELECT 
  e.id, e.owner_id, e.plan_slug,
  COUNT(m.id) AS media_count,
  COALESCE(SUM(m.size_bytes), 0) AS storage_used,
  COUNT(*) FILTER (WHERE m.status = 'pending') AS pending_count,
  COUNT(DISTINCT m.uploader_fingerprint) AS guest_count
FROM events e
LEFT JOIN media m ON m.event_id = e.id
GROUP BY e.id;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_event_stats;
```

### FRONTEND BUNDLE OPTIMIZATION

```
Current (EJS): N/A — no bundle
Target (Next.js):

Route-Based Code Splitting:
  / → 45KB JS + 8KB CSS (landing)
  /dashboard → 120KB JS + 20KB CSS
  /e/:slug/upload → 35KB JS + 12KB CSS (ultra-light)
  /admin → 200KB JS + 30KB CSS

Libraries (optimized):
  Framer Motion: tree-shaken to 8KB
  Radix UI: tree-shaken per component ~3KB each
  React Query: 12KB
  date-fns: tree-shaken ~5KB
  Zod: 8KB (runtime)

Total first load: <100KB JS + <20KB CSS
Repeat load: <10KB (service worker cache)
```

### PERFORMANCE BUDGET

| Asset | Budget | Enforcement |
|-------|--------|-------------|
| Total page weight | <500KB | Lighthouse CI |
| JS bundle (initial) | <100KB | Bundle analyzer |
| CSS (critical) | <15KB | Inline in `<head>` |
| Fonts | <30KB | Self-hosted, subset |
| Images (per photo) | <200KB | Sharp compression |
| API response (list) | <50KB | Pagination + field selection |
| Time to First Byte | <200ms | CDN + Redis |

---

## PHASE 14: SAAS FEATURES — MONETIZATION ENGINE

### PRICING TIERS

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PLAN COMPARISON                              │
├──────────────┬──────────────┬──────────────┬──────────────┬─────────┤
│              │    FREE      │    BASIC     │   PREMIUM    │  ROYAL  │
├──────────────┼──────────────┼──────────────┼──────────────┼─────────┤
│ Price        │    $0        │   $9/mo      │  $19/mo      │ $49/mo  │
│              │              │   $89/yr     │  $189/yr     │$489/yr  │
├──────────────┼──────────────┼──────────────┼──────────────┼─────────┤
│ Events       │    1         │    3         │   10         │Unlimited│
│ Photos       │   100        │   500        │  5,000       │ 50,000  │
│ Videos       │   10         │   50         │   500        │ 5,000   │
│ Storage      │  500MB       │   5GB        │   50GB       │ 500GB   │
├──────────────┼──────────────┼──────────────┼──────────────┼─────────┤
│ Video Upload │    ❌        │    ✅        │    ✅        │   ✅    │
│ PIN Gallery  │    ❌        │    ✅        │    ✅        │   ✅    │
│ ZIP Download │    ❌        │    ✅        │    ✅        │   ✅    │
│ Custom Domain│    ❌        │    ❌        │    ✅        │   ✅    │
│ AI Tagging   │    ❌        │    ❌        │    ✅        │   ✅    │
│ Smart Culling│    ❌        │    ❌        │    ✅        │   ✅    │
│ Highlight Reel│   ❌        │    ❌        │   $19       │   ✅    │
│ White Label  │    ❌        │    ❌        │    ❌        │   ✅    │
│ API Access   │    ❌        │    ❌        │    ❌        │   ✅    │
│ Priority Support│ ❌        │    ❌        │    ❌        │   ✅    │
└──────────────┴──────────────┴──────────────┴──────────────┴─────────┘

Annual: 20% discount, highlighted as "Save 20%" 
Free Trial: 14 days Premium, no credit card required
Money-back: 30-day guarantee on paid plans
```

### SUBSCRIPTION LIFECYCLE

```
Signup → Free Tier
  ├── User hits Free limit → Upgrade prompt at 80% usage
  │   └── Upgrade to Basic/Premium
  │       ├── Active subscriber
  │       │   ├── Renewal (monthly/annual)
  │       │   ├── Downgrade (at period end, data preserved)
  │       │   ├── Upgrade (immediate, prorated)
  │       │   └── Cancel (at period end, data preserved 90 days)
  │       └── Expired → Grace period (7 days, read-only)
  │           └── Final → Data archived (90 days), then deleted
  └── User inactive 30 days → Re-engagement email sequence
```

### BILLING INTEGRATIONS

```typescript
// Multi-provider strategy
// India: Razorpay (primary) + Stripe (backup)
// International: Stripe (primary)
// Enterprise: Invoice-based (manual)

interface BillingProvider {
  createSubscription(user: User, plan: Plan): Promise<Subscription>;
  cancelSubscription(id: string): Promise<void>;
  updateSubscription(id: string, plan: Plan): Promise<Subscription>;
  generateInvoice(payment: Payment): Promise<string>; // PDF URL
  handleWebhook(payload: any): Promise<void>;
}
```

### COUPONS & PROMOTIONS

```typescript
interface Coupon {
  code: string;
  type: 'percent' | 'fixed' | 'free_months';
  value: number; // 20, 500, 2
  maxRedemptions: number;
  expiresAt: Date;
  applicablePlans: string[]; // ['basic', 'premium', 'royal']
  firstTimeOnly: boolean;
}
```

### REFERRAL PROGRAM

```
Referrer: Gets 1 month free per successful referral (up to 6 months)
Referred: Gets 20% off first 3 months
Mechanism: Unique referral link → signup → tracks via cookie + utm
Payout: Auto-apply credit to next billing cycle
```

---

## PHASE 15: MARKETING & GROWTH

### LANDING PAGE — CONVERSION OPTIMIZED

```
ABOVE THE FOLD (0-3s):
  Headline: "Every wedding photo, effortlessly collected."
  Subhead: "Guests scan QR. Photos upload instantly. You keep every memory."
  CTA: "Start Free Trial" (Primary) + "See Demo" (Secondary)
  Proof: "Trusted by 10,000+ couples worldwide"
  Visual: Live demo of upload → gallery flow (30s interactive)

BELOW THE FOLD:
  How it works (3 card steps)
  Feature grid (6 features with icons)
  Template showcase (carousel of 4 themes)
  Social proof (3 testimonial cards with photos + names)
  Pricing table (4 tiers, toggle monthly/annual)
  FAQ (8 questions, accordion)
  Final CTA: "Start collecting memories today"
```

### SEO STRATEGY

```typescript
// Technical
{
  "sitemap": "/sitemap.xml",
  "robots": "/robots.txt",
  "structuredData": {
    "@type": "SoftwareApplication",
    "name": "ShaadiShots",
    "applicationCategory": "Multimedia",
    "operatingSystem": "Web",
    "offers": {
      "@type": "AggregateOffer",
      "priceCurrency": "USD",
      "lowPrice": "0",
      "highPrice": "49"
    }
  },
  "canonicalUrls": true,
  "openGraph": {
    "title": "ShaadiShots - Wedding Photo Collection via QR",
    "description": "Guests scan QR. Photos upload instantly. Beautiful galleries.",
    "image": "/og-image.png",
    "type": "website"
  }
}

// Content Pillars
1. "How to Collect Wedding Photos from Guests" (guide)
2. "10 Best Wedding QR Code Ideas" (listicle)
3. "Digital vs Physical Wedding Guest Book" (comparison)
4. "Wedding Photo Collection Checklist" (template)
5. "ShaadiShots vs Google Drive vs WhatsApp" (comparison)

// Landing Pages
- /wedding-photo-app
- /qr-wedding-guest-book
- /wedding-gallery-app
- /wedding-photo-sharing
- City pages: /mumbai, /delhi, /bangalore (with local testimonials)
```

### EMAIL MARKETING

```typescript
// Transactional (triggered)
const emails = {
  // Activation
  'welcome': { sendAt: 'immediately', template: 'welcome' },
  'onboarding_step1': { sendAt: '1h', template: 'setup_album' },
  'onboarding_step2': { sendAt: '24h', template: 'share_qr' },
  'onboarding_step3': { sendAt: '72h', template: 'moderate_photos' },
  
  // Engagement
  'first_upload': { sendAt: 'on_event', template: 'guest_uploaded' },
  'gallery_milestone': { sendAt: 'on_event', template: 'milestone_reached' },
  'inactive_7d': { sendAt: '7d_inactive', template: 'come_back' },
  'inactive_30d': { sendAt: '30d_inactive', template: 'we_miss_you' },
  
  // Conversion
  'trial_ending': { sendAt: '2d_before', template: 'upgrade_offer' },
  'storage_80': { sendAt: 'on_event', template: 'storage_full_soon' },
  'upgrade_offer': { sendAt: 'on_event', template: 'special_offer' },
  
  // Retention
  'anniversary_1yr': { sendAt: '1_year', template: 'relive_memories' },
  'referral_invite': { sendAt: '30d', template: 'refer_friend' },
};
```

### SOCIAL MEDIA STRATEGY

| Platform | Content Type | Frequency | Goal |
|----------|-------------|-----------|------|
| Instagram | Reels (upload flow, gallery tour) | Daily | Awareness |
| Instagram | Stories (tips, testimonials) | Daily | Engagement |
| Pinterest | Wedding inspiration boards | Weekly | SEO + Discovery |
| Twitter/X | Product updates, wedding tips | 3x/week | Community |
| LinkedIn | B2B (photographers, planners) | 2x/week | Enterprise |
| YouTube | Tutorials, customer stories | Weekly | Trust |
| Facebook | Wedding groups, community | 3x/week | Engagement |

### GO-TO-MARKET STRATEGY

```
Phase 1 (Launch): India market
  - Partnerships with 50 wedding photographers
  - Wedding forum presence (Shaadi.com, WeddingWire India)
  - Google Ads: "wedding photo collection app"
  - Launch discount: 50% off first 3 months

Phase 2 (3 months): Indian wedding season push
  - Instagram influencer campaign (10 micro-influencers)
  - Wedding exhibition booths (target: 5 major cities)
  - Referral program launch
  - Case studies with 5 featured couples

Phase 3 (6 months): International expansion
  - Stripe activation for global payments
  - Multi-language: Hindi, Spanish, Arabic
  - US wedding market: The Knot partnership
  - Content localization for target regions

Phase 4 (12 months): Platform play
  - Photographer marketplace launch
  - API for third-party integrations
  - Wedding planner agency tier
  - White-label for enterprise
```

---

## PHASE 16: ANALYTICS & DATA

### PRODUCT ANALYTICS (PostHog / Mixpanel)

```typescript
// Events to track
const events = {
  // Signup funnel
  'landing_page_visit': {},
  'signup_started': { method: 'email' | 'google' | 'apple' | 'whatsapp' },
  'signup_completed': {},
  'email_verified': {},
  
  // Onboarding
  'onboarding_started': {},
  'onboarding_step_completed': { step: 1 | 2 | 3 | 4 },
  'onboarding_completed': {},
  
  // Event creation
  'event_created': { plan: 'free' | 'basic' | 'premium' | 'royal' },
  'event_configured': { hasPin, hasCustomDomain },
  'qr_downloaded': { format: 'png' | 'pdf' | 'svg' },
  'qr_shared': { method: 'whatsapp' | 'sms' | 'email' | 'copy' },
  
  // Upload & Media
  'guest_uploaded': { count: number, eventId },
  'media_approved': { count: number, method: 'swipe' | 'bulk' | 'single' },
  'media_rejected': { count: number },
  'album_downloaded': { count: number, method: 'zip' | 'photo_book' },
  
  // Billing
  'plan_viewed': { plan: string },
  'upgrade_started': { from: string, to: string },
  'upgrade_completed': { from: string, to: string, amount: number },
  'subscription_cancelled': { reason: string },
  'trial_started': {},
  'trial_converted': {},
  
  // Engagement
  'gallery_viewed': { eventId },
  'lightbox_opened': { mediaId },
  'photo_liked': {},
  'comment_added': {},
  'guest_shared_gallery': {},
  'notification_clicked': { type: string },
};
```

### FUNNEL ANALYSIS

```
Signup Funnel:
  Landing → 100%
  Signup started → 45%
  Signup completed → 35%
  Onboarding started → 30%
  Onboarding completed → 25%
  QR shared → 20%
  First guest upload → 15%
  
Activation Funnel:
  Created event → 100%
  Shared QR → 80%
  Got first upload → 60%
  Moderation completed → 45%
  Gallery shared → 35%
  → ACTIVATED (got first upload + shared gallery)
  
Conversion Funnel:
  Free user → 100%
  Hit limit → 60%
  Viewed pricing → 35%
  Started trial → 20%
  Converted to paid → 12%
  
Retention (weekly active):
  Week 1 → 100%
  Week 2 → 65%
  Week 4 → 45%
  Week 8 → 35%
  Week 12 → 30%
  Week 24 → 25%
```

### DASHBOARD — PRODUCT MANAGER VIEW

```
╔══════════════════════════════════════════════════════════════╗
║  PRODUCT ANALYTICS                              Last 30 days║
╠══════════════════════════════════════════════════════════════╣
║                                                            ║
║  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     ║
║  │ 3,450    │ │ 25.3%    │ │ 12.4%    │ │ 3.2%     │     ║
║  │ Signups  │ │ Activation│ │ Conversion│ │ Churn    │     ║
║  │ ▲ 8%    │ │ ▲ 2%     │ │ ▼ 0.5%   │ │ ▼ 0.3%   │     ║
║  └──────────┘ └──────────┘ └──────────┘ └──────────┘     ║
║                                                            ║
║  ┌─ Signup Funnel ───────────────────────────────────────┐ ║
║  │ Landing Page          100% ████████████████  10,000   │ ║
║  │ Signup Started         45% ███████░░░░░░░░   4,500   │ ║
║  │ Signup Completed       35% █████░░░░░░░░░░   3,500   │ ║
║  │ Onboarding Done        25% ████░░░░░░░░░░░   2,500   │ ║
║  │ First Upload           15% ██░░░░░░░░░░░░░   1,500   │ ║
║  │ Activated              12% ██░░░░░░░░░░░░░   1,200   │ ║
║  └────────────────────────────────────────────────────────┘ ║
║                                                            ║
║  ┌─ Retention Cohorts ───────────────────────────────────┐ ║
║  │              W1   W2   W4   W8   W12  W24             │ ║
║  │ Jan 2026   100%  68%  48%  36%  30%  25%             │ ║
║  │ Feb 2026   100%  70%  50%  38%  32%  -               │ ║
║  │ Mar 2026   100%  72%  52%  40%  -    -               │ ║
║  └────────────────────────────────────────────────────────┘ ║
║                                                            ║
║  ┌─ A/B Test: Pricing Page ─────────────────────────────┐  ║
║  │ Variant A (current): 2.4% conversion                 │  ║
║  │ Variant B (new):      3.1% conversion  ▲ 29%         │  ║
║  │ Confidence: 95% · Duration: 14 days · Status: Active │  ║
║  └────────────────────────────────────────────────────────┘ ║
║                                                            ║
╚══════════════════════════════════════════════════════════════╝
```

---

## PHASE 17: COMPLETE PRIORITIZED ROADMAP

### PRIORITY MATRIX

| Priority | Definition | Timeline | Effort |
|----------|-----------|----------|--------|
| **P0 — Critical** | Platform will fail without this | Week 1-4 | Highest |
| **P1 — High** | Blocks growth / user acquisition | Month 2-3 | High |
| **P2 — Medium** | Significant UX or revenue improvement | Month 3-6 | Medium |
| **P3 — Low** | Delightful but not urgent | Month 6-9 | Low-Medium |
| **P4 — Future** | Strategic expansion | Month 9+ | Variable |

---

### SPRINT PLAN (12 Weeks)

```
WEEK 1-2: FOUNDATION
┌────────────────────────────────────────────────────────────────────┐
│ P0 │ PostgreSQL Migration                                         │
│ P0 │ TypeScript + Prisma Setup                                    │
│ P0 │ Redis Cache Layer                                            │
│ P0 │ CI/CD Pipeline (GitHub Actions)                              │
│ P0 │ Error Monitoring (Sentry)                                    │
│ P1 │ Automated Testing Framework (Jest + Playwright)              │
│ P1 │ Basic Next.js App Router Setup                               │
└────────────────────────────────────────────────────────────────────┘

WEEK 3-4: AUTH & USER MANAGEMENT
┌────────────────────────────────────────────────────────────────────┐
│ P0 │ Auth Rewrite (JWT access/refresh tokens)                     │
│ P0 │ Session Management + Revocation                              │
│ P1 │ Passkeys / WebAuthn Support                                  │
│ P1 │ Email Verification Flow                                      │
│ P1 │ Login Notification Alerts                                    │
│ P1 │ Rate Limiting Per User (Redis)                               │
│ P2 │ Magic Link Authentication                                    │
└────────────────────────────────────────────────────────────────────┘

WEEK 5-6: CORE FEATURES MIGRATION
┌────────────────────────────────────────────────────────────────────┐
│ P0 │ Event CRUD (Create, Read, Update, Delete)                    │
│ P0 │ Media Upload Pipeline                                        │
│ P0 │ Gallery View (Public)                                        │
│ P1 │ Swipe Moderation Interface                                   │
│ P1 │ Guest Upload Redesign (Zero Friction)                        │
│ P1 │ QR Code Generation + Share Hub                               │
│ P2 │ Onboarding Wizard (4 Steps)                                  │
└────────────────────────────────────────────────────────────────────┘

WEEK 7-8: BILLING & PLANS
┌────────────────────────────────────────────────────────────────────┐
│ P1 │ Stripe Integration (Subscriptions)                           │
│ P1 │ Razorpay Integration                                         │
│ P1 │ Plan Management (CRUD)                                       │
│ P1 │ Usage Limits Enforcement                                     │
│ P1 │ Invoice Generation                                           │
│ P2 │ Coupon & Discount System                                     │
│ P2 │ Referral Program                                             │
└────────────────────────────────────────────────────────────────────┘

WEEK 9-10: AI & PREMIUM
┌────────────────────────────────────────────────────────────────────┐
│ P1 │ AI Face Detection Pipeline                                   │
│ P1 │ Smart Culling (Blur, Duplicate, Exposure)                    │
│ P2 │ NSFW Detection (ML upgrade)                                  │
│ P2 │ Auto-Album Generation (Face Clustering)                      │
│ P2 │ AI Highlight Reel                                            │
│ P3 │ Guest Timeline Feature                                       │
└────────────────────────────────────────────────────────────────────┘

WEEK 11-12: ADMIN, ANALYTICS, PERFORMANCE
┌────────────────────────────────────────────────────────────────────┐
│ P1 │ Super Admin Dashboard (Revenue, Users, Events)               │
│ P1 │ Product Analytics (PostHog Events)                           │
│ P1 │ Feature Flag System                                          │
│ P2 │ Image CDN + Optimization Pipeline                            │
│ P2 │ Admin User Management (Search, Filters, Impersonate)         │
│ P2 │ Webhook System + API Keys                                    │
│ P3 │ GDPR Compliance Tools                                        │
│ P3 │ Draft Marketing Site (Pricing, Features, Blog)               │
└────────────────────────────────────────────────────────────────────┘
```

### QUARTERLY ROADMAP

```
Q3 2026 (Jul-Sep) — RESCUE & FOUNDATION
├── PostgreSQL migration (P0)
├── TypeScript + Prisma (P0)
├── Testing + CI/CD (P0)
├── Next.js migration (P1)
├── Auth rewrite (P0)
├── Session management (P1)
├── Guest upload redesign (P1)
├── Swipe moderation (P1)
└── Basic marketing pages (P1)

Q4 2026 (Oct-Dec) — GROWTH
├── Stripe + Razorpay billing (P1)
├── Plan management (P1)
├── AI face detection (P1)
├── Smart culling (P1)
├── Onboarding wizard (P2)
├── Referral program (P2)
├── Admin dashboard (P1)
├── Product analytics (P1)
└── Image optimization (P2)

Q1 2027 (Jan-Mar) — DELIGHT
├── AI highlight reel (P2)
├── Guest timeline (P3)
├── Custom domains (P2)
├── Couple website (P3)
├── Photo book printing (P3)
├── Dark mode (P2)
├── Multi-language (P2)
├── API + webhooks (P2)
└── Feature flags (P1)

Q2 2027 (Apr-Jun) — SCALE
├── Mobile native apps (P4)
├── Photographer marketplace (P4)
├── White-label (P3)
├── Enterprise SSO (P4)
├── Live slideshow (P3)
├── Vendor tools (P4)
├── Global CDN + multi-region (P4)
└── Performance optimization (P2)
```

### EFFORT vs IMPACT MATRIX

```
                    HIGH IMPACT
                        │
  High Effort      ┌────┼────┐      Low Effort
                   │ P0 │ P1 │
    PostgreSQL     │    │    │  Guest Upload Redesign
    AI Face Recog  │    │    │  Swipe Moderation
    Stripe Billing │    │    │  Notifications
    Next.js Migr.  │    │    │  Onboarding Wizard
    Admin Dashboard│    │    │  Dark Mode
                   │    │    │  Error Monitoring
                   ├────┼────┤
                   │ P2 │ P3 │
    Video Transcode│    │    │  Photo Book Printing
    Multi-language │    │    │  Guest Leaderboard
    Native Apps    │    │    │  Anniversary Reminders
    Live Slideshow │    │    │  SEO Improvements
    White-label    │    │    │  FAQ Accordion
                   └────┴────┘
                    LOW IMPACT
```

### BUSINESS CASE — ESTIMATED ROI

| Initiative | Cost (est.) | Revenue Impact | Timeline | ROI |
|------------|-------------|----------------|----------|-----|
| **PostgreSQL + Redis** | $5K eng | Prevents churn at scale | 2 weeks | ∞ (prevents failure) |
| **Guest Upload Redesign** | $8K eng | +40% upload completion | 2 weeks | ~$50K/yr |
| **Swipe Moderation** | $4K eng | +25% moderation rate | 1 week | ~$20K/yr (retention) |
| **Stripe Billing** | $10K eng | 10x MRR increase | 3 weeks | ~$500K/yr |
| **Onboarding Wizard** | $6K eng | +50% activation | 2 weeks | ~$100K/yr |
| **AI Face Recognition** | $15K eng + $2K/mo infra | Premium upsell driver | 4 weeks | ~$50K/yr |
| **Referral Program** | $3K eng | 30% organic growth | 1 week | ~$30K/yr |
| **Marketing Site** | $8K design + eng | Direct conversion boost | 3 weeks | ~$100K/yr |
| **Email Automation** | $5K eng + $500/mo | +20% retention | 2 weeks | ~$200K/yr |

### KEY METRICS TARGET — 12 MONTHS

| Metric | Current (est.) | 3 Months | 6 Months | 12 Months |
|--------|---------------|----------|----------|-----------|
| Monthly Active Users | ~500 | 2,000 | 8,000 | 25,000 |
| Events Created/Month | ~50 | 300 | 1,500 | 5,000 |
| Guest Upload Rate | ~30% | 50% | 65% | 75% |
| Activation Rate | ~25% | 45% | 60% | 70% |
| D7 Retention | ~20% | 40% | 55% | 65% |
| Free → Paid Conversion | ~2% | 5% | 8% | 12% |
| MRR | ~$500 | $5,000 | $25,000 | $100,000 |
| ARPU | ~$2 | $5 | $8 | $12 |
| Churn (monthly) | ~15% | 8% | 5% | 3% |
| LTV | ~$13 | $62 | $160 | $400 |
| NPS | ~20 | 40 | 50 | 60 |
| Page Load (LCP) | ~3.5s | 1.5s | 1.0s | 0.8s |
| Lighthouse Score | ~60 | 85 | 90 | 95+ |
| Support Tickets/Month | ~100 | 200 | 300 | 500 |
| Support Satisfaction | ~70% | 85% | 90% | 95% |

---

# EXECUTIVE SUMMARY — THE 5 CRITICAL ACTIONS

## If you do NOTHING else, do these 5 things:

### 1. FIX THE DATABASE (Week 1-2)
SQLite will kill you at 500 events. Migrate to PostgreSQL with Prisma. This is not optional.

### 2. REDESIGN THE GUEST UPLOAD (Week 3-4)
The #1 reason people abandon is friction. Replace captcha, add progress bars, enable drag-drop. Hit <20 seconds from scan to complete.

### 3. ADD SUBSCRIPTION BILLING (Week 5-7)
Without recurring revenue, you have a hobby, not a business. Stripe + Razorpay. Monthly + annual. Free tier with upgrade prompts.

### 4. ADD NOTIFICATIONS (Week 4-5)
Couples don't know when guests upload. Push notification + email. This single feature doubles daily engagement.

### 5. BUILD THE ONBOARDING WIZARD (Week 6-7)
Users land on a blank dashboard and leave. Guide them: Create album → Choose theme → Generate QR → Share. Simple 4-step wizard with progress.

**Everything else is optimization. These 5 are survival.**

---

*Document generated from comprehensive codebase analysis of ShaadiShots MVP.*

*Total: 11 user personas, 47 friction points documented, 200+ individual recommendations across 17 phases, prioritized into a 12-month execution roadmap.*

*Target: Transform a functional MVP into a world-class SaaS competing with Apple, Airbnb, Stripe, Notion, Linear, and Framer quality standards.*
