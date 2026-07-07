# SHAADISHOTS REDESIGN — PHASE 4-7

## PHASE 4: COMPLETE INFORMATION ARCHITECTURE

### SITEMAP

```
SHAADISHOTS.COM
│
├── PUBLIC (Marketing Site — Next.js SSG)
│   ├── /
│   │   ├── Hero (value prop + CTA)
│   │   ├── How It Works (3-step visual)
│   │   ├── Features Grid
│   │   ├── Template Previews
│   │   ├── Testimonials Carousel
│   │   ├── Pricing Section
│   │   ├── FAQ Accordion
│   │   └── Footer
│   │
│   ├── /features
│   │   ├── /features/qr-upload
│   │   ├── /features/smart-gallery
│   │   ├── /features/ai-tagging
│   │   ├── /features/moderation
│   │   ├── /features/custom-branding
│   │   └── /features/analytics
│   │
│   ├── /pricing
│   │   ├── Comparison Table
│   │   ├── FAQ
│   │   └── Enterprise Contact
│   │
│   ├── /templates
│   │   ├── /templates/classic-rose
│   │   ├── /templates/modern-mint
│   │   ├── /templates/golden-luxe
│   │   ├── /templates/minimal-sage
│   │   └── /templates/royal-crimson
│   │
│   ├── /for
│   │   ├── /for/couples
│   │   ├── /for/photographers
│   │   ├── /for/wedding-planners
│   │   └── /for/venues
│   │
│   ├── /blog
│   │   ├── Category: Wedding Tips
│   │   ├── Category: Product Updates
│   │   ├── Category: Customer Stories
│   │   └── Category: Photography Guides
│   │
│   ├── /docs
│   │   ├── /docs/getting-started
│   │   ├── /docs/api
│   │   ├── /docs/webhooks
│   │   ├── /docs/integrations
│   │   └── /docs/faq
│   │
│   ├── /changelog
│   ├── /about
│   ├── /contact
│   ├── /privacy
│   ├── /terms
│   ├── /status
│   └── /demo (interactive sandbox)
│
├── AUTH (Separate Subdomain: app.shaadishots.com/auth)
│   ├── /login
│   │   ├── Email/Password
│   │   ├── Google SSO
│   │   ├── Apple SSO
│   │   └── WhatsApp OTP
│   │
│   ├── /signup
│   │   ├── Email (with Google/Apple SSO)
│   │   └── WhatsApp OTP
│   │
│   ├── /forgot-password
│   ├── /reset-password
│   ├── /verify-email
│   ├── /2fa
│   └── /sessions (view active sessions)
│
├── OWNER DASHBOARD (app.shaadishots.com)
│   ├── /dashboard
│   │   ├── Stats Overview
│   │   ├── Event List (grid)
│   │   └── Quick Actions
│   │
│   ├── /events/new
│   │   ├── Step 1: Basic (title, date, names)
│   │   ├── Step 2: Theme (template picker)
│   │   ├── Step 3: Folders (drag-and-drop organizer)
│   │   └── Step 4: Share (QR + invite)
│   │
│   ├── /events/:id
│   │   ├── Overview
│   │   │   ├── Stats cards
│   │   │   ├── Recent uploads
│   │   │   └── Quick actions
│   │   │
│   │   ├── Media
│   │   │   ├── Gallery view
│   │   │   ├── Swipe moderation
│   │   │   ├── Bulk operations
│   │   │   └── Filters (folder, date, uploader)
│   │   │
│   │   ├── QR & Share
│   │   │   ├── QR display (animated)
│   │   │   ├── Download (PNG, PDF, SVG, EPS)
│   │   │   ├── Poster preview
│   │   │   ├── Share buttons (WhatsApp, SMS, Email, Link)
│   │   │   └── Embed code for wedding website
│   │   │
│   │   ├── Settings
│   │   │   ├── Event details
│   │   │   ├── Gallery PIN
│   │   │   ├── Upload enable/disable
│   │   │   ├── Gallery enable/disable
│   │   │   ├── Public download
│   │   │   ├── Custom domain
│   │   │   └── Danger zone (delete event)
│   │   │
│   │   ├── Analytics
│   │   │   ├── Upload timeline
│   │   │   ├── Guest engagement
│   │   │   ├── Popular photos
│   │   │   ├── Device breakdown
│   │   │   └── Storage usage trend
│   │   │
│   │   ├── Downloads
│   │   │   ├── ZIP by status
│   │   │   ├── ZIP by folder
│   │   │   ├── Photo book order
│   │   │   └── Highlight reel
│   │   │
│   │   └── Guests
│   │       ├── Uploader list
│   │       ├── Upload count per guest
│   │       ├── Guest leaderboard
│   │       └── Thank-you note generator
│   │
│   ├── /albums
│   │   └── (All events listed as albums)
│   │
│   ├── /profile
│   │   ├── Personal info
│   │   ├── Avatar upload
│   │   ├── Notification preferences
│   │   ├── Connected accounts
│   │   └── Payment methods
│   │
│   ├── /security
│   │   ├── Password change
│   │   ├── 2FA setup
│   │   ├── Active sessions
│   │   ├── Login history
│   │   └── Backup codes
│   │
│   ├── /billing
│   │   ├── Current plan
│   │   ├── Upgrade/downgrade
│   │   ├── Payment history
│   │   ├── Invoices
│   │   └── Usage summary
│   │
│   └── /notifications
│       ├── All notifications
│       ├── Upload alerts
│       ├── Approval alerts
│       └── System messages
│
├── GUEST (Public, No Auth)
│   ├── /e/:slug/upload
│   │   ├── Wedding branding header
│   │   ├── Upload button (prominent)
│   │   ├── Name field (optional, pre-filled from cookie)
│   │   ├── Upload zone with preview
│   │   ├── Upload progress
│   │   └── Success → redirect to gallery
│   │
│   ├── /e/:slug/gallery
│   │   ├── Gallery PIN (if enabled)
│   │   ├── Masonry/media grid
│   │   ├── Lightbox viewer
│   │   ├── Folder filter
│   │   └── Download button (if enabled)
│   │
│   └── /e/:slug/guestbook (optional)
│
├── ADMIN CONSOLE (app.shaadishots.com/admin)
│   ├── /admin
│   │   ├── Business overview (MRR, users, events, storage)
│   │   ├── System health
│   │   ├── Recent activity
│   │   └── Quick actions
│   │
│   ├── /admin/users
│   │   ├── User list (search, filter, sort)
│   │   ├── User detail (profile, events, payments, activity)
│   │   └── Bulk actions
│   │
│   ├── /admin/events
│   │   ├── Event list (search, filter by plan)
│   │   ├── Event detail
│   │   └── Event management
│   │
│   ├── /admin/media
│   │   ├── All media across platform
│   │   ├── NSFW flagged
│   │   └── Bulk actions
│   │
│   ├── /admin/payments
│   │   ├── Transactions
│   │   ├── Revenue charts
│   │   ├── Subscription management
│   │   └── Manual adjustments
│   │
│   ├── /admin/analytics
│   │   ├── Dashboard (revenue, users, events)
│   │   ├── Funnels (signup → activation → conversion)
│   │   ├── Cohorts (retention)
│   │   └── Exports
│   │
│   ├── /admin/plans
│   │   ├── Plan list
│   │   ├── Plan editor (features, limits, pricing)
│   │   ├── Coupons/discounts
│   │   └── A/B pricing test
│   │
│   ├── /admin/settings
│   │   ├── Platform settings
│   │   ├── Feature flags
│   │   ├── Email templates
│   │   ├── API keys
│   │   └── Webhooks
│   │
│   ├── /admin/security
│   │   ├── Blocked IPs
│   │   ├── Rate limit config
│   │   ├── Audit logs
│   │   └── 2FA enforcement
│   │
│   ├── /admin/whatsapp
│   │   ├── Connection status
│   │   ├── QR pairing
│   │   └── Message logs
│   │
│   ├── /admin/support
│   │   ├── Ticket list
│   │   ├── User impersonation
│   │   └── Knowledge base
│   │
│   └── /admin/logs
│       ├── Error logs
│       ├── Access logs
│       ├── Audit trail
│       └── Data export
│
└── STATUS (status.shaadishots.com)
    ├── System status
    ├── Uptime history
    ├── Incidents
    └── Maintenance schedule
```

