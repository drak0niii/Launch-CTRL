// server/supervisor/store.js
// Supervisor (Manager) — in-memory state, logs, SSE, orchestration, and narration (Hybrid)

// -----------------------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------------------
import { EventEmitter } from 'events';
import { getPolicy, onChange as onPolicyChange } from '../policy/store.js';
import { incidentBus, onIncident } from '../bus/incidentBus.js';
import { getTowerSnapshot } from '../tower/bridge.js';

// Pipeline (new)
import {
  getAutoStatus as _getAutoStatus,
  quiesceDownstreamAgents,
  startAgentB,
  stopAgentB,
  startAgentC,
  stopAgentC,
  snapshot as pipelineSnapshot,
} from './pipeline.js';

// Agent A only (correlation)
async function lazyAgentA() {
  const mod = await import('../agents/correlationAgent.js');
  return mod.correlationAgent;
}

// UI narration
import { broadcastNarration } from '../narrator/registry.js';

// -----------------------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------------------
const logSubscribers = new Set();
const bus = new EventEmitter();
const safeNowIso = () => new Date().toISOString();

// Avoid narration spam by caching last step per site
const lastNarration = new Map();
function narrate(siteId, phase, message) {
  const key = `${siteId}:${phase}`;
  if (lastNarration.get(key) === message) return;
  lastNarration.set(key, message);
  broadcastNarration(message);
}

// Alarm debug tap
let _alarmTapWired = false;
(function wireAlarmTapOnce() {
  if (_alarmTapWired) return;
  _alarmTapWired = true;

  incidentBus.on('alarm.raised', e =>
    console.log(`[ALARM↑] ${e.siteId} "${e.alarm}" ${e.ts}`)
  );
  incidentBus.on('alarm.cleared', e =>
    console.log(`[ALARM↓] ${e.siteId} "${e.alarm}" ${e.ts}`)
  );
  incidentBus.on('service.changed', e =>
    console.log(`[SERVICE] ${e.siteId} ${e.antenna}: ${e.from} → ${e.to} ${e.ts}`)
  );
})();

// -----------------------------------------------------------------------------------------
// Supervisor Object
// -----------------------------------------------------------------------------------------
const supervisor = {
  status: 'idle',
  startedAt: null,
  runtimeSec: 0,
  tasksRouted: 0,
  lastNote: null,
  logs: [],
  approvals: [],
  nextApprovalId: 1,
};

function _log(msg) {
  const line = `[${safeNowIso()}] [SUPERVISOR] ${msg}`;
  supervisor.logs.push(line);
  if (supervisor.logs.length > 2000) supervisor.logs.shift();

  for (const res of logSubscribers) {
    try { res.write(`data: ${line}\n\n`); } catch {}
  }
}

// -----------------------------------------------------------------------------------------
// SSE — Logs
// -----------------------------------------------------------------------------------------
function subscribeLogs(res) {
  logSubscribers.add(res);
  res.on('close', () => {
    logSubscribers.delete(res);
    try { res.end(); } catch {}
  });
}

// -----------------------------------------------------------------------------------------
// Summary + Stream (SSE)
// -----------------------------------------------------------------------------------------
function summary() {
  const live = supervisor.startedAt
    ? Math.floor((Date.now() - supervisor.startedAt.getTime()) / 1000)
    : 0;

  const pol = getPolicy();
  const storedAutoEnabled = !!_getAutoStatus().enabled;

  return {
    status: supervisor.status,
    startedAt: supervisor.startedAt,
    runtimeSec: supervisor.runtimeSec + live,
    tasksRouted: supervisor.tasksRouted,
    lastNote: supervisor.lastNote,
    autoEnabled: storedAutoEnabled || String(pol?.waysOfWorking || '').toLowerCase() === 'e2e automation',
    storedAutoEnabled,
    approvalsPending: supervisor.approvals.length,
    policy: pol,

    // 🔥 NEW — Pipeline status for UI
    pipeline: pipelineSnapshot(),
  };
}

function broadcast() {
  bus.emit('supervisor', summary());
}

function subscribeStream(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`event: supervisor\ndata: ${JSON.stringify(summary())}\n\n`);

  const handler = snap => {
    try { res.write(`event: supervisor\ndata: ${JSON.stringify(snap)}\n\n`); } catch {}
  };

  bus.on('supervisor', handler);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 30000);

  res.on('close', () => {
    clearInterval(ping);
    bus.off('supervisor', handler);
    try { res.end(); } catch {}
  });
}

