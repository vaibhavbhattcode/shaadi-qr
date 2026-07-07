# SHAADISHOTS — COMPLETE PRODUCT REDESIGN

## PHASE 1: USER PERSONAS

---

### PERSONA 1: PRIYA — The Bride (Primary Decision Maker)

**Demographics:** 28, Marketing Manager, Mumbai, Upper-middle class
**Devices:** iPhone 16 Pro Max, iPad Pro, MacBook Air
**Internet:** 5G/WiFi 6 — excellent connectivity
**Tech Literacy:** High — uses Instagram, Pinterest, Notion daily

**Goals:**
- Collect every photo and video from her wedding day
- Have a beautiful digital album to share with family
- Keep the process stress-free for guests
- Get all media in highest quality possible
- Have control over what appears in the public gallery

**Pain Points:**
- Wedding planning is overwhelming — needs simplicity
- Family members are not tech-savvy
- Wants professional quality without hiring a pro photographer for everything
- Anxious about missing moments
- Doesn't want spam or inappropriate content in her gallery

**Frustrations:**
- "I don't have time to learn another app"
- "I need my mom to be able to upload photos easily"
- "Why do I need to create an account just to get photos?"
- "The QR code needs to be beautiful — it's part of my wedding design"

**Expectations:**
- Feels like a premium service (like a wedding planner, not a tech tool)
- Setup in under 2 minutes
- QR code matches wedding theme colors
- Real-time notification when guests upload
- One-click download of everything
- Beautiful gallery that she's proud to share

---

### PERSONA 2: RAJ — The Groom (Secondary Decision Maker)

**Demographics:** 30, Software Engineer, Bangalore, Tech-savvy
**Devices:** Samsung Galaxy S25, Windows Laptop
**Internet:** 5G/Fiber
**Tech Literacy:** Very High — power user

**Goals:**
- Ensure data is backed up and secure
- Get all media in original quality
- Automate as much as possible
- Integrate with Google Photos / cloud storage

**Pain Points:**
- Suspicious of data privacy with new apps
- Wants technical control (download raw files, manage storage)
- Annoyed by unnecessary steps and friction

**Expectations:**
- End-to-end encryption for uploads
- No compression of original files
- API access for custom integrations
- Export to Google Photos / iCloud
- Developer-friendly (documentation, webhooks)

---

### PERSONA 3: SUMAN — Guest / Family Member (Elder)

**Demographics:** 55, Homemaker, Delhi, Uses smartphone for WhatsApp and photos
**Devices:** Mid-range Android (Redmi Note 12)
**Internet:** 4G — sometimes slow
**Tech Literacy:** Low — can use WhatsApp, camera, gallery

**Goals:**
- Share photos she took at the wedding
- Not embarrass herself with technology
- See the wedding gallery

**Pain Points:**
- Scared of "apps" and "accounts"
- Hindi is her preferred language
- Small text is hard to read
- Confused by too many options
- Fears doing something wrong and losing photos

**Frustrations:**
- "Why does it ask for my name? I just want to upload!"
- "What is a captcha? Why is there math?"
- "It says upload failed — what did I do wrong?"
- "I can't find the upload button on my phone"

**Requirements:**
- Hindi language option
- Very large text and buttons
- One primary action per screen
- Clear visual feedback (checkmark animation, not text)
- No login, no forms, no passwords
- "Call my daughter if stuck" — contact info visible

---

### PERSONA 4: ANKITA — Guest / Friend (Young Professional)

**Demographics:** 26, Consultant, Lives in UK, Attending wedding in India
**Devices:** iPhone 15 Pro
**Internet:** Roaming 5G
**Tech Literacy:** High

**Goals:**
- Upload photos quickly at the venue
- See what others uploaded
- Tag herself and friends in photos
- Download the photos she's in

**Pain Points:**
- Wants to spend time enjoying wedding, not on phone
- Roaming data is expensive — don't want heavy pages
- Has both photos and videos to share

**Expectations:**
- 5-second upload flow
- Background upload while she puts phone away
- Beautiful gallery she can browse
- Share to Instagram directly
- Like and comment on photos

---

### PERSONA 5: VIKRAM — Photographer (Professional)

**Demographics:** 34, Wedding Photographer, Owns studio in Pune
**Devices:** iPad Pro 12.9, MacBook Pro, Sony A7IV -> transfers to phone
**Internet:** Variable — venue WiFi, 5G hotspot
**Tech Literacy:** Professional in photo software

