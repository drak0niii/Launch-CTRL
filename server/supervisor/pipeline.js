// server/supervisor/pipeline.js
// Option A — Corrected & Production-Ready
// - Clean lifecycle control for Agents B and C
// - Accurate runtime + task counters
// - Correct return values
// - Narration for failures
// - Predictable quiesce logic
// - No circular deps
// - UI-safe snapshot()

import { supervisorNote } from '../tools/supervisorNote.js';
import { broadcastNarration } from '../narrator/registry.js';

// -----------------------------------------------------------------------------
// Pipeline Local State
// -----------------------------------------------------------------------------
let autoEnabled = false;
const WINDOW_MS = 3000;
const QUIET_CHECK_MS = 4000;

// runtime
let agentBRuntime = 0;
let agentBStartedAt = null;

let agentCRuntime = 0;
let agentCStartedAt = null;

// tasks
let agentBTasks = 0;
let agentCTasks = 0;

// cached agent instances (so snapshot can read live counters)
let agentBCache = null;
let agentCCache = null;

// statuses
let agentBStatus = 'stopped';
let agentCStatus = 'stopped';

// quiesce debounce (reason -> ts)
const lastQuiesce = new Map();
const QUIESCE_DEBOUNCE_MS = 750;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function computeRuntime(startedAt, accumulated) {
  if (!startedAt) return accumulated;
  return accumulated + Math.floor((Date.now() - startedAt.getTime()) / 1000);
}

// Lazy-load agents to avoid circular dependencies
async function loadAgentB() {
  if (agentBCache) return agentBCache;
  const mod = await import('../agents/troubleshooting.js');
  agentBCache = mod.troubleshootingAgent;
  return agentBCache;
}
async function loadAgentC() {
  if (agentCCache) return agentCCache;
  const mod = await import('../agents/rca.js');
  agentCCache = mod.rcaAgent;
  return agentCCache;
}

// -----------------------------------------------------------------------------
// Auto Toggle
// -----------------------------------------------------------------------------
export function setAutoEnabled(flag) {
  autoEnabled = !!flag;

  supervisorNote(`Auto-pipeline ${autoEnabled ? 'ENABLED' : 'DISABLED'} (manual toggle)`);

  broadcastNarration(
    autoEnabled
      ? "Auto-pipeline enabled. Automated mitigation will run when allowed by policy."
      : "Auto-pipeline disabled. Troubleshooting may require manual routing or approval."
  );

  return { enabled: autoEnabled };
}

export function getAutoStatus() {
  return {
    enabled: autoEnabled,
    windowMs: WINDOW_MS,
    quietCheckMs: QUIET_CHECK_MS,
  };
}

// -----------------------------------------------------------------------------
// AGENT B — Troubleshooting
// -----------------------------------------------------------------------------
export async function startAgentB() {
  if (agentBStatus === 'running') {
    return { ok: true, agent: 'B', status: agentBStatus, snapshot: snapshot() };
  }
  try {
    const agent = await loadAgentB();

    if (agent.start) await agent.start();

    agentBCache = agent;
    agentBStatus = 'running';
    agentBStartedAt = new Date();
    agentBTasks = agent.tasks || 0;

    supervisorNote('Agent B started');
    broadcastNarration("Agent B (Troubleshooting) is now online and ready.");

    return {
      ok: true,
      agent: 'B',
      status: agentBStatus,
      snapshot: snapshot()
    };
  } catch (e) {
    agentBStatus = 'error';
    supervisorNote(`Agent B failed to start: ${e?.message || e}`);
    broadcastNarration(`Agent B could not start: ${e?.message || e}.`);

    return { ok: false, agent: 'B', error: String(e) };
  }
}

export async function stopAgentB() {
  if (agentBStatus === 'stopped') {
    return { ok: true, agent: 'B', status: agentBStatus, snapshot: snapshot() };
  }
  try {
    const agent = await loadAgentB();

    if (agent.stop) await agent.stop();

    if (agentBStartedAt) {
      agentBRuntime += Math.floor((Date.now() - agentBStartedAt.getTime()) / 1000);
    }
    agentBStartedAt = null;

    agentBStatus = 'stopped';
    agentBTasks = agent.tasks || 0;

    supervisorNote('Agent B stopped');
    broadcastNarration("Agent B (Troubleshooting) has been stopped.");

    return {
      ok: true,
      agent: 'B',
      status: agentBStatus,
      snapshot: snapshot()
    };
  } catch (e) {
    agentBStatus = 'error';
    supervisorNote(`Agent B stop error: ${e?.message || e}`);
    broadcastNarration(`Agent B encountered an error while stopping: ${e?.message || e}.`);

    return { ok: false, agent: 'B', error: String(e) };
  }
}