### NAVIGATION ARCHITECTURE

**Desktop (Dashboard):**
```
┌─────────────────────────────────────────────────────────┐
│ [Logo]    │ Search events, guests...           │ [Notif] [Profile] │
├───────────┼─────────────────────────────────────────────────────────┤
│ ▲ Primary │                                                         │
│   Overview│   ┌────────────────────────────────────────────────────┐│
│   Albums  │   │  MAIN CONTENT AREA                                ││
│   New     │   │                                                    ││
│           │   │                                                    ││
│ ▼ Events  │   │                                                    ││
│   Wedding │   │                                                    ││
│   Reception│  └────────────────────────────────────────────────────┘│
│           │                                                         │
│ ▼ Settings│                                                         │
│   Profile │                                                         │
│   Security│                                                         │
│   Billing │                                                         │
│           │                                                         │
│ ▼ Support │                                                         │
│   Help    │                                                         │
│   Contact │                                                         │
├───────────┴─────────────────────────────────────────────────────────┤
│ 🧑 User Name · Logout                                               │
└─────────────────────────────────────────────────────────────────────┘
```

**Mobile (Dashboard): Bottom Tab Bar:**
```
┌─────────────────────────────────────────┐
│                                         │
│           MAIN CONTENT                  │
│                                         │
│                                         │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│ 🏠  │ 📷  │ ➕  │ 🔔  │ 👤  │
│Home  │Media │ New  │Activity│Profile│
└─────────────────────────────────────────┘
```