**Goals:**
- Deliver photos to clients professionally
- Showcase portfolio to future clients
- Get paid for premium delivery
- Offer something competitors don't have

**Pain Points:**
- Currently uses WhatsApp to share (compression ruins quality)
- Google Drive links look unprofessional
- No proofing workflow (client selects, photographer edits)
- Need watermark/branding options
- Need contract and invoice management

**Expectations:**
- Bulk upload 1000+ photos at once
- Original RAW file support
- Client proofing with selection tools
- White-label option (no "ShaadiShots" branding)
- Automated delivery workflow
- Print store integration
- Commission/affiliate for referrals

---

### PERSONA 6: NEHA — Wedding Planner (B2B Customer)

**Demographics:** 32, Owns wedding planning agency in Jaipur, Manages 15+ weddings/year
**Devices:** iPhone 15, iPad, MacBook
**Internet:** Office fiber + 5G on-site
**Tech Literacy:** Moderate — uses Canva, Asana, Instagram

**Goals:**
- Offer digital album service as upsell to clients
- Manage all weddings from one dashboard
- Coordinate with photographers and videographers
- Track what each vendor has delivered

**Pain Points:**
- Currently uses separate folders for each client — chaotic
- No central timeline or task management
- Clients ask for same thing repeatedly (QR codes, gallery links)
- Hard to prove value to clients

**Expectations:**
- Multi-event dashboard
- Client portal with branded experience
- Task templates for wedding workflow
- Vendor network and coordination
- Automated reminders and follow-ups
- Commission structure

---

### PERSONA 7: VIJAY — Admin / Support Manager

**Demographics:** 27, Customer Support Lead
**Devices:** MacBook Pro, iPhone
**Tech Literacy:** Moderate

**Goals:**
- Help users quickly
- Resolve issues without developer involvement
- Monitor system health
- Manage user accounts

**Pain Points:**
- No support ticket system
- Can't see user activity or sessions
- Manual intervention needed for common issues
- No knowledge base for self-service

**Expectations:**
- Intercom/Zendesk-style support dashboard
- User impersonation (view as user to debug)
- Action logs for every user
- Auto-resolve options for common issues
- Knowledge base editor
- Bulk operations (suspend, notify, export)

---

### PERSONA 8: ADITYA — Super Admin / Business Owner

**Demographics:** 35, Founder/CTO of media SaaS
**Devices:** MacBook Pro, Multiple monitors
**Tech Literacy:** Expert

**Goals:**
- Scale to 1M+ users
- Maximize MRR
- Minimize churn
- Build defensible moat
- Global expansion

**Pain Points:**
- Current tech stack (SQLite, EJS) can't scale
- No data-driven decision making
- No automated marketing
- Manual operations consume time

**Expectations:**
- Real-time business dashboard (MRR, ARPU, LTV, churn)
- Feature flag system for gradual rollout
- Automated A/B testing
- Usage-based billing infrastructure
- Multi-region deployment
- Webhook ecosystem for integrations
- Developer API for third-party apps

---

## PHASE 2: COMPLETE PRODUCT AUDIT

### ARCHITECTURE AUDIT

| Area | Current State | Assessment |
|------|--------------|------------|
| **Pattern** | Monolith (Express + EJS) | Good for MVP, blocking growth |
| **Database** | SQLite (better-sqlite3) | Critical risk — single-writer, 1GB ceiling |
| **Frontend** | EJS templates + inline Tailwind CDN | No SPA, full page reloads, CDN dependency |
| **Auth** | JWT in HTTP-only signed cookies | Good pattern, but no refresh tokens |
| **Storage** | Local filesystem / S3 / Google Drive | Decent abstraction, but no CDN |
| **Background Jobs** | Inline in request/response | Thumbnails, NSFW scan block the response |
| **Real-time** | None | Polling required for updates |
| **API** | None (server-rendered only) | No third-party integration possible |
| **Testing** | None | Critical risk — can't refactor safely |
| **CI/CD** | Dockerfile only | No automated pipeline |

### DATABASE AUDIT

