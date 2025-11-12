// server/supervisor/pipeline.js
// Minimal pipeline: holds the manual auto toggle only.
// All orchestration (A→B→C) now lives in server/supervisor/store.js.
// This avoids circular imports between store ⇄ pipeline and agents.

import { supervisorNote } from '../tools/supervisorNote.js';

let autoEnabled = false;               // manual toggle; policy may still allow auto independently
const WINDOW_MS = 3000;                // kept for UI/compat: historical batch window hint
const QUIET_CHECK_MS = 4000;           // kept for UI/compat: post-mitigation quiet check hint

/**
 * Optionally called by routes/UI to flip the manual auto toggle.
 * Returns the current toggle state.
 */
export function setAutoEnabled(flag) {
  autoEnabled = !!flag;
  // Log via adapter to avoid circular deps
  supervisorNote(`Auto-pipeline ${autoEnabled ? 'ENABLED' : 'DISABLED'} (manual toggle)`);
  return { enabled: autoEnabled };
}

/**
 * Read by supervisor/store.js to compute the effective auto mode:
 * effective = policy(E2E automation) OR getAutoStatus().enabled
 */
export function getAutoStatus() {
  return { enabled: autoEnabled, windowMs: WINDOW_MS, quietCheckMs: QUIET_CHECK_MS };
}

/**
 * (Deprecated – no-op kept for backward compatibility.)
 * Previous versions listened to the incident bus and orchestrated here.
 * Now the Supervisor handles bus events directly.
 */
export function initPipeline() {
  supervisorNote('Pipeline init no-op; orchestration handled by Supervisor.');
  return { ok: true, message: 'Pipeline init is a no-op; orchestration moved to supervisor/store.js' };
}

// (Optional) export constants for UI consumption without importing internals
export const PIPELINE_CONSTANTS = { WINDOW_MS, QUIET_CHECK_MS };