---

## PHASE 5: COMPLETE UI/UX REDESIGN — DESIGN SYSTEM

### DESIGN TOKENS

```css
:root {
  /* ——— TYPOGRAPHY ——— */
  --font-display: 'Instrument Serif', Georgia, serif;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', monospace;

  /* Type Scale (1.2 — Minor Third) */
  --text-xs: 0.75rem;    /* 12px */
  --text-sm: 0.875rem;   /* 14px */
  --text-base: 1rem;     /* 16px */
  --text-lg: 1.125rem;   /* 18px */
  --text-xl: 1.25rem;    /* 20px */
  --text-2xl: 1.5rem;    /* 24px */
  --text-3xl: 1.875rem;  /* 30px */
  --text-4xl: 2.25rem;   /* 36px */
  --text-5xl: 3rem;      /* 48px */
  --text-6xl: 3.75rem;   /* 60px */
  --text-7xl: 4.5rem;    /* 72px */

  /* Font Weights */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;

  /* Line Heights */
  --leading-none: 1;
  --leading-tight: 1.15;
  --leading-snug: 1.3;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
  --leading-loose: 2;

  /* ——— SPACING (8px grid) ——— */
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;   /* 20px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
  --space-16: 4rem;     /* 64px */
  --space-20: 5rem;     /* 80px */
  --space-24: 6rem;     /* 96px */

  /* ——— COLORS ——— */
  /* Brand */
  --rose-50: #fff1f5;
  --rose-100: #ffe0eb;
  --rose-200: #ffc2d7;
  --rose-300: #ff94b8;
  --rose-400: #ff5491;
  --rose-500: #f23b7a;
  --rose-600: #e01a5f;
  --rose-700: #c20e4a;
  --rose-800: #a21040;
  --rose-900: #8b1239;
  --rose-950: #4e041e;

  /* Neutral */
  --neutral-50: #fafafa;
  --neutral-100: #f5f5f5;
  --neutral-200: #e5e5e5;
  --neutral-300: #d4d4d4;
  --neutral-400: #a3a3a3;
  --neutral-500: #737373;
  --neutral-600: #525252;
  --neutral-700: #404040;
  --neutral-800: #262626;
  --neutral-900: #171717;
  --neutral-950: #0a0a0a;

  /* Semantic */
  --green-50: #f0fdf4;
  --green-500: #22c55e;
  --green-700: #15803d;

  --red-50: #fef2f2;
  --red-500: #ef4444;
  --red-700: #b91c1c;

  --amber-50: #fffbeb;
  --amber-500: #f59e0b;
  --amber-700: #b45309;

  --blue-50: #eff6ff;
  --blue-500: #3b82f6;
  --blue-700: #1d4ed8;

  /* ——— BORDER RADIUS ——— */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-2xl: 20px;
  --radius-3xl: 24px;
  --radius-full: 9999px;

  /* ——— SHADOWS (Linear-style) ——— */
  --shadow-xs: 0 0 0 1px rgba(0, 0, 0, 0.05);
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.06), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.04);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04);
  --shadow-2xl: 0 40px 60px -12px rgba(0, 0, 0, 0.15);
  --shadow-3xl: 0 60px 80px -20px rgba(0, 0, 0, 0.2);

  /* ——— ANIMATIONS ——— */
  --ease-linear: cubic-bezier(0, 0, 1, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --duration-75: 75ms;
  --duration-100: 100ms;
  --duration-150: 150ms;
  --duration-200: 200ms;
  --duration-300: 300ms;
  --duration-500: 500ms;
  --duration-700: 700ms;
  --duration-1000: 1000ms;
}

/* Dark Mode */
@media (prefers-color-scheme: dark) {
  :root {
    --neutral-50: #0a0a0a;
    --neutral-100: #171717;
    /* ... inverted scale */
  }
}
```