| Issue | Location | Impact | Fix |
|-------|----------|--------|-----|
| SQLite single-writer | `db.js:9` | Blocks at ~50 concurrent writes | PostgreSQL |
| No connection pooling | `db.js:9` | Connection overhead on every request | PgBouncer |
| No migrations framework | `db.js:25` | `ensureColumn` is fragile | Prisma / Knex |
| Missing indexes | Various | Slow queries on large datasets | Add indexes |
| Integer IDs | Schema | Sharding complexity | UUIDv7 |
| No JSONB for flexible data | Schema | Schema rigidity for settings | JSONB columns |
| No full-text search | Schema | No search capability | tsvector indexes |
| Storage usage computed via SUM | `db.js:254` | O(n) on every page load | Cached counter + materialized view |

### SECURITY AUDIT

| Issue | Location | Severity | Fix |
|-------|----------|----------|-----|
| Math captcha is trivially bypassable | `captcha.js` | Medium | reCAPTCHA v3 / Turnstile |
| No rate limiting per user ID | `security.js` | Medium | Per-user rate limits in Redis |
| 'unsafe-inline' in CSP | `layout.ejs:28` | Medium | Nonce-based script loading |
| Tailwind CDN blocks on slow network | `layout.ejs:15` | Low | Bundled Tailwind |
| No virus scanning for uploads | `storage.js` | High | ClamAV / S3 Lambda scanning |
| No email verification | `auth.js` | Medium | Verify email before dashboard access |
| Password reset token logged to console | `auth.js:214` | Medium | Remove from console, use email |
| No session management UI | All | Medium | View/revoke active sessions |
| No brute-force account lockout | `security.js` | Medium | Progressive delay + lockout |
| No MFA backup codes | `totp.js` | High | Recovery codes on 2FA setup |

### PERFORMANCE AUDIT

| Issue | Location | Impact | Fix |
|-------|----------|--------|-----|
| Tailwind loaded from CDN (render-blocking) | `layout.ejs:15` | +1s LCP | Build into bundle |
| No image optimization | All | Large images loaded at original size | Sharp on upload + srcset |
| No lazy loading | `media-grid` in views | All images load on page render | Intersection Observer |
| Synchronous DB queries | All routes | Blocks event loop | Async driver + connection pool |
| Repeated storage queries | Multiple routes | Same query runs 5x per page load | Redis cache |
| No HTTP caching headers | API responses | Browsers don't cache | Cache-Control + ETags |
| Google Fonts render-blocking | `layout.ejs:11` | +500ms FCP | Self-host fonts |
| No bundle splitting | Single CSS blob | All styles load everywhere | Per-route CSS chunks |
| No CDN for media | Media served from app server | Server bandwidth bottleneck | Cloudflare R2 + CDN |
| No video optimization | Videos served as-is | Large file downloads | HLS transcoding + adaptive bitrate |

### UX AUDIT

| Issue | Location | Severity | Fix |
|-------|----------|----------|-----|
| Math captcha | `public/upload.ejs` | High | Replace with Turnstile or click-based |
| No drag-drop upload | `public/upload.ejs` | High | Full DnD zone with visual feedback |
| No upload progress bar | `public/upload.ejs` | High | XMLHttpRequest progress event |
| No multi-file preview before upload | `public/upload.ejs` | Medium | Thumbnail grid before confirm |
| No dark mode | All pages | Medium | System-aware dark mode |
| No keyboard shortcuts | Moderation page | Medium | A/R/D keys for approve/reject/delete |
| No swipe gestures | Moderation page | High | Tinder-style card stack |
| No skeleton screens | All pages | Medium | Content-shaped loading states |
| No empty state illustrations | Dashboard | Medium | Illustrated onboarding CTAs |
| Form validation lacks instant feedback | All forms | Medium | Debounced inline validation |
| Mobile sidebar is cramped | `layout.ejs` | Medium | Bottom tab bar for mobile |
| No pull-to-refresh | Dashboard | Low | Native pull-to-refresh gesture |
| No offline indicator | All | Medium | Offline banner with auto-retry |
| No progress wizards | Event creation | Medium | Multi-step wizard with progress |
| Table rows lack hover states | Admin tables | Low | Subtle row highlight |

---

## PHASE 3: COMPLETE USER JOURNEY MAP

### JOURNEY 1: BRIDE CREATES WEDDING ALBUM

```
DISCOVERY → SIGNUP → ONBOARDING → CREATE EVENT → CONFIGURE → QR → SHARE
```

**1.1 — Discovery (Landing Page)**
- **Thinking**: "Is this what I need? Can my family use this?"
- **Feeling**: Curious but skeptical
- **Needs**: Social proof (10K+ couples), simplicity guarantee, see sample gallery
- **Magic**: Interactive demo that shows a real wedding gallery with sample uploads
- **Friction**: Too much text, not enough visual proof