// -----------------------------------------------------------------------------------------
// EFFECTIVE AUTO MODE
// -----------------------------------------------------------------------------------------
const isE2E = () =>
  String(getPolicy()?.waysOfWorking || '').toLowerCase() === 'e2e automation';

const getAutoStatus = () => {
  try { return _getAutoStatus() || {}; }
  catch { return {}; }
};

const autoEffective = () => isE2E() || !!getAutoStatus().enabled;

// -----------------------------------------------------------------------------------------
// Agent Lifecycle
// -----------------------------------------------------------------------------------------
async function ensureAgentsRunning() {
  try { await startAgentB(); } catch {}
  try { await startAgentC(); } catch {}
}

async function ensureAgentsStopped() {
  try { await stopAgentB(); } catch {}
  try { await stopAgentC(); } catch {}
}

// -----------------------------------------------------------------------------------------
// Cold Start Sweep (Synthesizes alarms for existing state)
// -----------------------------------------------------------------------------------------
async function coldStartSweep() {
  try {
    const snap = await getTowerSnapshot();
    if (!snap?.ok) return;

    const sites = snap.sites || {};
    let count = 0;

    for (const [siteId, site] of Object.entries(sites)) {
      const alarms = Array.isArray(site?.alarms) ? site.alarms : [];
      for (const alarm of alarms) {
        await handleEvent({
          type: 'alarm.raised',
          siteId,
          alarm,
          timestamp: safeNowIso(),
          _origin: 'cold-start',
        });
        count++;
      }
    }

    if (count > 0) _log(`cold-start synthesized ${count} alarm.raised events`);
  } catch (e) {
    _log(`cold-start sweep error: ${String(e)}`);
  }
}

// -----------------------------------------------------------------------------------------
// Supervisor Controls
// -----------------------------------------------------------------------------------------
async function start() {
  if (supervisor.status === 'running') return 'Already running';
  if (supervisor.status === 'paused') { resume(); return 'Resumed'; }

  supervisor.status = 'running';
  supervisor.startedAt = new Date();

  _log('started');
  broadcastNarration("Supervisor is now online and monitoring network events.");
  await ensureAgentsRunning();
  await coldStartSweep();
  broadcast();
  return 'OK: started';
}

async function stop() {
  if (supervisor.status === 'running' || supervisor.status === 'paused') {
    const delta = Math.floor((Date.now() - (supervisor.startedAt?.getTime() || Date.now())) / 1000);
    supervisor.runtimeSec += Math.max(0, delta);
  }

  supervisor.startedAt = null;
  supervisor.status = 'stopped';

  try {
    await ensureAgentsStopped();
  } catch (e) {
    _log(`stop: ensureAgentsStopped error → ${String(e)}`);
  }

  try {
    await quiesceDownstreamAgents('supervisor.stopped');
  } catch (e) {
    _log(`stop: quiesceDownstreamAgents error → ${String(e)}`);
  }

  _log('stopped');
  broadcastNarration("Supervisor has been stopped.");
  broadcast();
  return 'OK: stopped';
}

function pause() {
  if (supervisor.status !== 'running') return 'Not running';

  const delta = Math.floor((Date.now() - supervisor.startedAt.getTime()) / 1000);
  supervisor.runtimeSec += delta;

  supervisor.startedAt = null;
  supervisor.status = 'paused';

  _log('paused');
  broadcastNarration("Supervisor has paused operations.");
  broadcast();
  return 'OK: paused';
}

function resume() {
  if (supervisor.status !== 'paused') return 'Not paused';

  supervisor.startedAt = new Date();
  supervisor.status = 'running';

  _log('resumed');
  broadcastNarration("Supervisor has resumed operations.");
  ensureAgentsRunning();
  broadcast();

  return 'OK: resumed';
}

function note(message) {
  supervisor.lastNote = String(message || '');
  _log(`note: ${supervisor.lastNote}`);
  broadcast();
  return 'OK: noted';
}

// -----------------------------------------------------------------------------------------
// HITL Approvals
// -----------------------------------------------------------------------------------------
function addApprovalRequest({ siteId, actions = [], reason = '' }) {
  const id = String(supervisor.nextApprovalId++);
  const item = { id, siteId, actions, reason, createdAt: safeNowIso() };

  supervisor.approvals.push(item);
  supervisor.lastNote = `Approval requested #${id} for ${siteId}`;

  _log(`approval.requested → #${id} site=${siteId}`);
  broadcast();

  narrate(
    siteId,
    "approval",
    `Troubleshooting for site ${siteId} requires operator approval.`
  );

  return item;
}

