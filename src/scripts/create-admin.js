import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { migrate, db } from '../db.js';
import { hashPassword } from '../middleware/auth.js';

await migrate();

const rl = readline.createInterface({ input, output });
const name = await rl.question('Name: ');
const email = (await rl.question('Email: ')).trim().toLowerCase();
const password = await rl.question('Password (min 8 chars): ');
rl.close();

if (!name.trim() || !email.includes('@') || password.length < 8) {
  console.error('Invalid input. Name, valid email and 8+ char password required.');
  process.exit(1);
}

const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  console.error('User already exists.');
  process.exit(1);
}

const passwordHash = await hashPassword(password);
await db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name.trim(), email, passwordHash, 'owner');
console.log('Admin account created. You can now login.');
