// server/utils/logger.js
// Central structured logger for the Launch-CTRL backend.
// Automatically timestamps entries, tags source modules, and mirrors to Supervisor if needed.

import fs from 'fs';
import path from 'path';
import { supervisorNote } from '../tools/supervisorNote.js';

const LOG_DIR = path.resolve('./server/logs');
const LOG_FILE = path.join(LOG_DIR, `launchctrl-${new Date().toISOString().slice(0, 10)}.log`);

// Ensure folder exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function timestamp() {
  return new Date().toISOString();
}

/**
 * Internal file writer with async safety
 */
function writeFileLine(line) {
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (e) {
    console.warn('[Logger] Failed to write file:', e.message);
  }
}

/**
 * Base log function
 * @param {'info'|'warn'|'error'|'debug'} level
 * @param {string} source - component name, e.g. 'AgentA' or 'Pipeline'
 * @param {string} message - plain text message
 * @param {object} [meta] - optional structured metadata
 * @param {boolean} [mirrorToSupervisor] - whether to echo to supervisor log
 */
export function log(level, source, message, meta = null, mirrorToSupervisor = false) {
  const entry = {
    ts: timestamp(),
    level: level.toUpperCase(),
    source,
    message,
    ...(meta ? { meta } : {}),
  };

  const line = JSON.stringify(entry);
  writeFileLine(line);

  // console output (color-coded for readability)
  const tag = `[${entry.level}] [${source}]`;
  if (level === 'error') console.error(tag, message, meta || '');
  else if (level === 'warn') console.warn(tag, message, meta || '');
  else console.log(tag, message, meta || '');

  // Mirror critical logs to Supervisor (but avoid recursion)
  if (mirrorToSupervisor) {
    try {
      supervisorNote(`[${source}] ${message}`, meta);
    } catch {}
  }

  return entry;
}

/**
 * Convenience short methods
 */
export const logger = {
  info: (src, msg, meta, sup = false) => log('info', src, msg, meta, sup),
  warn: (src, msg, meta, sup = false) => log('warn', src, msg, meta, sup),
  error: (src, msg, meta, sup = true) => log('error', src, msg, meta, sup),
  debug: (src, msg, meta, sup = false) => log('debug', src, msg, meta, sup),
  line: (msg) => writeFileLine(`[${timestamp()}] ${msg}`),
};

/**
 * Simple daily log rotation (optional, callable from index.js at boot)
 */
export function rotateLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const old = files.filter((f) => !f.includes(new Date().toISOString().slice(0, 10)));
    for (const f of old) {
      const filePath = path.join(LOG_DIR, f);
      const stats = fs.statSync(filePath);
      const ageDays = (Date.now() - stats.mtimeMs) / 86400000;
      if (ageDays > 7) fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.warn('[Logger] rotation failed:', e.message);
  }
}