### LAYOUT TEMPLATES

**Public Marketing Layout:**
```
┌──────────────────────────────────────────────┐
│  [Logo]  Features  Pricing  Templates  Blog  │ [Get Started]
├──────────────────────────────────────────────┤
│                                              │
│              PAGE CONTENT                    │
│              (SSR/ISR)                      │
│                                              │
├──────────────────────────────────────────────┤
│  Footer: Product · Resources · Company       │
│  Social: Twitter · Instagram · LinkedIn      │
└──────────────────────────────────────────────┘
```

**Auth Layout:**
```
┌──────────────────────────────────────────────┐
│              ┌────────────────────┐           │
│              │                    │           │
│              │   [Logo]           │           │
│              │                    │           │
│              │   Sign In          │           │
│              │                    │           │
│              │   ───────────      │           │
│              │   Continue with    │           │
│              │   Google / Apple   │           │
│              │                    │           │
│              │   or               │           │
│              │                    │           │
│              │   Email            │           │
│              │   Password         │           │
│              │                    │           │
│              │   [Sign In]        │           │
│              │                    │           │
│              └────────────────────┘           │
│                                              │
│              No account? Sign up              │
└──────────────────────────────────────────────┘
```

**Dashboard Layout (Desktop):**
```
┌─────────────────────────────────────────────────────────────┐
│  [☰ Logo]    │ Search anything...     │ 🔔  👤  💰         │ <- Top Bar
├──────────────┼──────────────────────────────────────────────┤
│              │  Breadcrumb > Events > Wedding Name           │
│  Sidebar     │  ┌──────────────────────────────────────────┐│
│  (280px)     │  │  MAIN CONTENT AREA                       ││
│              │  │  (Scrollable, responsive grid)           ││
│  Overview    │  │                                          ││
│  Albums      │  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   ││
│  New Album   │  │  │Metric│ │Metric│ │Metric│ │Metric│   ││
│              │  │  └──────┘ └──────┘ └──────┘ └──────┘   ││
│  ─────────   │  │                                          ││
│  Settings    │  │  ┌─────────────────────────────────────┐ ││
│  Profile     │  │  │ Recent Activity                     │ ││
│  Billing     │  │  └─────────────────────────────────────┘ ││
│              │  │                                          ││
│  ─────────   │  │  ┌─────────────────────────────────────┐ ││
│  Help        │  │  │ Quick Actions                       │ ││
│  Logout      │  │  └─────────────────────────────────────┘ ││
│              │  └──────────────────────────────────────────┘│
└──────────────┴──────────────────────────────────────────────┘
```

