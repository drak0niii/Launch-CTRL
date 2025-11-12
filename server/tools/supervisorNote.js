// server/tools/supervisorNote.js
// Lightweight wrapper for Supervisor notes (avoids circular imports)

import { note as supervisorNoteInternal } from '../supervisor/store.js';

/**
 * Send a short operational note to the Supervisor log.
 * Safe to call from anywhere (agents, tools, pipeline).
 *
 * @param {string} message - Plain log message, no formatting required.
 * @param {object} [meta]  - Optional extra data to attach (shown in logs only if relevant).
 * @returns {void}
 */
export function supervisorNote(message, meta = null) {
  try {
    const line =
      typeof meta === 'object' && meta
        ? `${message} ${JSON.stringify(meta)}`
        : String(message);
    supervisorNoteInternal(line);
  } catch (e) {
    // fail-safe: no exception propagation
    console.warn('[SupervisorNote] failed:', e.message);
  }
}

/**
 * Convenience async helper when the caller is async and wants to await silently.
 */
export async function supervisorNoteAsync(message, meta = null) {
  supervisorNote(message, meta);
  return true;
}
