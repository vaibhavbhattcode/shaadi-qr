import { migrate, db } from '../db.js';
import { hashPassword } from '../middleware/auth.js';
import { PLAN_LIMITS } from '../config.js';
import { randomToken } from '../lib/helpers.js';

migrate();

const superEmail = 'superadmin@example.com';
let superAdmin = db.prepare('SELECT * FROM users WHERE email = ?').get(superEmail);
if (!superAdmin) {
  const passwordHash = await hashPassword('SuperAdmin123!');
  const result = db.prepare("INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, 'super_admin', 'active')").run('Platform Super Admin', superEmail, passwordHash);
  superAdmin = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

const email = 'demo@example.com';
let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
if (!user) {
  const passwordHash = await hashPassword('Password123!');
  const result = db.prepare("INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, 'owner', 'active')").run('Demo Owner', email, passwordHash);
  user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

let event = db.prepare('SELECT * FROM events WHERE slug = ?').get('rahul-anjali-demo');
if (!event) {
  const result = db.prepare(`
    INSERT INTO events (owner_id, title, bride_name, groom_name, slug, upload_token, wedding_date, venue, city, plan, storage_limit_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, 'Rahul ❤️ Anjali Wedding', 'Anjali', 'Rahul', 'rahul-anjali-demo', randomToken(24), '2026-12-10', 'Royal Palace Banquet', 'Jaipur', 'basic', PLAN_LIMITS.basic.storageLimitBytes);
  const eventId = result.lastInsertRowid;
  ['Haldi', 'Mehndi', 'Baraat', 'Reception'].forEach((name, index) => {
    db.prepare('INSERT INTO folders (event_id, name, sort_order) VALUES (?, ?, ?)').run(eventId, name, index);
  });
}

console.log('Seed complete.');
console.log('Owner Login: demo@example.com');
console.log('Owner Password: Password123!');
console.log('Super Admin Login: superadmin@example.com');
console.log('Super Admin Password: SuperAdmin123!');