**Dashboard Layout (Mobile):**
```
┌─────────────────────────────────┐
│ ← Back    Wedding Name    ...   │ <- Top Bar
├─────────────────────────────────┤
│                                 │
│    ┌──────┐ ┌──────┐           │
│    │Metric│ │Metric│           │
│    └──────┘ └──────┘           │
│    ┌──────┐ ┌──────┐           │
│    │Metric│ │Metric│           │
│    └──────┘ └──────┘           │
│                                 │
│    ┌────────────────────────┐  │
│    │ Recent Uploads         │  │
│    └────────────────────────┘  │
│                                 │
│    ┌────────────────────────┐  │
│    │ Activity Feed          │  │
│    └────────────────────────┘  │
│                                 │
├─────────────────────────────────┤
│ 🏠  │ 📷  │ ➕  │ 🔔  │ 👤  │ <- Bottom Tab
└─────────────────────────────────┘
```

---

## PHASE 6: PAGE-BY-PAGE REDESIGN

### PAGE 1: LANDING PAGE

**Purpose**: Convert visitors → signups
**Goal**: Communicate value in <5 seconds, show proof, eliminate objections

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  [Logo]          Features  Pricing  Templates  Blog  [Demo]   │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────┐  ┌────────────────────────┐│
│  │                              │  │                        ││
│  │  ✨ QR-Based Wedding         │  │   ┌──┐ ┌──┐ ┌──┐     ││
│  │     Photo Collection SaaS   │  │   │  │ │  │ │  │     ││
│  │                              │  │   │  │ │  │ │  │     ││
│  │  Guests scan QR.             │  │   └──┘ └──┘ └──┘     ││
│  │  Photos upload instantly.   │  │   Live Gallery Preview││
│  │  You keep every memory.     │  │                        ││
│  │                              │  │                        ││
│  │  [Start Free Trial] [See Demo]│  │                        ││
│  │                              │  │                        ││
│  │  Used by 10,000+ couples     │  └────────────────────────┘│
│  │                              │                           │
│  └──────────────────────────────┘                           │
│                                                               │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
│  │  Create   │ │  Share QR │ │  Guests   │ │  Enjoy    │   │
│  │  Album    │ │  with     │ │  Upload   │ │  Gallery  │   │
│  │  in 30s   │ │  WhatsApp │ │  Instantly│ │  Forever  │   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘   │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  "We collected 500+ photos at our wedding. Magic."           │
│  — Priya & Raj, Mumbai                                       │
│                                                               │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │
│  │Feature1│ │Feature2│ │Feature3│ │Feature4│ │Feature5│    │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘    │
│                                                               │
│  [Show all features →]                                       │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  PRICING                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐      │
│  │  Free    │ │  Basic   │ │ Premium  │ │  Royal    │      │
│  │  $0      │ │  $9/mo   │ │ $19/mo   │ │  $49/mo   │      │
│  │  1 event │ │  3 events│ │ 10 events│ │ Unlimited │      │
│  │  100 pics│ │  500 pics│ │ 5K pics  │ │ 50K pics  │      │
│  │  500MB   │ │  5GB     │ │ 50GB     │ │  500GB    │      │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘      │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  TESTIMONIALS (Carousel)                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ ⭐⭐⭐⭐⭐ "Simple, beautiful, essential."              ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  FAQ (Accordion)                                             │
│  - How does QR upload work?                                  │
│  - Do guests need an app?                                    │
│  - Is my data secure?                                        │
│  - Can I upgrade later?                                      │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  Footer: Product · Resources · Company · Social              │
└───────────────────────────────────────────────────────────────┘
```

### PAGE 2: GUEST UPLOAD (Redesigned)

**Current**: 3-step friction (folder + name + captcha)
**Target**: 1-tap upload

```
┌─────────────────────────────────────────┐
│                                         │
│  ✨ Priya & Raj's Wedding              │
│  February 14, 2026 · Udaipur           │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │                                     ││
│  │          📷 📁 🎥                   ││
│  │                                     ││
│  │     Tap to Upload Photos           ││
│  │     or drag & drop here            ││
│  │                                     ││
│  │     Max 20 files · 200MB each      ││
│  │                                     ││
│  └─────────────────────────────────────┘│
│                                         │
│  Your name (optional): ____________    │
│                                         │
│  [Upload 5 Photos]                      │
│                                         │
│  ┌──── Uploading ────────────────────┐ │
│  │ ════════════════════░░░ 78%       │ │
│  │ smile.jpg      ✅                  │ │
│  │ ceremony.mp4   🔄                   │ │
│  │ dance.jpg      ⏳                   │ │
│  └────────────────────────────────────┘ │
│                                         │
│  Or browse the gallery →                │
│                                         │
└─────────────────────────────────────────┘
```

### PAGE 3: SWIPE MODERATION (NEW)

**Purpose**: Reduce approve/reject from 5 clicks to 1 swipe per item

```
┌─────────────────────────────────────────┐
│  ← Media        Wedding Name     🔍    │
├─────────────────────────────────────────┤
│                                         │
│  12 pending approval                    │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │                                     ││
│  │                                     ││
│  │                                     ││
│  │       [PHOTO]                       ││
│  │                                     ││
│  │                                     ││
│  │                                     ││
│  │                                     ││
│  │  Uploaded by Ankita · 2 min ago    ││
│  │  In: Ceremony folder                ││
│  │                                     ││
│  └─────────────────────────────────────┘│
│                                         │
│  ┌────────┐         ┌────────┐         │
│  │  ✕     │         │  ✓     │         │
│  │ Reject │         │ Approve│         │
│  └────────┘         └────────┘         │
│                                         │
│  Keyboard: A=Approve  R=Reject  D=Delete│
└─────────────────────────────────────────┘
```

### PAGE 4: QR & SHARE (Redesigned)

**Current**: Static QR in event page
**Target**: Share hub with animated QR

```
┌─────────────────────────────────────────┐
│  ← Settings         QR & Share         │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────────┐│
│  │                                     ││
│  │        ┌───────────────────┐        ││
│  │        │                   │        ││
│  │        │     [QR CODE]     │        ││
│  │        │  Animated scan    │        ││
│  │        │  line effect      │        ││
│  │        └───────────────────┘        ││
│  │                                     ││
│  └─────────────────────────────────────┘│
│                                         │
│  Download:                              │
│  [PNG] [PDF (Poster)] [SVG] [EPS]      │
│                                         │
│  Share link:                            │
│  ┌────────────────────────┐ [Copy]     │
│  │ shaadi.sh/priya-raj    │            │
│  └────────────────────────┘            │
│                                         │
│  Share via:                             │
│  [WhatsApp] [SMS] [Email] [Instagram]   │
│                                         │
│  Embed on wedding website:              │
│  ┌────────────────────────────────────┐ │
│  │ <iframe src="shaadi.sh/priya-raj">│ │
│  └────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