**1.2 — Signup**
- **Thinking**: "Do I need another password?"
- **Feeling**: Annoyed by yet another account
- **Needs**: Google SSO (1 tap), no password needed
- **Magic**: "Try it now" — create a sample event without even signing up
- **Friction**: Email registration form is 5+ fields; most users abandon here

**1.3 — Onboarding Wizard**
- **Thinking**: "What's the fastest way to get my QR?"
- **Feeling**: Excited but impatient
- **Needs**: Clear 4-step path with progress indicator
- **Magic**: Pre-filled sample data showing what the final result looks like
- **Friction**: No guidance on what to do first

**1.4 — Create Event (Step 1: Basics)**
- **Thinking**: "Just tell me what you need"
- **Feeling**: Eager
- **Needs**: Title, date, couple names — that's it
- **Magic**: Auto-generate a beautiful slug and default theme
- **Friction**: 7+ fields, folders list, plan selection — too much upfront

**1.5 — Create Event (Step 2: Theme)**
- **Thinking**: "I want it to match my wedding colors"
- **Feeling**: Creative
- **Needs**: 6-8 professionally designed themes with live preview
- **Magic**: Upload a photo of wedding invitation → AI extracts color palette → theme auto-applied
- **Friction**: No theme options currently (all pages look identical)

**1.6 — QR Generation**
- **Thinking**: "This is beautiful! Can I print it?"
- **Feeling**: Excited, accomplished
- **Needs**: Download PNG/PDF/SVG, poster with QR, print-ready
- **Magic**: Animated QR reveal with brand colors, "Download for print" with crop marks
- **Friction**: QR is buried in event page, no print-ready option

**1.7 — Share QR**
- **Thinking**: "How do I get this to everyone?"
- **Feeling**: Slightly overwhelmed
- **Needs**: WhatsApp share (auto-open with message), SMS, email, download
- **Magic**: "Share with all guests" → opens WhatsApp contact picker with pre-written message
- **Friction**: Only shows URL, no share buttons, no messaging templates

### JOURNEY 2: GUEST UPLOADS PHOTOS

```
SCAN QR → UPLOAD PAGE → SELECT PHOTOS → UPLOAD → CONFIRMATION → GALLERY
```

**2.1 — Scan QR**
- **Thinking**: "Let me get this done quickly"
- **Feeling**: Neutral, slightly helpful
- **Needs**: Instant page load, no app download
- **Magic**: Page loads under 1 second, shows couple's photo and wedding date
- **Friction**: Slow load on venue WiFi

**2.2 — Upload Page**
- **Thinking**: "Where do I tap to upload?"
- **Feeling**: Confident if UI is clear
- **Needs**: One big button, camera option, gallery option
- **Magic**: Bottom sheet that slides up with "Take Photo", "Choose from Gallery", "Choose Videos"
- **Friction**: Current page has folder selector, name field, captcha — 3 unnecessary steps

**2.3 — Select Photos**
- **Thinking**: "I have 10 photos from the ceremony"
- **Feeling**: Good, contributing
- **Needs**: Multi-select with preview, select all, deselect
- **Magic**: Photos are selected with haptic feedback, count badge shows number selected
- **Friction**: No preview of selected files on current app

**2.4 — Upload**
- **Thinking**: "Is it working?"
- **Feeling**: Anxious about failure
- **Needs**: Real-time progress bar, ETA, pause option
- **Magic**: Smooth animated ring showing progress, "Upload Complete" with confetti
- **Friction**: No progress indicator, no way to know if large files are still uploading

**2.5 — Confirmation**
- **Thinking**: "Done! What now?"
- **Feeling**: Satisfied
- **Needs**: "Upload More" and "View Gallery" buttons
- **Magic**: "You're the 5th guest to upload! The couple will love these."
- **Friction**: Dead end — just text message, no clear next action

**2.6 — Browse Gallery**
- **Thinking**: "Let me see what others uploaded"
- **Feeling**: Curious, community feeling
- **Needs**: Grid view, lightbox, share option
- **Magic**: Masonry grid with lazy loading, tap for full-screen, share to Instagram
- **Friction**: Gallery is separate, not immediately accessible after upload

### JOURNEY 3: COUPLE MODERATES & ENJOYS