function listApprovals() {
  return supervisor.approvals.slice();
}

function resolveApproval(id, decision) {
  const idx = supervisor.approvals.findIndex(a => a.id === id);
  if (idx === -1) return null;

  const [item] = supervisor.approvals.splice(idx, 1);
  supervisor.lastNote = `Approval ${decision} for #${id}`;

  _log(`approval.${decision} → #${id}`);
  broadcast();

  narrate(
    item.siteId,
    "approvalResolve",
    decision === "approved"
      ? `Approval granted for site ${item.siteId}. Continuing troubleshooting.`
      : `Approval rejected for site ${item.siteId}.`
  );

  return item;
}

function incrementTasksRouted(n = 1) {
  supervisor.tasksRouted = (supervisor.tasksRouted || 0) + n;
}

// -----------------------------------------------------------------------------------------
// Duplicate Event Guard
// -----------------------------------------------------------------------------------------
const processed = new Map();
const PROCESSED_TTL_MS = 60000;

function eventId(evt) {
  return [
    evt?.type || '',
    evt?.siteId || '',
    evt?.alarm || '',
    evt?.timestamp || evt?.ts || ''
  ].join('|');
}

function remember(id) {
  processed.set(id, Date.now());
  if (processed.size > 5000) {
    const cutoff = Date.now() - PROCESSED_TTL_MS;
    for (const [key, val] of processed) {
      if (val < cutoff) processed.delete(key);
    }
  }
}

// -----------------------------------------------------------------------------------------
// Main Event Orchestration
// -----------------------------------------------------------------------------------------
async function handleEvent(evt) {
  const id = eventId(evt);
  if (processed.has(id)) return;
  remember(id);

  const siteId = evt?.siteId;
  if (!siteId) return;

  _log(`bus.event → ${JSON.stringify({ type: evt.type, siteId, alarm: evt.alarm })}`);

  if (supervisor.status !== 'running') return;

  // Process only meaningful events
  const actionable = new Set(['alarm.raised', 'service.changed']);
  if (!actionable.has(evt.type)) return;

  narrate(siteId, "detected", `New event at site ${siteId}. Assessing conditions.`);

  // ---------------------------------------------------------
  // 1) CORRELATION (Agent A)
  // ---------------------------------------------------------
  try {
    const agentA = await lazyAgentA();
    if (agentA.status !== 'running') agentA.start();

    const corr = agentA.correlate([
      {
        siteId,
        type: evt.alarm || evt.type || 'unknown',
        timestamp: evt.timestamp || evt.ts || safeNowIso(),
      }
    ]);

    const incidents = corr?.incidents || [];

    narrate(
      siteId,
      "correlation",
      incidents.length === 0
        ? `No incident correlation found at site ${siteId}.`
        : `Correlation completed. Incident detected at site ${siteId}.`
    );

    if (incidents.length === 0) {
      broadcast();
      return;
    }

    // ---------------------------------------------------------
    // 2) Notify Agent C: investigating
    // ---------------------------------------------------------
    try {
      const agentCMod = await import('../agents/rca.js');
      const agentC = agentCMod.rcaAgent;

      await agentC.recordIncident({
        siteId,
        cause: 'correlated_alarm_cluster',
        actions: [],
        resolution: 'investigating',
      });

      narrate(
        siteId,
        "investigating",
        `Investigating incident at site ${siteId}. Preparing troubleshooting workflow.`
      );
    } catch (e) {}

    // ---------------------------------------------------------
    // 3) HITL OR AUTO MODE
    // ---------------------------------------------------------
    if (!autoEffective()) {
      // HITL
      narrate(
        siteId,
        "routingB",
        `Routing site ${siteId} to Agent B (HITL mode).`
      );

      try {
        const agentBMod = await import('../agents/troubleshooting.js');
        const agentB = agentBMod.troubleshootingAgent;

        const out = await agentB.mitigateSite(siteId);

        if (out?.error === 'approval_required') {
          addApprovalRequest({
            siteId,
            actions: out.plan || [],
            reason: 'Troubleshooting plan requires approval',
          });

          narrate(
            siteId,
            "approvalPending",
            `Site ${siteId} requires operator approval before continuation.`
          );

        } else {
          narrate(
            siteId,
            "hitlDone",
            `Troubleshooting at site ${siteId} completed (HITL).`
          );
        }

      } catch (e) {
        narrate(
          siteId,
          "hitlError",
          `Error occurred during HITL troubleshooting at site ${siteId}.`
        );
      }

      broadcast();
      return;
    }

    // ---------------------------------------------------------
    // AUTO / E2E MODE
    // ---------------------------------------------------------
    narrate(
      siteId,
      "autoRoute",
      `Routing site ${siteId} to Agent B for automated troubleshooting.`
    );

    try {
      incrementTasksRouted(1);
      await startAgentB();

      const agentBMod = await import('../agents/troubleshooting.js');
      const agentB = agentBMod.troubleshootingAgent;

      const result = await agentB.mitigateSite(siteId);

      // ---------------------------------------------------------
      // OUTCOME → Agent C
      // ---------------------------------------------------------
      const agentCMod = await import('../agents/rca.js');
      const agentC = agentCMod.rcaAgent;

      if (result?.ok && result.allClear) {
        await agentC.recordIncident({
          siteId,
          cause: 'correlated_alarm_cluster',
          actions: result.actionsTaken || [],
          resolution: 'restored',
        });

        narrate(
          siteId,
          "restored",
          `Service at site ${siteId} fully restored after automated mitigation.`
        );

        await quiesceDownstreamAgents('auto:restored');

      } else {
        await agentC.recordIncident({
          siteId,
          cause: 'correlated_alarm_cluster',
          actions: result?.actionsTaken || [],
          resolution: 'stabilized',
        });

        narrate(
          siteId,
          "stabilized",
          `Automated mitigation stabilized site ${siteId}. Dispatch may be required if conditions persist.`
        );

        await quiesceDownstreamAgents('auto:stabilized');
      }

    } catch (e) {
      narrate(
        siteId,
        "autoError",
        `Automated troubleshooting failed at site ${siteId}.`
      );
    }

  } catch (e) {
    _log(`Agent A correlation error: ${String(e)}`);
    narrate(siteId, "correlationFail", `Correlation failed at site ${siteId}.`);
  }
  finally {
    broadcast();
  }
}

