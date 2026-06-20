import path from 'node:path';
import express from 'express';
import expressLayouts from 'express-ejs-layouts';
import cookieParser from 'cookie-parser';
import methodOverride from 'method-override';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './db.js';
import { authContext } from './middleware/auth.js';
import { csrfContext } from './middleware/csrf.js';
import { flashContext } from './middleware/flash.js';
import { globalLimiter, helmetMiddleware, ipBlocker } from './middleware/security.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { formatBytes, formatDate, percent, planLabel, shortNumber, yesNo } from './lib/helpers.js';
import { whatsappService } from './lib/whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

migrate();
whatsappService.init().catch(err => console.error('Failed to initialize WhatsApp connection loop:', err));

const app = express();

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(helmetMiddleware());
app.use(globalLimiter);
app.use(ipBlocker);
app.use(cookieParser(config.cookieSecret));
app.use(express.urlencoded({ extended: false, limit: '128kb' }));
app.use(express.json({ limit: '128kb' }));
app.use(methodOverride('_method'));

app.use(authContext);
app.use(csrfContext);
app.use(flashContext);

app.use((req, res, next) => {
  res.locals.appName = 'ShaadiShots';
  res.locals.path = req.path;
  res.locals.helpers = { formatBytes, formatDate, percent, planLabel, shortNumber, yesNo };
  res.locals.googleClientId = config.google?.clientId || null;
  next();
});

app.use(publicRouter);
app.use(authRouter);
app.use(adminRouter);
app.use(dashboardRouter);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Page not found', message: 'The page you are looking for does not exist.' });
});

// Central error handler: never leak internals to users.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('request_error', err);
  const wantsJson = req.xhr || req.get('accept')?.includes('application/json') || req.path.includes('/upload');

  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `One file is too large. Max server limit is ${formatBytes(config.globalMaxFileSizeBytes)}.`
      : err.code === 'LIMIT_FILE_COUNT'
        ? `Too many files. Max ${config.maxFilesPerUpload} files at once.`
        : 'Upload rejected. Please check file type/size and try again.';
    if (wantsJson) return res.status(400).json({ ok: false, error: message });
    return res.status(400).render('error', { title: 'Upload rejected', message });
  }

  const status = err.statusCode || err.status || 500;
  const message = status >= 500 ? 'Something went wrong. Please try again.' : err.message;
  if (wantsJson) return res.status(status).json({ ok: false, error: message });
  return res.status(status).render('error', { title: 'Error', message });
});

app.listen(config.port, () => {
  console.log(`ShaadiShots running on http://localhost:${config.port}`);
  console.log(`Environment: ${config.env}`);
});