### PAGE 5: EVENT ANALYTICS (NEW)

**Current**: None
**Target**: Full analytics per event

```
┌─────────────────────────────────────────┐
│  ← Dashboard    Wedding Analytics      │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │
│  │ 156  │ │ 23   │ │ 98%  │ │ 4.2  │ │
│  │Photos│ │Guests│ │Appr. │ │Avg/  │ │
│  │      │ │      │ │Rate  │ │Guest │ │
│  └──────┘ └──────┘ └──────┘ └──────┘ │
│                                         │
│  Uploads Over Time                      │
│  ┌────────────────────────────────────┐│
│  │  ██▇█▆███▅▄▃▂▁▁                   ││
│  │  Wedding Day Timeline             ││
│  └────────────────────────────────────┘│
│                                         │
│  Device Breakdown  │  Gallery Views    │
│  ┌──────────────┐  │  ┌──────────────┐ │
│  │ iPhone: 67%  │  │  │ Today: 142   │ │
│  │ Android: 28% │  │  │ Week: 890    │ │
│  │ Web: 5%      │  │  │ Total: 2.1K  │ │
│  └──────────────┘  │  └──────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

---

## PHASE 7: COMPLETE COMPONENT LIBRARY

### BUTTON SYSTEM

```tsx
// Variants
<Button variant="primary" />    // Solid brand gradient, white text
<Button variant="secondary" />  // White bg, brand border
<Button variant="ghost" />      // No bg, brand text on hover
<Button variant="danger" />     // Red for destructive actions
<Button variant="link" />       // Text only, underlined on hover

