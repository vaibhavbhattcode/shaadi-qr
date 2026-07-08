import http from 'http';

let cookies = '';

function updateCookies(setCookieHeaders) {
  if (!setCookieHeaders) return;
  const parsed = {};
  // Parse existing cookies
  cookies.split(';').filter(Boolean).forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) parsed[k.trim()] = v.join('=');
  });
  // Update with new set-cookie headers
  setCookieHeaders.forEach(header => {
    const [kv] = header.split(';');
    const [k, ...v] = kv.split('=');
    if (k) parsed[k.trim()] = v.join('=');
  });
  cookies = Object.entries(parsed).map(([k, v]) => `${k}=${v}`).join('; ');
}

function get(path, sendCookies = true) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 3000, path, headers: {} };
    if (sendCookies && cookies) opts.headers['Cookie'] = cookies;
    http.get(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        updateCookies(res.headers['set-cookie']);
        resolve({ status: res.statusCode, data });
      });
    }).on('error', reject);
  });
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const b = new URLSearchParams(body).toString();
    const opts = { hostname: 'localhost', port: 3000, path, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(b) } };
    if (cookies) opts.headers['Cookie'] = cookies;
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        updateCookies(res.headers['set-cookie']);
        resolve({ status: res.statusCode, data });
      });
    });
    req.write(b);
    req.end();
  });
}

