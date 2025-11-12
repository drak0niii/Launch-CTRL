// server/supervisor/store.js
// Supervisor (Manager) — in-memory state, logs, SSE, and orchestration

import { EventEmitter } from 'events';
import { getPolicy, onChange as onPolicyChange } from '../policy/store.js';
import { incidentBus } from '../bus/incidentBus.js';
import { getTowerSnapshot } from '../tower/bridge.js'; // ← cold-start sweep source
// avoid circulars: lazy-import agents only when needed
import { getAutoStatus as _getAutoStatus } from './pipeline.js';

const logSubscribers = new Set();     // SSE clients for logs
const bus = new EventEmitter();       // event bus for snapshot stream
const onIncident = (cb) => incidentBus.on('bus.event', cb); // ✅ only normalized events

// ---- Alarm/Service visibility tap (one-time, logs only — no routing) ----
let _alarmTapWired = false;
(function wireAlarmTapOnce() {
  if (_alarmTapWired) return;
  _alarmTapWired = true;

  incidentBus.on('alarm.raised',  e => console.log(`[ALARM↑] ${e.siteId} "${e.alarm}" ${e.ts}`));
  incidentBus.on('alarm.cleared', e => console.log(`[ALARM↓] ${e.siteId} "${e.alarm}" ${e.ts}`));
  incidentBus.on('service.changed', e =>
    console.log(`[SERVICE] ${e.siteId} ${e.antenna}: ${e.from || '—'} → ${e.to || '—'} ${e.ts}`)
  );
})();

const supervisor = {
  status: 'idle',              // 'idle' | 'running' | 'paused' | 'stopped'
  startedAt: null,             // Date | null
  runtimeSec: 0,               // accumulates when stopped
  tasksRouted: 0,              // incremented when we trigger agents
  lastNote: null,
  logs: [],                    // string[]
  approvals: [],               // [{id, siteId, actions, reason, createdAt}]
  nextApprovalId: 1,
};

// ---------- small utils ----------
const safeNowIso = () => new Date().toISOString();
const isE2E = () => String(getPolicy()?.waysOfWorking || '').toLowerCase() === 'e2e automation';
const getAutoStatus = () => {
  try { return typeof _getAutoStatus === 'function' ? (_getAutoStatus() || {}) : {}; }
  catch { return {}; }
};
const autoEffective = () => {
  const polAllows = isE2E();
  const stored = !!getAutoStatus().enabled;
  return polAllows || stored;
};

function _log(msg) {
  const line = `[${safeNowIso()}] [SUPERVISOR] ${msg}`;
  supervisor.logs.push(line);
  if (supervisor.logs.length > 2000) supervisor.logs.shift();
  for (const res of logSubscribers) {
    try { res.write(`data: ${line}\n\n`); } catch {}
  }
}

// ---------- SSE: logs ----------
function subscribeLogs(res) {
  logSubscribers.add(res);
  res.on('close', () => {
    logSubscribers.delete(res);
    try { res.end(); } catch {}
  });
}

// ---------- public snapshot ----------
function summary() {
  const live = supervisor.startedAt ? Math.floor((Date.now() - supervisor.startedAt.getTime()) / 1000) : 0;
  const pol = getPolicy();
  const storedAutoEnabled = !!getAutoStatus().enabled;
  const policyAllowsAuto = isE2E();
  const autoEnabled = policyAllowsAuto || storedAutoEnabled;

  return {
    status: supervisor.status,
    startedAt: supervisor.startedAt,
    runtimeSec: supervisor.runtimeSec + live,
    tasksRouted: supervisor.tasksRouted,
    lastNote: supervisor.lastNote,
    autoEnabled,               // EFFECTIVE (policy OR stored toggle)
    storedAutoEnabled,         // raw toggle from pipeline
    approvalsPending: supervisor.approvals.length,
    policy: pol,
  };
}

// ---------- snapshot stream helpers ----------
function broadcast() {
  bus.emit('supervisor', summary());
}

function subscribeStream(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`event: supervisor\ndata: ${JSON.stringify(summary())}\n\n`);

  const handler = (snap) => {
    try { res.write(`event: supervisor\ndata: ${JSON.stringify(snap)}\n\n`); } catch {}
  };
  bus.on('supervisor', handler);

  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 30000);

  res.on('close', () => {
    clearInterval(ping);
    bus.off('supervisor', handler);
    try { res.end(); } catch {}
  });
}