// Sizes
<Button size="xs" />   // h-7, text-xs
<Button size="sm" />   // h-8, text-sm
<Button size="md" />   // h-10, text-sm
<Button size="lg" />   // h-12, text-base
<Button size="xl" />   // h-14, text-lg

// States
<Button loading />     // Spinner replaces icon
<Button disabled />    // opacity-50, no pointer
<Button iconOnly />    // Square, centered icon

// With Icon
<Button icon={<UploadIcon />}>Upload</Button>
<Button iconPosition="right">Next <ArrowRight /></Button>
```

### INPUT SYSTEM

```tsx
// Base Input
<Input
  label="Email"
  placeholder="you@example.com"
  helperText="We'll never share your email"
  error="Please enter a valid email"
  prefix={<MailIcon />}
  suffix={<CheckIcon />}
  disabled
/>

// Variants
<Input variant="outlined" />   // Default — border with focus ring
<Input variant="filled" />     // Subtle bg, no border
<Input variant="underlined" /> // Minimal, bottom border only
```

### MEDIA CARD

```tsx
<MediaCard
  src="/photo.jpg"
  alt="Wedding ceremony"
  status="pending"           // pending | approved | rejected
  uploader="Ankita"
  folder="Ceremony"
  timestamp="2 min ago"
  onApprove={() => {}}
  onReject={() => {}}
  onDelete={() => {}}
  onView={() => {}}
  selected={false}
  layout="grid"              // grid | list | masonry
/>
```

### UPLOAD DROPZONE

```tsx
<UploadDropzone
  onFiles={handleFiles}
  accept="image/*,video/*"
  maxFiles={20}
  maxSize={200 * 1024 * 1024}
  multiple
  disabled={uploading}
  renderPreview={(files) => (
    <FilePreviewList files={files} />
  )}
>
  <UploadIcon />
  <p>Tap to upload or drag & drop</p>
  <p class="text-sm text-neutral-500">Max 20 files, 200MB each</p>
</UploadDropzone>
```

### TOAST SYSTEM

```tsx
// Usage
toast.success("Photos uploaded successfully!")
toast.error("Upload failed. Tap to retry.", {
  action: { label: "Retry", onClick: retry }
})
toast.promise(uploadPromise, {
  loading: "Uploading...",
  success: "All done!",
  error: "Something went wrong"
})

// Positions: top-right (default), bottom-center (mobile)
// Types: success | error | info | warning
// Auto-dismiss: 4s (default), sticky for errors
```

### MODAL / DIALOG

```tsx
<Dialog open={open} onClose={handleClose}>
  <Dialog.Header>
    <Dialog.Title>Delete event?</Dialog.Title>
    <Dialog.Description>
      This will permanently delete all photos and data.
    </Dialog.Description>
  </Dialog.Header>
  <Dialog.Body>
    <Input label="Type the event name to confirm" />
  </Dialog.Body>
  <Dialog.Footer>
    <Button variant="ghost" onClick={handleClose}>Cancel</Button>
    <Button variant="danger">Delete permanently</Button>
  </Dialog.Footer>
</Dialog>
```

### EMPTY STATE

```tsx
<EmptyState
  icon={<PhotoIcon />}
  title="No photos yet"
  description="Share your QR code with guests to start collecting memories."
  action={<Button>Share QR Code</Button>}
  illustration="/illustrations/empty-album.svg"