function postMultipart(path, fields, files) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const parts = [];
    
    for (const [k, v] of Object.entries(fields)) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
    }
    
    for (const [k, file] of Object.entries(files)) {
      const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`;
      parts.push(Buffer.from(fileHeader));
      parts.push(file.content);
      parts.push(Buffer.from('\r\n'));
    }
    
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p));
    
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };
    if (fields._csrf) opts.headers['X-CSRF-Token'] = fields._csrf;
    if (cookies) opts.headers['Cookie'] = cookies;
    
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        updateCookies(res.headers['set-cookie']);
        resolve({ status: res.statusCode, data });
      });
    });
    req.write(body);
    req.end();
  });
}

// Step 1: GET login page
const loginRes = await get('/login?admin=1');
const csrfMatch = loginRes.data.match(/name="_csrf" value="([^"]+)"/);
const csrfToken = csrfMatch ? csrfMatch[1] : null;
console.log('1. CSRF token obtained:', !!csrfToken);
console.log('   Cookies:', cookies);

// Step 2: Login
const loginResp = await post('/login', { _csrf: csrfToken, email: 'superadmin@example.com', password: 'SuperAdmin123!', admin: '1' });
console.log('2. Login status:', loginResp.status);
console.log('   Cookies:', cookies.substring(0, 120));

if (loginResp.status !== 302) {
  console.log('Login failed!');
  process.exit(1);
}

// Step 3: GET health check endpoint
const healthRes = await get('/health');
console.log('3. Health check status:', healthRes.status);
console.log('   Health check body:', healthRes.data);
if (!healthRes.data.includes('"status":"healthy"')) {
  console.log('Health check failed!');
  process.exit(1);
}

// Step 4: Follow redirect to /admin
const adminRes = await get('/admin');
console.log('4. Admin page status:', adminRes.status);

// Step 5: GET dashboard events page to obtain CSRF for Event creation
const dashRes = await get('/dashboard');
console.log('5. Dashboard page status:', dashRes.status);
const csrfMatchNewEvent = dashRes.data.match(/name="_csrf" value="([^"]+)"/);
// Wait, if no form on dashboard main page, check /dashboard/events/new
const newEventPageRes = await get('/dashboard/events/new');
const newEventCsrfMatch = newEventPageRes.data.match(/name="_csrf" value="([^"]+)"/);
const newEventCsrf = newEventCsrfMatch ? newEventCsrfMatch[1] : null;
console.log('   Event creation CSRF:', !!newEventCsrf);

// Step 6: Create a wedding event
const createEventRes = await post('/dashboard/events', {
  _csrf: newEventCsrf,
  title: 'Test Integration Wedding',
  bride_name: 'Jane',
  groom_name: 'John',
  wedding_date: '2026-12-25',
  venue: 'Stripe HQ Ballroom',
  city: 'San Francisco',
  folders: 'Haldi, Mehndi, Reception'
});
console.log('6. Create event response status:', createEventRes.status);
if (createEventRes.status !== 302) {
  console.log('Event creation failed!');
  process.exit(1);
}

// Step 7: GET settings page
const settingsRes = await get('/admin/settings');
console.log('7. Settings page status:', settingsRes.status);
console.log('   Has whatsapp checkbox:', settingsRes.data.includes('whatsapp_login_enabled'));
const cm = settingsRes.data.match(/name="whatsapp_login_enabled"[^>]*>/);
console.log('   Checkbox HTML:', cm ? cm[0] : 'NOT FOUND');

// Get new CSRF
const csrfMatch2 = settingsRes.data.match(/name="_csrf" value="([^"]+)"/);
const csrf2 = csrfMatch2 ? csrfMatch2[1] : null;
console.log('   Settings CSRF:', csrf2);

// Step 8: SAVE - UNCHECK whatsapp (don't send whatsapp_login_enabled)
const saveResp = await post('/admin/settings', { _csrf: csrf2, brand_name: 'ShaadiShots', support_email: 'support@shaadishots.com', allowed_file_types: 'image/jpeg,image/png' });
console.log('8. Save status:', saveResp.status);

// Step 9: Check settings again
const settingsRes2 = await get('/admin/settings');
const cm2 = settingsRes2.data.match(/name="whatsapp_login_enabled"[^>]*>/);
console.log('9. After save - Checkbox HTML:', cm2 ? cm2[0] : 'NOT FOUND');

// Step 10: Check login page
const loginRes2 = await get('/login', false);
console.log('10. Login page has WhatsApp Phone Number:', loginRes2.data.includes('WhatsApp Phone Number'));
console.log('    Login page has whatsappEnabled reference:', loginRes2.data.includes('whatsappEnabled'));

// Step 11: RE-CHECK whatsapp (send whatsapp_login_enabled=on)
const settingsRes3 = await get('/admin/settings');
const csrfMatch3 = settingsRes3.data.match(/name="_csrf" value="([^"]+)"/);
const csrf3 = csrfMatch3 ? csrfMatch3[1] : null;
const saveResp2 = await post('/admin/settings', { _csrf: csrf3, whatsapp_login_enabled: 'on', brand_name: 'ShaadiShots', support_email: 'support@shaadishots.com', allowed_file_types: 'image/jpeg,image/png' });
console.log('11. Re-save (enable) status:', saveResp2.status);

// Step 12: Verify checkbox state
const settingsRes4 = await get('/admin/settings');
const cm4 = settingsRes4.data.match(/name="whatsapp_login_enabled"[^>]*>/);
console.log('12. After re-enable - Checkbox HTML:', cm4 ? cm4[0] : 'NOT FOUND');

// Step 13: Login page should now show WhatsApp
const loginRes3 = await get('/login', false);
console.log('13. Login page has WhatsApp Phone Number:', loginRes3.data.includes('WhatsApp Phone Number'));

// Step 14: Test Guest Upload Flow
console.log('\n--- Step 14: Guest Upload Flow ---');
import Database from 'better-sqlite3';
const db = new Database('data/app.db');
const event = db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 1').get();
const folder = db.prepare('SELECT * FROM folders WHERE event_id = ? LIMIT 1').get(event.id);

console.log(`Event Slug: ${event.slug}, Upload Token: ${event.upload_token}`);

// Clear cookies so we act as a guest
cookies = '';

// Get upload page to populate ss_captcha cookie and csrf token
const uploadPageUrl = `/e/${event.slug}/upload?token=${event.upload_token}`;
const uploadPageRes = await get(uploadPageUrl);
const uploadCsrfMatch = uploadPageRes.data.match(/name="_csrf" value="([^"]+)"/);
const uploadCsrf = uploadCsrfMatch ? uploadCsrfMatch[1] : null;
const captchaTokenMatch = uploadPageRes.data.match(/name="captcha_token" value="([^"]+)"/);
const captchaToken = captchaTokenMatch ? captchaTokenMatch[1] : null;
console.log('Got Guest CSRF Token:', !!uploadCsrf);
console.log('Got Guest CAPTCHA Token:', !!captchaToken);

console.log('Waiting 2.1s to satisfy invisible timestamp-based CAPTCHA...');
await new Promise(resolve => setTimeout(resolve, 2100));

const fields = {
  _csrf: uploadCsrf,
  token: event.upload_token,
  captcha_token: captchaToken,
  folder_id: String(folder.id),
  uploader_name: 'Test Integration Guest',
  uploader_side: 'friend',
  website_url: '' // empty honeypot
};

const files = {
  media: {
    filename: 'test_photo.jpg',
    contentType: 'image/jpeg',
    content: Buffer.from('fake-jpeg-file-content')
  }
};

const uploadPostRes = await postMultipart(uploadPageUrl, fields, files);
console.log('Upload POST response status:', uploadPostRes.status);
console.log('Upload POST response body:', uploadPostRes.data);

if (uploadPostRes.status !== 200) {
  console.error('Guest upload integration failed!');
  process.exit(1);
}
console.log('✅ Guest upload integration verified successfully!');

db.close();
process.exit(0);