// -----------------------------------------------------------------------------------------
// Tower-Sim Signals (Resolved/Stabilized/Dispatch)
// -----------------------------------------------------------------------------------------
incidentBus.on('incident.resolved', async (evt) => {
  const siteId = evt?.siteId || 'unknown';
  _log(`terminal.signal → incident.resolved for ${siteId}`);

  narrate(
    siteId,
    "terminalResolved",
    `Incident at site ${siteId} marked resolved.`
  );

  await quiesceDownstreamAgents('incident.resolved');
  broadcast();
});

incidentBus.on('incident.stabilized', async (evt) => {
  const siteId = evt?.siteId || 'unknown';
  _log(`terminal.signal → incident.stabilized for ${siteId}`);

  narrate(
    siteId,
    "terminalStabilized",
    `Incident at site ${siteId} considered stabilized.`
  );

  await quiesceDownstreamAgents('incident.stabilized');
  broadcast();
});

incidentBus.on('dispatch.issued', async (evt) => {
  const siteId = evt?.siteId || 'unknown';
  _log(`terminal.signal → dispatch.issued for ${siteId}`);

  narrate(
    siteId,
    "terminalDispatch",
    `Dispatch issued for site ${siteId}. Field intervention recommended.`
  );

  await quiesceDownstreamAgents('dispatch.issued');
  broadcast();
});

// -----------------------------------------------------------------------------------------
// Connect to Bus
// -----------------------------------------------------------------------------------------
onIncident(async evt => {
  try { await handleEvent(evt); }
  catch (e) {
    _log(`handleEvent fatal: ${String(e)}`);
    broadcast();
  }
});

// -----------------------------------------------------------------------------------------
// Policy Change
// -----------------------------------------------------------------------------------------
onPolicyChange((p) => {
  _log(`policy.changed → { alarmPrioritization: "${p.alarmPrioritization}", waysOfWorking: "${p.waysOfWorking}", kpiAlignment: "${p.kpiAlignment}", v:${p.version} }`);
  broadcastNarration("Supervisory policy updated.");
  broadcast();
});

// -----------------------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------------------
export {
  summary, start, stop, pause, resume, note,
  subscribeLogs, subscribeStream,
  addApprovalRequest, listApprovals, resolveApproval,
  incrementTasksRouted,
};
