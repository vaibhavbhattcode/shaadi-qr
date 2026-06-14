import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { migrate, db } from '../db.js';
import { hashPassword } from '../middleware/auth.js';

migrate();

const rl = readline.createInterface({ input, output });
const name = (await rl.question('Super admin name: ')).trim();
const email = (await rl.question('Super admin email: ')).trim().toLowerCase();
const password = await rl.question('Password (min 8 chars): ');
rl.close();

if (!name || !email.includes('@') || password.length < 8) {
  console.error('Invalid input. Name, valid email and 8+ char password required.');
  process.exit(1);
}

const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
const passwordHash = await hashPassword(password);

if (existing) {
  db.prepare("UPDATE users SET name = ?, password_hash = ?, role = 'super_admin', status = 'active', updated_at = datetime('now') WHERE id = ?").run(name, passwordHash, existing.id);
  console.log('Existing user promoted to super admin and password updated.');
} else {
  db.prepare("INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, 'super_admin', 'active')").run(name, email, passwordHash);
  console.log('Super admin account created.');
}
