// server/agents/rca.js
// Agent C — RCA & Documentation: records cases, suggests dispatch, composes emails.

import { getState } from '../tower/client.js';
import { supervisorNote } from '../tools/supervisorNote.js';

const NOISE_CAUSES = new Set(['unknown', 'heartbeat', 'noop']); // compare lowercased
const DEDUP_WINDOW_MS = 10_000; // suppress repeats per site/cause/resolution for 10s

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
    this.casebook = []; // { ts, siteId, cause, actions[], resolution, dispatchSuggested, ongoing, summary }
    this._lastBySite = new Map(); // siteId -> { cause, resolution, ts }

    this._log('initialized (stopped)');
  }

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
      status: this.status === 'running' ? 'Active' : (this.status === 'stopped' ? 'Stopped' : 'Idle'),
      runtimeSec: this.runtimeSec + live,
      tasks: this.tasks,
      lastTask: this.lastTask,
    };
  }

  subscribeLogs(res) {
    this.subscribers.add(res);
    res.on('close', () => this.subscribers.delete(res));
    res.write(`data: [connected ${new Date().toISOString()}]\n\n`);
    this.logs.slice(-10).forEach(l => res.write(`data: ${l}\n\n`));
  }

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

  // ---------- helpers ----------
  _isNoise({ siteId, cause }) {
    if (!siteId || siteId === 'unknown') return true;
    const c = String(cause || '').toLowerCase();
    return NOISE_CAUSES.has(c);
  }

  _dedup(siteId, cause, resolution) {
    const now = Date.now();
    const last = this._lastBySite.get(siteId);
    if (last && last.cause === cause && last.resolution === resolution && (now - last.ts) < DEDUP_WINDOW_MS) {
      return true; // skip duplicate
    }
    this._lastBySite.set(siteId, { cause, resolution, ts: now });
    return false;
  }

  _detectAlarmsFromSite(site) {
    if (!site) return [];
    const alarms = [];
    if (site.mains === 'off') alarms.push('Mains.Off');
    if (site.siteAlive === false) alarms.push('Site.Down');
    if (site.antenna1?.service === 'Unavailable') alarms.push('Antenna.A1.Unavailable');
    if (site.antenna2?.service === 'Unavailable') alarms.push('Antenna.A2.Unavailable');
    return alarms;
  }

  _buildSummaryLine({ siteId, cause, resolution }, site, alarms) {
    const mains = site?.mains ?? 'n/a';
    const alive = site?.siteAlive === true ? 'up' : (site?.siteAlive === false ? 'down' : 'n/a');
    const a1 = site?.antenna1?.service ?? 'n/a';
    const a2 = site?.antenna2?.service ?? 'n/a';
    const al = alarms.length ? `alarms=[${alarms.join(', ')}]` : 'alarms=none';
    return `Site ${siteId}: cause=${cause} • resolution=${resolution} • mains=${mains} • cell=${alive} • A1=${a1} • A2=${a2} • ${al}`;
  }

  async _fetchSite(siteId) {
    const snap = await getState().catch(() => null);
    return snap?.state?.sites?.[siteId] || null;
  }

  // --- Unified entry point (used by Supervisor) ---
  record(summary) {
    const siteId = summary?.siteId ?? 'unknown';
    const cause = summary?.cause ?? 'correlated_alarm_cluster';
    const actions = summary?.actions ?? [];
    const resolution = summary?.resolution ?? 'unknown';
    return this.recordIncident({ siteId, cause, actions, resolution });
  }

  async recordIncident({ siteId, cause, actions = [], resolution = 'unknown' }) {
    if (this.status !== 'running') this.start(); // auto-start

    // Skip noise / unknown
    if (this._isNoise({ siteId, cause })) {
      return { ok: false, skipped: true, reason: 'noise_or_unknown' };
    }

    // De-dup near-identical entries per site
    if (this._dedup(siteId, String(cause), String(resolution))) {
      return { ok: false, skipped: true, reason: 'dedup_suppressed' };
    }

    // Pull latest site snapshot to decide if ongoing
    const site = await this._fetchSite(siteId);
    const alarms = this._detectAlarmsFromSite(site);

    // Ongoing => either resolution not "restored" OR there are alarms present
    const ongoing = (String(resolution) !== 'restored') || alarms.length > 0;

    const item = {
      ts: new Date().toISOString(),
      siteId,
      cause,
      actions,
      resolution,
      ongoing,
      dispatchSuggested: ongoing, // tied to real status
      summary: this._buildSummaryLine({ siteId, cause, resolution }, site, alarms),
    };

    // Supervisor notes via safe adapter (no circular import)
    if (item.dispatchSuggested) {
      supervisorNote(`RCA: Dispatch suggested for ${siteId} (${item.summary})`);
    } else {
      supervisorNote(`RCA: ${siteId} resolved — ${item.summary}`);
    }

    this.casebook.push(item);
    this.tasks += 1;
    this.lastTask = `RCA recorded ${siteId} (resolution=${resolution}, dispatch=${item.dispatchSuggested})`;
    this._log(this.lastTask);

    return { ok: true, case: item };
  }

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

  // Small helper for the UI (optional usage)
  dashboardSummary(siteId = null) {
    const items = siteId
      ? this.casebook.filter(c => c.siteId === siteId && !this._isNoise(c))
      : this.casebook.filter(c => !this._isNoise(c));

    // last 10 meaningful cases, newest first
    const recent = items.slice(-10).reverse().map(c => ({
      ts: c.ts,
      siteId: c.siteId,
      cause: c.cause,
      resolution: c.resolution,
      ongoing: c.ongoing,
      dispatchSuggested: c.dispatchSuggested,
      summary: c.summary,
    }));

    const dispatchQueue = recent.filter(c => c.dispatchSuggested);
    return {
      ok: true,
      recent,
      dispatchQueue, // show this in a "Ready to Dispatch" panel
      totalOpen: dispatchQueue.length,
    };
  }

  /**
   * Compose an email-ready subject and body for dispatch when the site is not restored.
   * Returns { ok, subject, body }. If there is no unresolved case, returns { ok:false }.
   */
  async composeDispatchEmail(siteId) {
    const latest = this.casebook.slice().reverse().find(c => c.siteId === siteId && !this._isNoise(c));
    if (!latest || !latest.dispatchSuggested) {
      return { ok: false, error: 'no_unresolved_case' };
    }

    const site = await this._fetchSite(siteId);
    const alarms = this._detectAlarmsFromSite(site);

    const mains = site?.mains ?? 'n/a';
    const alive = site?.siteAlive === true ? 'up' : (site?.siteAlive === false ? 'down' : 'n/a');
    const a1 = site?.antenna1?.service ?? 'n/a';
    const a2 = site?.antenna2?.service ?? 'n/a';
    const batt = (site?.batteryPercent ?? 'n/a');

    const actionsTxt = (latest.actions || [])
      .map(a => (typeof a === 'string'
        ? `- ${a}`
        : `- ${a.action || 'action'} ${a.args ? JSON.stringify(a.args) : ''} ${a.reason ? `| ${a.reason}` : ''}`))
      .join('\n');

    const subject = `[DISPATCH] ${siteId} – ${latest.cause || 'Degradation'} – Action required`;
    const body =
`Site: ${siteId}
When: ${latest.ts}
Current status: mains=${mains}, cell=${alive}, A1=${a1}, A2=${a2}, battery=${batt}%
Open alarms: ${alarms.length ? alarms.join(', ') : 'none detected'}

Actions taken so far:
${actionsTxt || '- none recorded'}

Requested next step:
- Field dispatch to investigate/restore service.
- Please check grid power, site access, RRUs, and backhaul as applicable.

Summary:
${latest.summary}

Thank you,
Supervisor`;

    return { ok: true, subject, body };
  }
}

export const rcaAgent = new RcaAgent('Agent C');