// ---------- Agent helpers ----------
async function lazyAgentA() {
  const mod = await import('../agents/correlationAgent.js');
  return mod.correlationAgent;
}
async function lazyAgentB() {
  const mod = await import('../agents/troubleshooting.js');
  return mod.troubleshootingAgent;
}
async function lazyAgentC() {
  const mod = await import('../agents/rca.js');
  return mod.rcaAgent;
}
async function ensureAgentsRunning() {
  try { const a = await lazyAgentA(); if (a.status !== 'running') a.start(); } catch (e) { _log(`Agent A start err: ${String(e?.message || e)}`); }
  try { const b = await lazyAgentB(); if (b.status !== 'running') b.start(); } catch (e) { _log(`Agent B start err: ${String(e?.message || e)}`); }
  try { const c = await lazyAgentC(); if (c.status !== 'running') c.start(); } catch (e) { _log(`Agent C start err: ${String(e?.message || e)}`); }
}
async function ensureAgentsStopped() {
  try { const a = await lazyAgentA(); a.stop?.(); } catch {}
  try { const b = await lazyAgentB(); b.stop?.(); } catch {}
  try { const c = await lazyAgentC(); c.stop?.(); } catch {}
}

// ---------- lifecycle ----------
async function coldStartSweep() {
  try {
    const snap = await getTowerSnapshot();
    if (!snap?.ok) return;
    // We expect structure: { sites: { [siteId]: { alarms: string[] } } }
    const sites = snap.sites || {};
    let count = 0;
    for (const [siteId, site] of Object.entries(sites)) {
      const alarms = Array.isArray(site?.alarms) ? site.alarms : [];
      for (const alarm of alarms) {
        // Synthesize an alarm.raised so the pipeline treats existing faults as actionable
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
    if (count > 0) _log(`cold-start sweep → synthesized ${count} alarm.raised events`);
  } catch (e) {
    _log(`cold-start sweep error: ${String(e?.message || e)}`);
  }
}

async function start() {
  if (supervisor.status === 'running') return 'Already running';
  if (supervisor.status === 'paused') {
    resume();
    return 'Resumed';
  }
  supervisor.status = 'running';
  supervisor.startedAt = new Date();
  _log('started');
  await ensureAgentsRunning();     // ← Supervisor controls agents
  await coldStartSweep();          // ← process pre-existing alarms
  broadcast();
  return 'OK: started';
}

function stop() {
  if (supervisor.status === 'running' || supervisor.status === 'paused') {
    const delta = Math.floor((Date.now() - (supervisor.startedAt?.getTime() || Date.now())) / 1000);
    supervisor.runtimeSec += Math.max(0, delta);
  }
  supervisor.startedAt = null;
  supervisor.status = 'stopped';
  ensureAgentsStopped();           // ← Supervisor stops agents
  _log('stopped');
  broadcast();
  return 'OK: stopped';
}

function pause() {
  if (supervisor.status !== 'running') return 'Not running';
  const delta = Math.floor((Date.now() - (supervisor.startedAt?.getTime() || Date.now())) / 1000);
  supervisor.runtimeSec += Math.max(0, delta);
  supervisor.startedAt = null;
  supervisor.status = 'paused';
  _log('paused');
  broadcast();
  return 'OK: paused';
}

function resume() {
  if (supervisor.status !== 'paused') return 'Not paused';
  supervisor.startedAt = new Date();
  supervisor.status = 'running';
  _log('resumed');
  ensureAgentsRunning();           // keep agents in sync
  broadcast();
  return 'OK: resumed';
}

function note(message) {
  supervisor.lastNote = String(message || '');
  _log(`note: ${supervisor.lastNote}`);
  broadcast();
  return 'OK: noted';
}

// ---------- approvals (HITL) ----------
function addApprovalRequest({ siteId, actions = [], reason = '' }) {
  const id = String(supervisor.nextApprovalId++);
  const item = { id, siteId, actions, reason, createdAt: safeNowIso() };
  supervisor.approvals.push(item);
  supervisor.lastNote = `Approval requested #${id} for ${siteId}`;
  _log(`approval.requested → #${id} site=${siteId} reason="${reason}" steps=${actions.length}`);
  broadcast();
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
  _log(`approval.${decision} → #${id} site=${item.siteId}`);
  broadcast();
  return item;
}
function incrementTasksRouted(n = 1) {
  supervisor.tasksRouted = (supervisor.tasksRouted || 0) + n;
}

// React to policy changes (logs AND broadcast a fresh summary)
onPolicyChange((p) => {
  _log(
    `policy.changed → { alarmPrioritization: "${p.alarmPrioritization}", waysOfWorking: "${p.waysOfWorking}", kpiAlignment: "${p.kpiAlignment}", v:${p.version} }`
  );
  broadcast();
});

// ---------- exact-duplicate guard (event-id ledger) ----------
const processed = new Map(); // id -> ts
const PROCESSED_TTL_MS = 60_000; // keep ids for 60s to avoid WS/HTTP mirror dupes

function eventId(evt) {
  const t = String(evt?.type || '');
  const s = String(evt?.siteId || '');
  const a = String(evt?.alarm || '');
  // Timestamps can be high-res; normalize to the exact string you get
  const ts = String(evt?.timestamp || evt?.ts || '');
  return `${t}|${s}|${a}|${ts}`;
}

function remember(id) {
  processed.set(id, Date.now());
  // light pruning
  if (processed.size > 5000) {
    const cutoff = Date.now() - PROCESSED_TTL_MS;
    for (const [k, v] of processed) {
      if (v < cutoff) processed.delete(k);
    }
  }
}

// ============================================================================
// 🧭 INCIDENT BUS → SUPERVISOR (orchestrates A→B→C flow)
// ============================================================================
async function handleEvent(evt) {
  const id = eventId(evt);
  if (processed.has(id)) {
    _log(`event.duplicate → ${id}`);
    return; // exact same event already handled; do not run again
  }
  remember(id);

  const siteId = (evt?.siteId && String(evt.siteId).trim()) || null;
  _log(`bus.event → ${JSON.stringify({ type: evt?.type, siteId, alarm: evt?.alarm, ts: evt?.timestamp || evt?.ts })}`);

  if (supervisor.status !== 'running') {
    _log('supervisor.idle → ignoring bus event');
    return;
  }
  if (!siteId) {
    _log('event.skipped → missing siteId');
    return;
  }

  // Actionable types; ignore pure snapshots
  const actionable = new Set(['alarm.raised', 'service.changed']);
  if (!actionable.has(String(evt?.type))) {
    _log(`event.skipped → non-actionable type: ${evt?.type}`);
    return;
  }

  // ---- 1) Ensure Agent A is running, correlate this site/event ----
  try {
    const agentA = await lazyAgentA();
    if (agentA.status !== 'running') agentA.start();

    const correlateInput = [{
      siteId,
      type: evt.alarm || evt.type || 'unknown',
      timestamp: evt.timestamp || evt.ts || safeNowIso(),
    }];
    const corr = agentA.correlate(correlateInput);
    const incidents = corr?.incidents || [];
    _log(`Agent A: ${siteId} → ${incidents.length} incident(s)`);

    if (incidents.length === 0) {
      broadcast();
      return; // nothing actionable
    }

    // ---- 2) Record "investigating" in Agent C immediately ----
    try {
      const agentC = await lazyAgentC();
      await agentC.recordIncident({
        siteId,
        cause: 'correlated_alarm_cluster',
        actions: [],
        resolution: 'investigating',
      });
      _log(`Agent C: investigating recorded for ${siteId}`);
    } catch (e) {
      _log(`Agent C record (investigating) error: ${String(e?.message || e)}`);
    }

    // ---- 3) Decide HITL vs E2E and handle Agent B ----
    if (!autoEffective()) {
      try {
        const agentB = await lazyAgentB();
        if (agentB.status !== 'running') agentB.start();

        const out = await agentB.mitigateSite(siteId);
        if (out && out.error === 'approval_required') {
          addApprovalRequest({
            siteId,
            actions: out.plan || [],
            reason: 'Troubleshooting HITL plan requires approval',
          });
          _log(`HITL: plan queued for approval @ ${siteId} (steps=${(out.plan || []).length})`);
        } else {
          _log(`HITL: result for ${siteId} (ok=${out?.ok}, err=${out?.error || 'none'})`);
        }
      } catch (e) {
        _log(`Agent B HITL planning error for ${siteId}: ${String(e?.message || e)}`);
      }
      broadcast();
      return;
    }

    // Auto/E2E → run B
    try {
      const agentB = await lazyAgentB();
      if (agentB.status !== 'running') agentB.start();

      incrementTasksRouted(1);
      _log(`Agent B: mitigating ${siteId}…`);
      const result = await agentB.mitigateSite(siteId);

      // ---- 4) Inform Agent C of outcome (restored vs stabilized) ----
      try {
        const agentC = await lazyAgentC();
        if (result?.ok && result.allClear) {
          await agentC.recordIncident({
            siteId,
            cause: 'correlated_alarm_cluster',
            actions: result.actionsTaken || [],
            resolution: 'restored',
          });
          _log(`Agent C: restored recorded for ${siteId}`);
        } else {
          await agentC.recordIncident({
            siteId,
            cause: 'correlated_alarm_cluster',
            actions: result?.actionsTaken || [],
            resolution: 'stabilized',
          });
          _log(`Agent C: stabilized/dispatch-suggested recorded for ${siteId}`);
        }
      } catch (e) {
        _log(`Agent C record (post-B) error: ${String(e?.message || e)}`);
      }
    } catch (e) {
      _log(`Agent B mitigation error for ${siteId}: ${String(e?.message || e)}`);
    }
  } catch (e) {
    _log(`Agent A correlation error: ${String(e?.message || e)}`);
  } finally {
    broadcast();
  }
}

// Wire the single normalized stream
onIncident(async (evt) => {
  try { await handleEvent(evt); }
  catch (e) {
    _log(`handleEvent fatal: ${String(e?.message || e)}`);
    broadcast();
  }
});

// ---------- exports ----------
export {
  summary, start, stop, pause, resume, note,
  subscribeLogs, subscribeStream,
  addApprovalRequest, listApprovals, resolveApproval,
  incrementTasksRouted,
};