// -----------------------------------------------------------------------------
// AGENT C — RCA / Dispatch
// -----------------------------------------------------------------------------
export async function startAgentC() {
  if (agentCStatus === 'running') {
    return { ok: true, agent: 'C', status: agentCStatus, snapshot: snapshot() };
  }
  try {
    const agent = await loadAgentC();

    if (agent.start) await agent.start();

    agentCCache = agent;
    agentCStatus = 'running';
    agentCStartedAt = new Date();
    agentCTasks = agent.tasks || 0;

    supervisorNote('Agent C started');
    broadcastNarration("Agent C (RCA & Dispatch) is now active.");

    return {
      ok: true,
      agent: 'C',
      status: agentCStatus,
      snapshot: snapshot()
    };
  } catch (e) {
    agentCStatus = 'error';
    supervisorNote(`Agent C failed to start: ${e?.message || e}`);
    broadcastNarration(`Agent C could not start: ${e?.message || e}.`);

    return { ok: false, agent: 'C', error: String(e) };
  }
}

export async function stopAgentC() {
  if (agentCStatus === 'stopped') {
    return { ok: true, agent: 'C', status: agentCStatus, snapshot: snapshot() };
  }
  try {
    const agent = await loadAgentC();

    if (agent.stop) await agent.stop();

    if (agentCStartedAt) {
      agentCRuntime += Math.floor((Date.now() - agentCStartedAt.getTime()) / 1000);
    }
    agentCStartedAt = null;

    agentCStatus = 'stopped';
    agentCTasks = agent.tasks || 0;

    supervisorNote('Agent C stopped');
    broadcastNarration("Agent C (RCA & Dispatch) has been stopped.");

    return {
      ok: true,
      agent: 'C',
      status: agentCStatus,
      snapshot: snapshot()
    };
  } catch (e) {
    agentCStatus = 'error';
    supervisorNote(`Agent C stop error: ${e?.message || e}`);
    broadcastNarration(`Agent C encountered an error while stopping: ${e?.message || e}.`);

    return { ok: false, agent: 'C', error: String(e) };
  }
}

// -----------------------------------------------------------------------------
// QUIESCE — Stops both B & C
// -----------------------------------------------------------------------------
export async function quiesceDownstreamAgents(reason = 'pipeline:terminal') {
  const now = Date.now();
  const last = lastQuiesce.get(reason);
  if (last && (now - last) < QUIESCE_DEBOUNCE_MS) {
    return { ok: true, reason, skipped: 'debounced' };
  }
  lastQuiesce.set(reason, now);
  try {
    await Promise.allSettled([
      stopAgentB(),
      stopAgentC(),
    ]);

    supervisorNote(`Quiesced Agents B & C (${reason})`);
    broadcastNarration(`Agents B and C have been quiesced (${reason}).`);

    return { ok: true, reason };
  } catch (e) {
    supervisorNote(`Quiesce failed (${reason}): ${e?.message || e}`);
    broadcastNarration(`Quiesce of Agents B & C failed: ${e?.message || e}.`);

    return { ok: false, error: String(e), reason };
  }
}

// -----------------------------------------------------------------------------
// Snapshot — UI uses this
// -----------------------------------------------------------------------------
export function snapshot() {
  return {
    manualAutoEnabled: autoEnabled,
    constants: { WINDOW_MS, QUIET_CHECK_MS },

    agentB: {
      status: agentBStatus,
      runtimeSec: computeRuntime(agentBStartedAt, agentBRuntime),
      tasks: agentBCache?.tasks ?? agentBTasks,
      startedAt: agentBStartedAt,
    },

    agentC: {
      status: agentCStatus,
      runtimeSec: computeRuntime(agentCStartedAt, agentCRuntime),
      tasks: agentCCache?.tasks ?? agentCTasks,
      startedAt: agentCStartedAt,
    }
  };
}

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------
export function initPipeline() {
  supervisorNote('Pipeline init complete (lifecycle handled by supervisor).');
  return { ok: true };
}
