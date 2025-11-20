// server/supervisor/pipeline.js
// Minimal pipeline + agent helpers.
// - Holds the manual auto toggle (UI can flip it).
// - Exposes start/stop helpers for Agent B/C and a quiesce function.
// - Uses dynamic imports to avoid circular deps with supervisor/store.js & agents.

import { supervisorNote } from '../tools/supervisorNote.js';

// ----- Manual Auto Toggle (UI hint; policy may still allow auto independently)
let autoEnabled = false;               // manual toggle; policy may still allow auto independently
const WINDOW_MS = 3000;                // kept for UI/compat: historical batch window hint
const QUIET_CHECK_MS = 4000;           // kept for UI/compat: post-mitigation quiet check hint

/**
 * Optionally called by routes/UI to flip the manual auto toggle.
 * Returns the current toggle state.
 */
export function setAutoEnabled(flag) {
  autoEnabled = !!flag;
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

// ---------------------------------------------------------------------------
// Agent helpers (lazy-import to avoid circulars)
// ---------------------------------------------------------------------------
async function withAgent(modPath, exportName, fn) {
  const mod = await import(modPath);
  const agent = mod?.[exportName];
  if (!agent) throw new Error(`Agent export "${exportName}" not found in ${modPath}`);
  return fn(agent);
}

// Agent B — Troubleshooting
export async function startAgentB() {
  return withAgent('../agents/troubleshootingAgent.js', 'troubleshootingAgent', async (agent) => {
    if (agent.start) await agent.start();
    supervisorNote('Agent B started');
    return agent.snapshot?.() ?? { name: 'Agent B', status: 'Active' };
  });
}

export async function stopAgentB() {
  return withAgent('../agents/troubleshootingAgent.js', 'troubleshootingAgent', async (agent) => {
    if (agent.stop) await agent.stop();
    supervisorNote('Agent B stopped');
    return agent.snapshot?.() ?? { name: 'Agent B', status: 'Stopped' };
  });
}

// Agent C — RCA / Dispatch
export async function startAgentC() {
  return withAgent('../agents/rcaAgent.js', 'rcaAgent', async (agent) => {
    if (agent.start) await agent.start();
    supervisorNote('Agent C started');
    return agent.snapshot?.() ?? { name: 'Agent C', status: 'Active' };
  });
}

export async function stopAgentC() {
  return withAgent('../agents/rcaAgent.js', 'rcaAgent', async (agent) => {
    if (agent.stop) await agent.stop();
    supervisorNote('Agent C stopped');
    return agent.snapshot?.() ?? { name: 'Agent C', status: 'Stopped' };
  });
}

/**
 * Quiesce (turn off) downstream agents when the issue is resolved or dispatched.
 * Idempotent: safe to call even if agents are already stopped.
 */
export async function quiesceDownstreamAgents(reason = 'pipeline:terminal') {
  try {
    await Promise.allSettled([
      stopAgentB(),
      stopAgentC(),
    ]);
    supervisorNote(`Quiesced Agents B & C (${reason})`);
    return { ok: true, reason };
  } catch (e) {
    supervisorNote(`Quiesce failed (${reason}): ${e?.message || e}`);
    return { ok: false, reason, error: String(e?.message || e) };
  }
}
