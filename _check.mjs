import { db } from './src/db.js';
const r = db.prepare("SELECT * FROM platform_settings WHERE key = 'whatsapp_login_enabled'").get();
console.log(JSON.stringify(r));
process.exit(0);
