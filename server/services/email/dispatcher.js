// server/services/email/dispatcher.js
// Handles composing and sending dispatch emails (simulation or real).

import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';
import { supervisorNote } from '../../tools/supervisorNote.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'dispatch.txt');

// --- Email transport setup ---
// If SMTP env vars are missing, the module will run in "dry-run" mode (console only)
const {
  SMTP_HOST,
  SMTP_PORT = 587,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM = 'supervisor@launch-ctrl.local',
  DISPATCH_TO = 'field-ops@example.com',
} = process.env;

let transporter = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  supervisorNote('Email dispatcher initialized (SMTP active).');
} else {
  supervisorNote('Email dispatcher running in DRY-RUN mode (no SMTP credentials).');
}

/**
 * Compose the dispatch message from data (site, cause, etc.)
 * If template file exists, inject placeholders; else use inline fallback.
 */
export function composeEmail({ siteId, subject, body, cause, resolution, summary }) {
  let template = null;
  try {
    template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch {
    // fallback if template not found
    template = `Subject: {{subject}}\n\n{{body}}\n\n---\nSite: {{siteId}}\nCause: {{cause}}\nResolution: {{resolution}}\n\n{{summary}}`;
  }

  const output = template
    .replaceAll('{{siteId}}', siteId || 'unknown')
    .replaceAll('{{subject}}', subject || `Dispatch ${siteId}`)
    .replaceAll('{{body}}', body || '')
    .replaceAll('{{cause}}', cause || 'n/a')
    .replaceAll('{{resolution}}', resolution || 'n/a')
    .replaceAll('{{summary}}', summary || '');

  return output;
}

/**
 * Send dispatch email or log to console in dry-run mode.
 * Returns { ok, info }
 */
export async function sendDispatchEmail({ to = DISPATCH_TO, siteId, subject, body }) {
  if (!siteId || !subject || !body) {
    return { ok: false, error: 'missing_fields' };
  }

  const msg = { from: SMTP_FROM, to, subject, text: body };

  if (!transporter) {
    console.log('--- [DRY-RUN] Dispatch Email ---');
    console.log(JSON.stringify(msg, null, 2));
    console.log('--------------------------------');
    supervisorNote(`DRY-RUN dispatch email for ${siteId} logged to console.`);
    return { ok: true, dryRun: true };
  }

  try {
    const info = await transporter.sendMail(msg);
    supervisorNote(`Dispatch email sent for ${siteId} → ${to} (${info.messageId})`);
    return { ok: true, info };
  } catch (err) {
    supervisorNote(`Dispatch email FAILED for ${siteId}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
