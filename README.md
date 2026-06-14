# ShaadiShots — Secure QR Wedding Photo Collect SaaS

A complete full-stack QR wedding photo/video collection platform with owner dashboards, super admin console, storage quotas, upload moderation and professional responsive UI.

## What it does

- Couple/owner creates a wedding event
- App generates a secure QR upload link
- Guests scan QR and upload photos/videos without login
- Media stays `pending` until owner/admin approval
- Approved media appears in a public/private gallery
- Owner downloads approved album as ZIP
- Super admin manages users, all events, media, storage, payments and audit logs

## Tech Stack

- **Backend:** Node.js + Express
- **Views:** EJS server-rendered pages with professional inline responsive CSS
- **Database:** SQLite using `better-sqlite3`
- **Auth:** Bcrypt password hashing + signed JWT in HTTP-only cookies
- **Security:** Helmet, CSRF tokens, rate limiting, owner/super-admin authorization
- **Uploads:** Multer temp uploads + magic-byte validation using `file-type`
- **Storage:** Local filesystem with per-event quotas and duplicate SHA-256 detection
- **QR:** `qrcode`
- **ZIP download:** `archiver`

## Features Implemented

### Owner/Admin Authentication

- Owner registration/login
- Secure bcrypt password hashing
- Signed JWT auth cookie
- HTTP-only cookies
- Owner-only event dashboard routes
- Suspended account blocking
- Guest upload does **not** require login but requires secret upload token inside QR link
- Gallery PIN protection support

### Super Admin Console

Accessible at:

```text
/admin
```

Super admin can manage:

- Business overview metrics
- Total users, owners, super admins and suspended users
- Total weddings/events
- Total media and pending approvals
- Total platform storage usage
- Payment/revenue records
- All customer accounts
- Suspend/reactivate users
- Promote/demote users to owner/super admin
- All wedding events across all users
- Override plan and storage limit
- Open/close uploads and galleries
- Regenerate QR upload token
- Review/approve/reject/delete any event media
- Delete an event and all stored files
- View audit logs

Create a super admin manually:

```bash
npm run create-super-admin
```

### Media Upload Security

- Max files per request
- Global max file size server limit
- Plan-based photo/video size limits
- Allowed file types:
  - JPG, PNG, WEBP, HEIC/HEIF
  - MP4, MOV, WEBM
- Magic-byte validation; file extension alone is not trusted
- Duplicate detection using SHA-256 per event
- Files stored outside public static directory
- Media served only through authorized routes
- Pending approval by default
- Rate limited guest uploads

### Storage Management

- Plans: Basic, Premium, Royal
- Per-event storage limit
- Storage usage progress bars
- Super admin can override storage limit
- Delete media frees storage
- Approved album ZIP download

### Professional UI/UX

- Fully responsive desktop/mobile layout
- Modern SaaS-style super admin dashboard
- Professional cards, tables, filters and media grids
- Mobile-friendly guest upload flow
- Printable QR poster page
- No external CDN required for app preview

## Quick Start

```bash
cd wedding-qr-photo-app
cp .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Create an owner account, then create your first wedding event.

## Demo Seed

```bash
npm run seed
npm run dev
```

Owner login:

```text
Email: demo@example.com
Password: Password123!
```

Super admin login:

```text
Email: superadmin@example.com
Password: SuperAdmin123!
```

## Production Setup Checklist

1. Set strong secrets in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Use generated values for:

```env
JWT_SECRET=...
COOKIE_SECRET=...
```

2. Set your real HTTPS domain:

```env
APP_URL=https://yourdomain.com
NODE_ENV=production
TRUST_PROXY=true
```

3. Create your first super admin:

```bash
npm run create-super-admin
```

4. Disable open registration after setup:

```env
REGISTRATION_ENABLED=false
```

5. Put the app behind HTTPS reverse proxy such as Nginx/Caddy.

6. Backup these folders/files:

```text
data/app.db
storage/media/
```

## Important URLs

```text
/                                  Landing page
/register                          Create owner account
/login                             Owner/super-admin login
/dashboard                         Owner dashboard
/dashboard/events/new              Create wedding event
/dashboard/events/:id              Owner event settings + QR
/dashboard/events/:id/media        Owner media approval dashboard
/admin                             Super admin overview
/admin/users                       Super admin user management
/admin/events                      Super admin event management
/admin/payments                    Super admin payment records
/admin/audit                       Super admin audit logs
/e/:slug/upload?token=SECRET       Guest upload page via QR
/e/:slug/gallery                   Public/private approved gallery
```

## Project Structure

```text
src/
  config.js                    Environment config and plan limits
  db.js                        SQLite schema, migrations, helper queries
  server.js                    Express app bootstrap
  middleware/
    auth.js                    JWT auth, owner and super-admin authorization
    csrf.js                    CSRF token middleware
    flash.js                   Cookie flash messages
    security.js                Helmet and rate limiters
  lib/
    storage.js                 Secure file upload/storage logic
    helpers.js                 URL, formatting and slug helpers
    async-handler.js           Async route wrapper
  routes/
    auth.js                    Login/register/logout
    dashboard.js               Owner event, QR, media and download routes
    admin.js                   Super admin users/events/media/payments/audit
    public.js                  Guest upload and gallery routes
  scripts/
    create-admin.js            Create owner account from CLI
    create-super-admin.js      Create/promote super admin from CLI
    seed.js                    Demo owner + demo super admin
  views/                       EJS templates
```

## Current MVP Limitations

- Storage is local filesystem. For SaaS scale, replace storage layer with S3/Cloudflare R2/Supabase Storage.
- Payment records are manual. Razorpay gateway can be integrated next.
- No AI face search yet. That should be a premium phase-2 feature.
- Video transcoding/thumbnails are not generated; videos are served directly.

## Recommended Next Upgrades

- Razorpay subscriptions/packages
- Cloudflare R2 or S3 object storage
- Email/WhatsApp invite sharing
- Background virus scanning queue
- Image thumbnail generation using Sharp
- Family sub-admin accounts
- Live slideshow screen for venue
- AI face search: “Find my photos”
