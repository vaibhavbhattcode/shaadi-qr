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

function get(path) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 3000, path, headers: {} };
    if (cookies) opts.headers['Cookie'] = cookies;
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

// Step 1: GET login page
const loginRes = await get('/login?admin=1');
const csrfMatch = loginRes.data.match(/name="_csrf" value="([^"]+)"/);
const csrfToken = csrfMatch ? csrfMatch[1] : null;
console.log('1. CSRF token obtained:', !!csrfToken);
console.log('   Cookies:', cookies);

// Step 2: Login
const loginResp = await post('/login', { _csrf: csrfToken, email: 'superadmin@example.com', password: 'SuperAdmin123!' });
console.log('2. Login status:', loginResp.status);
console.log('   Cookies:', cookies.substring(0, 120));

if (loginResp.status !== 302) {
  console.log('Login failed!');
  process.exit(1);
}

// Step 3: Follow redirect to /admin
const adminRes = await get('/admin');
console.log('3. Admin page status:', adminRes.status);

// Step 4: GET settings page
const settingsRes = await get('/admin/settings');
console.log('4. Settings page status:', settingsRes.status);
console.log('   Has whatsapp checkbox:', settingsRes.data.includes('whatsapp_login_enabled'));
const cm = settingsRes.data.match(/name="whatsapp_login_enabled"[^>]*>/);
console.log('   Checkbox HTML:', cm ? cm[0] : 'NOT FOUND');

// Get new CSRF
const csrfMatch2 = settingsRes.data.match(/name="_csrf" value="([^"]+)"/);
const csrf2 = csrfMatch2 ? csrfMatch2[1] : null;
console.log('   Settings CSRF:', csrf2);

// Step 5: SAVE - UNCHECK whatsapp (don't send whatsapp_login_enabled)
const saveResp = await post('/admin/settings', { _csrf: csrf2, brand_name: 'ShaadiShots', support_email: 'support@shaadishots.com', allowed_file_types: 'image/jpeg,image/png' });
console.log('5. Save status:', saveResp.status);

// Step 6: Check settings again
const settingsRes2 = await get('/admin/settings');
const cm2 = settingsRes2.data.match(/name="whatsapp_login_enabled"[^>]*>/);
console.log('6. After save - Checkbox HTML:', cm2 ? cm2[0] : 'NOT FOUND');

// Step 7: Check login page
const loginRes2 = await get('/login');
console.log('7. Login page has WhatsApp Phone Number:', loginRes2.data.includes('WhatsApp Phone Number'));
console.log('   Login page has whatsappEnabled reference:', loginRes2.data.includes('whatsappEnabled'));

// Step 8: RE-CHECK whatsapp (send whatsapp_login_enabled=on)
const settingsRes3 = await get('/admin/settings');
const csrfMatch3 = settingsRes3.data.match(/name="_csrf" value="([^"]+)"/);
const csrf3 = csrfMatch3 ? csrfMatch3[1] : null;
const saveResp2 = await post('/admin/settings', { _csrf: csrf3, whatsapp_login_enabled: 'on', brand_name: 'ShaadiShots', support_email: 'support@shaadishots.com', allowed_file_types: 'image/jpeg,image/png' });
console.log('8. Re-save (enable) status:', saveResp2.status);

// Step 9: Verify checkbox state
const settingsRes4 = await get('/admin/settings');
const cm4 = settingsRes4.data.match(/name="whatsapp_login_enabled"[^>]*>/);
console.log('9. After re-enable - Checkbox HTML:', cm4 ? cm4[0] : 'NOT FOUND');

// Step 10: Login page should now show WhatsApp
const loginRes3 = await get('/login');
console.log('10. Login page has WhatsApp Phone Number:', loginRes3.data.includes('WhatsApp Phone Number'));

process.exit(0);