/>
```

### SKELETON

```tsx
<Skeleton variant="text" width="200px" />
<Skeleton variant="circular" size={40} />
<Skeleton variant="rectangular" width={300} height={200} />

// Compound
<SkeletonCard>
  <Skeleton variant="rectangular" height={200} />
  <Skeleton variant="text" width="60%" />
  <Skeleton variant="text" width="40%" />
</SkeletonCard>
```

### FULL COMPONENT INVENTORY

```
src/components/
├── ui/
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Select.tsx
│   ├── Checkbox.tsx
│   ├── RadioGroup.tsx
│   ├── Switch.tsx
│   ├── Textarea.tsx
│   ├── Form.tsx (useForm + Zod)
│   ├── DatePicker.tsx
│   ├── ColorPicker.tsx
│   │
│   ├── Dialog.tsx
│   ├── Sheet.tsx (mobile bottom sheet)
│   ├── Popover.tsx
│   ├── DropdownMenu.tsx
│   ├── ContextMenu.tsx
│   ├── Tooltip.tsx
│   ├── Toast.tsx
│   │
│   ├── Card.tsx
│   ├── MetricCard.tsx
│   ├── MediaCard.tsx
│   ├── EventCard.tsx
│   ├── PlanCard.tsx
│   │
│   ├── Table.tsx (sortable, filterable)
│   ├── Tabs.tsx
│   ├── Accordion.tsx
│   ├── Badge.tsx
│   ├── Avatar.tsx
│   ├── Progress.tsx
│   ├── Skeleton.tsx
│   ├── EmptyState.tsx
│   └── Spinner.tsx
│
├── layout/
│   ├── PublicLayout.tsx
│   ├── AuthLayout.tsx
│   ├── DashboardLayout.tsx
│   ├── AdminLayout.tsx
│   ├── Sidebar.tsx
│   ├── TopBar.tsx
│   ├── BottomTabBar.tsx
│   ├── MobileNav.tsx
│   └── Footer.tsx
│
├── features/
│   ├── upload/
│   │   ├── UploadDropzone.tsx
│   │   ├── UploadProgress.tsx
│   │   ├── FilePreview.tsx
│   │   └── UploadComplete.tsx
│   │
│   ├── gallery/
│   │   ├── MediaGrid.tsx
│   │   ├── GalleryLightbox.tsx
│   │   ├── FolderFilter.tsx
│   │   └── GalleryPinGate.tsx
│   │
│   ├── moderation/
│   │   ├── SwipeCard.tsx
│   │   ├── ModerationStack.tsx
│   │   └── BulkActions.tsx
│   │
│   ├── qr/
│   │   ├── QRCode.tsx
│   │   ├── QRPoster.tsx
│   │   └── ShareButtons.tsx
│   │
│   ├── onboarding/
│   │   ├── OnboardingWizard.tsx
│   │   ├── StepBasics.tsx
│   │   ├── StepTheme.tsx
│   │   ├── StepFolders.tsx
│   │   └── StepShare.tsx
│   │
│   ├── analytics/
│   │   ├── MetricCard.tsx
│   │   ├── Chart.tsx
│   │   ├── Timeline.tsx
│   │   └── CohortTable.tsx
│   │
│   └── billing/
│       ├── PlanComparison.tsx
│       ├── InvoiceTable.tsx
│       └── PaymentMethod.tsx
│
├── admin/
│   ├── AdminMetricCard.tsx
│   ├── UserTable.tsx
│   ├── EventTable.tsx
│   ├── PaymentTable.tsx
│   ├── AuditLogTable.tsx
│   ├── UserImpersonate.tsx
│   ├── FeatureFlags.tsx
│   └── SystemHealth.tsx
│
└── shared/
    ├── ThemeProvider.tsx
    ├── AuthProvider.tsx
    ├── QueryProvider.tsx
    ├── MediaQueryProvider.tsx
    └── I18nProvider.tsx
```