```
NOTIFICATION → VIEW MEDIA → APPROVE/REJECT → ORGANIZE → DOWNLOAD → SHARE
```

**3.1 — Notification**
- **Thinking**: "Someone uploaded! Let me check"
- **Feeling**: Excited
- **Needs**: Push notification with uploader name and thumbnail
- **Magic**: "Priya just uploaded 5 photos from the ceremony. Approve?"
- **Friction**: No push notifications — must refresh dashboard

**3.2 — View Media**
- **Thinking**: "These are beautiful!"
- **Feeling**: Emotional, happy
- **Needs**: Full-screen viewer, swipe between photos, zoom
- **Magic**: Lightbox with cinematic transitions, auto-play video
- **Friction**: Current media page is a basic grid, no lightbox

**3.3 — Approve/Reject (Moderation)**
- **Thinking**: "Quickly approve all the good ones"
- **Feeling**: In control
- **Needs**: Swipe right (approve), swipe left (reject), keyboard shortcuts
- **Magic**: Card stack interface — Tinder for photos. Approve → next photo animates in.
- **Friction**: Current: click, wait for reload, scroll, repeat — 10x too slow

**3.4 — Organize**
- **Thinking**: "These go in the Reception folder"
- **Feeling**: Organized
- **Needs**: Drag photos between folders, batch folder assignment
- **Magic**: Drag into folders with spring animation, auto-tagging suggestions
- **Friction**: No folder management after upload, no batch operations

**3.5 — Download**
- **Thinking**: "I want all the approved photos"
- **Feeling**: Excited to share
- **Needs**: One-click ZIP download, select by folder, select by date
- **Magic**: Download progress bar, "Your album is ready" email notification for large downloads
- **Friction**: Works but no progress, no email when ready

**3.6 — Share**
- **Thinking**: "Let's share the album with family"
- **Feeling**: Proud
- **Needs**: Share link, embed on wedding website, social media
- **Magic**: Beautiful share card with couple photo + gallery preview (Open Graph)
- **Friction**: No share card, no embed, no social preview

### JOURNEY 4: SUPER ADMIN MANAGES PLATFORM

```
LOGIN → DASHBOARD → ANALYZE → MANAGE USERS → CONFIGURE → SUPPORT
```

**4.1 — Dashboard**
- **Thinking**: "How is the business doing today?"
- **Feeling**: Data-driven
- **Needs**: MRR, active users, storage used, pending reviews, system health
- **Magic**: At-a-glance status with sparklines, green/yellow/red indicators
- **Friction**: Current dashboard has basic counts, no trends, no revenue, no health

**4.2 — User Management**
- **Thinking**: "Who needs attention?"
- **Feeling**: Operational
- **Needs**: Search, filter by status/plan/date, bulk actions, activity log
- **Magic**: User timeline showing every action, impersonate to debug, one-click suspend
- **Friction**: No search, no user timeline, no impersonation

**4.3 — Platform Settings**
- **Thinking**: "I need to configure pricing"
- **Feeling**: Strategic
- **Needs**: Feature flags, plan management, pricing, limits
- **Magic**: Drag-and-drop plan builder, A/B test pricing variants
- **Friction**: Basic form, no feature flags, no A/B testing

---

## PHASE 3 SUPPLEMENT: COMPLETE FRICTION AUDIT BY SCREEN

| Screen | Click Count | Ideal Clicks | Friction Score | Primary Friction |
|--------|-------------|--------------|----------------|------------------|
| Guest Upload | 8 | 2 | 9/10 | Captcha, folder, name |
| Event Creation | 10 | 4 | 8/10 | Too many fields upfront |
| Media Moderation (per item) | 5 | 1 | 9/10 | Page reload per action |
| QR Download | 4 | 1 | 7/10 | Buried in settings |
| Signup | 8 | 2 | 8/10 | No SSO focus |
| Gallery View | 3 | 1 | 5/10 | Needs PIN, then loads |
| Plan Upgrade | 7 | 3 | 6/10 | No comparison, Razorpay only |
| Profile Edit | 5 | 3 | 4/10 | Works, but no avatar |
| Forgot Password | 5 | 3 | 3/10 | Slow email flow |
| Album Download | 4 | 2 | 4/10 | No progress, blocks browser |
| Admin User Search | 3 | 1 | 5/10 | No real-time search |
| Admin Audit View | 2 | 1 | 3/10 | No export |
