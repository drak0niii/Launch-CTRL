// server/agents/rca.js
// Agent C — RCA / Dispatch Agent (AI)
// Records incidents, determines root cause category, stabilisation vs restoration,
// suggests dispatch, composes dispatch emails, and emits terminal signals.
//
// Compatible with hybrid narration + Supervisor pipeline auto-quiesce.

import { getState } from '../tower/client.js';
import { supervisorNote } from '../tools/supervisorNote.js';
import { incidentBus } from '../bus/incidentBus.js';   // emits resolved/stabilized/dispatch.issued

const NOISE_CAUSES = new Set(['unknown', 'heartbeat', 'noop']);
const DEDUP_WINDOW_MS = 10_000;

export class RcaAgent {
  constructor(name = 'Agent C') {
    this.name = name;
    this.status = 'stopped';
    this.startedAt = null;
    this.runtimeSec = 0;
    this.tasks = 0;
    this.lastTask = null;

    this.logs = [];
    this.subscribers = new Set();

    // RCA casebook
    this.casebook = [];
    this._lastBySite = new Map();   // dedup per site

    this._log('initialized (stopped)');
  }

  // ---------------------------------------------------------------------------
  // Logging + Summary
  // ---------------------------------------------------------------------------
  _log(msg) {
    const line = `[${new Date().toISOString()}] [${this.name}] ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 2000) this.logs.shift();

    for (const res of this.subscribers) {
      try { res.write(`data: ${line}\n\n`); } catch {}
    }
  }

  get summary() {
    const live = this.startedAt ? Math.floor((Date.now() - this.startedAt.getTime()) / 1000) : 0;
    return {
      name: this.name,
      status: this.status === 'running' ? 'Active' : this.status === 'stopped' ? 'Stopped' : 'Idle',
      runtimeSec: this.runtimeSec + live,
      tasks: this.tasks,
      lastTask: this.lastTask,
    };
  }

  snapshot() { return this.summary; }

  subscribeLogs(res) {
    this.subscribers.add(res);
    res.on('close', () => this.subscribers.delete(res));

    res.write(`data: [connected ${new Date().toISOString()}]\n\n`);
    this.logs.slice(-10).forEach(L => res.write(`data: ${L}\n\n`));
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  start() {
    if (this.status === 'running') return 'Already running';
    this.status = 'running';
    this.startedAt = new Date();
    this._log('started');
    return 'OK: started';
  }

  stop() {
    if (this.status !== 'running') {
      this.status = 'stopped';
      this._log('stopped (no-op)');
      return 'OK: stopped';
    }

    const delta = Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
    this.runtimeSec += delta;
    this.startedAt = null;
    this.status = 'stopped';

    this._log(`stopped (accumulated ${delta}s)`);
    return 'OK: stopped';
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  _isNoise({ siteId, cause }) {
    if (!siteId || siteId === 'unknown') return true;
    const c = String(cause || '').toLowerCase();
    return NOISE_CAUSES.has(c);
  }

  _dedup(siteId, cause, resolution) {
    const now = Date.now();
    const last = this._lastBySite.get(siteId);
    if (last &&
        last.cause === cause &&
        last.resolution === resolution &&
        (now - last.ts) < DEDUP_WINDOW_MS) {
      return true;
    }
    this._lastBySite.set(siteId, { cause, resolution, ts: now });
    return false;
  }

  async _fetchSite(siteId) {
    const snap = await getState().catch(() => null);
    return snap?.state?.sites?.[siteId] || null;
  }

  _detectAlarmsFromSite(site) {
    if (!site) return [];
    const out = [];

    if (site.mains === 'off') out.push('Mains.Off');
    if (site.siteAlive === false) out.push('Site.Down');
    if (site.antenna1?.service === 'Unavailable') out.push('Antenna.A1.Unavailable');
    if (site.antenna2?.service === 'Unavailable') out.push('Antenna.A2.Unavailable');

    return out;
  }

  _buildSummaryLine({ siteId, cause, resolution }, site, alarms) {
    const mains = site?.mains ?? 'n/a';
    const alive = site?.siteAlive === true ? 'up' : site?.siteAlive === false ? 'down' : 'n/a';
    const a1 = site?.antenna1?.service ?? 'n/a';
    const a2 = site?.antenna2?.service ?? 'n/a';
    const alarmTxt = alarms.length ? `alarms=[${alarms.join(', ')}]` : 'alarms=none';

    return `Site ${siteId}: cause=${cause} • resolution=${resolution} • mains=${mains} • cell=${alive} • A1=${a1} • A2=${a2} • ${alarmTxt}`;
  }

  // ---------------------------------------------------------------------------
  // Unified entry point used by Supervisor
  // ---------------------------------------------------------------------------
  record(summary) {
    const siteId = summary?.siteId ?? 'unknown';
    const cause = summary?.cause ?? 'correlated_alarm_cluster';
    const actions = summary?.actions ?? [];
    const resolution = summary?.resolution ?? 'unknown';

    return this.recordIncident({ siteId, cause, actions, resolution });
  }

  // ---------------------------------------------------------------------------
  // RCA Logic + Terminal Signal Emission
  // ---------------------------------------------------------------------------
  async recordIncident({ siteId, cause, actions = [], resolution = 'unknown' }) {
    if (this.status !== 'running') this.start();

    // Noise filter
    if (this._isNoise({ siteId, cause })) {
      return { ok: false, skipped: true, reason: 'noise_or_unknown' };
    }

    // Dedup filter
    if (this._dedup(siteId, String(cause), String(resolution))) {
      return { ok: false, skipped: true, reason: 'dedup_suppressed' };
    }

    // Fresh snapshot
    const site = await this._fetchSite(siteId);
    const alarms = this._detectAlarmsFromSite(site);
    const ongoing = (String(resolution) !== 'restored') || alarms.length > 0;

    const item = {
      ts: new Date().toISOString(),
      siteId,
      cause,
      actions,
      resolution,
      ongoing,
      dispatchSuggested: ongoing,
      summary: this._buildSummaryLine({ siteId, cause, resolution }, site, alarms),
    };

    // Narration + Supervisor signals
    if (item.dispatchSuggested) {
      supervisorNote(`RCA: Dispatch suggested for ${siteId} (${item.summary})`);

      incidentBus.emit('incident.stabilized', {
        siteId,
        incidentId: `${siteId}-${Date.now()}`,
        remaining: alarms,
        ts: Date.now(),
        by: 'AgentC',
      });

    } else {
      supervisorNote(`RCA: ${siteId} resolved — ${item.summary}`);

      incidentBus.emit('incident.resolved', {
        siteId,
        incidentId: `${siteId}-${Date.now()}`,
        ts: Date.now(),
        by: 'AgentC',
      });
    }

    this.casebook.push(item);
    this.tasks += 1;
    this.lastTask = `RCA recorded ${siteId} (resolution=${resolution}, dispatchSuggested=${item.dispatchSuggested})`;
    this._log(this.lastTask);

    return { ok: true, case: item };
  }

  // ---------------------------------------------------------------------------
  // Explicit Dispatch Request
  // ---------------------------------------------------------------------------
  issueDispatch(siteId, workOrderId = `WO-${siteId}-${Date.now()}`) {
    const idx = this.casebook
      .slice()
      .reverse()
      .findIndex(c => c.siteId === siteId && !this._isNoise(c) && c.dispatchSuggested && !c.dispatchedAt);

    if (idx === -1) return { ok: false, error: 'no_pending_dispatch' };

    const realIndex = this.casebook.length - 1 - idx;
    const item = this.casebook[realIndex];

    item.dispatchedAt = new Date().toISOString();
    item.workOrderId = workOrderId;
    item.dispatchSuggested = false;

    supervisorNote(`RCA: Dispatch ISSUED for ${siteId} (WO=${workOrderId}) — ${item.summary}`);
    this._log(`dispatch.issued ${siteId} (WO=${workOrderId})`);

    incidentBus.emit('dispatch.issued', {
      siteId,
      incidentId: `${siteId}-${Date.now()}`,
      workOrderId,
      ts: Date.now(),
      by: 'AgentC',
    });

    return { ok: true, case: item };
  }

  // UI Helpers (used by dashboard)
  summaryForSite(siteId) {
    const list = this.casebook.filter(c => c.siteId === siteId && !this._isNoise(c)).slice(-5);
    const latest = list[list.length - 1] || null;

    return {
      ok: true,
      siteId,
      recent: list,
      latest,
      readyToDispatch: !!latest?.dispatchSuggested,
    };
  }

  dashboardSummary(siteId = null) {
    const items = siteId
      ? this.casebook.filter(c => c.siteId === siteId && !this._isNoise(c))
      : this.casebook.filter(c => !this._isNoise(c));

    const recent = items.slice(-10).reverse().map(c => ({
      ts: c.ts,
      siteId: c.siteId,
      cause: c.cause,
      resolution: c.resolution,
      ongoing: c.ongoing,
      dispatchSuggested: c.dispatchSuggested,
      summary: c.summary,
      workOrderId: c.workOrderId || null,
      dispatchedAt: c.dispatchedAt || null,
    }));

    const dispatchQueue = recent.filter(c => c.dispatchSuggested);

    return {
      ok: true,
      recent,
      dispatchQueue,
      totalOpen: dispatchQueue.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Email Composer
  // ---------------------------------------------------------------------------
  async composeDispatchEmail(siteId) {
    const latest = this.casebook.slice().reverse().find(c => c.siteId === siteId && !this._isNoise(c));
    if (!latest || !latest.dispatchSuggested) {
      return { ok: false, error: 'no_unresolved_case' };
    }

    const site = await this._fetchSite(siteId);
    const alarms = this._detectAlarmsFromSite(site);

    const mains = site?.mains ?? 'n/a';
    const alive = site?.siteAlive === true ? 'up' : site?.siteAlive === false ? 'down' : 'n/a';
    const a1 = site?.antenna1?.service ?? 'n/a';
    const a2 = site?.antenna2?.service ?? 'n/a';
    const batt = site?.batteryPercent ?? 'n/a';

    const actionsTxt = (latest.actions || [])
      .map(a =>
        typeof a === 'string'
          ? `- ${a}`
          : `- ${a.action || 'action'} ${a.args ? JSON.stringify(a.args) : ''} ${a.reason ? `| ${a.reason}` : ''}`
      )
      .join('\n');

    const subject = `[DISPATCH] ${siteId} – ${latest.cause || 'Degradation'} – Action required`;

    const body =
`Site: ${siteId}
When: ${latest.ts}

Current status:
  - mains = ${mains}
  - cell  = ${alive}
  - A1    = ${a1}
  - A2    = ${a2}
  - batt  = ${batt}%

Open alarms: ${alarms.length ? alarms.join(', ') : 'none'}

Actions taken so far:
${actionsTxt || '- none recorded'}

Requested next step:
- Field dispatch to investigate/restore service.
- Check grid power, site access, RRUs, and backhaul.

Summary:
${latest.summary}

Thank you,
Supervisor`;

    return { ok: true, subject, body };
  }
}

export const rcaAgent = new RcaAgent('Agent C');
