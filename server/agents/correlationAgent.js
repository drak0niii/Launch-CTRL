// server/agents/correlationAgent.js
// Agent A — Correlation: listens to tower-sim events via the Incident Bus,
// groups alarms into incidents, and informs the Supervisor of changes.

import { onIncident } from '../bus/incidentBus.js';
import { getPolicy } from '../policy/store.js';
import { supervisorNote } from '../tools/supervisorNote.js';
import { isCriticalAlarm, isNoiseAlarm } from '../utils/policy.js';

export class CorrelationAgent {
  constructor(name = 'Agent A') {
    this.name = name;

    // lifecycle
    this.status = 'stopped';    // 'stopped' | 'running'
    this.startedAt = null;
    this.runtimeSec = 0;

    // policy / behavior
    this.delegation = 'disabled';      // enforced by policy
    this.windowMs = 5 * 60 * 1000;     // merge window (5m)

    // stats
    this.tasks = 47;                   // seed to match your UI
    this.lastTask = null;

    // state
    this.logs = [];
    this.subscribers = new Set();
    this._busUnsub = null;

    // perSite correlation buffers
    this.perSite = Object.create(null);

    this._log('initialized (stopped, delegation disabled by policy)');
  }

  // ------------- logging / summary -------------
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
      status: this.status === 'running' ? 'Active' : 'Stopped',
      delegation: this.delegation === 'enabled' ? 'Enabled' : 'Disabled',
      runtimeSec: this.runtimeSec + live,
      tasks: this.tasks,
      lastTask: this.lastTask,
    };
  }

  subscribeLogs(res) {
    this.subscribers.add(res);
    res.on('close', () => this.subscribers.delete(res));
    res.write(`data: [connected ${new Date().toISOString()}]\n\n`);
    this.logs.slice(-5).forEach(l => res.write(`data: ${l}\n\n`));
  }

  // ------------- lifecycle -------------
  start() {
    if (this.status === 'running') return 'Already running';

    // enforce delegation policy (always disabled for now)
    if (this.delegation !== 'disabled') {
      this.delegation = 'disabled';
      this._log('delegation disabled (policy enforced)');
    }

    this.status = 'running';
    this.startedAt = new Date();

    // refresh behavior knobs from policy (hook point)
    const p = getPolicy();
    this.windowMs = 5 * 60 * 1000; // default; extend with policy later if needed
    void p; // silence linter if unused

    // subscribe to incident bus
    this._busUnsub = this._attachBus();

    this._log('started (listening to incident bus)');
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

    if (this._busUnsub) {
      try { this._busUnsub(); } catch {}
      this._busUnsub = null;
    }

    this._log(`stopped (accumulated ${delta}s)`);
    return 'OK: stopped';
  }

  setDelegation(_enabled) {
    // policy says: always disabled
    if (this.delegation !== 'disabled') {
      this.delegation = 'disabled';
      this._log('delegation disabled (policy enforced)');
      return 'OK: delegation disabled (policy)';
    }
    this._log('delegation already disabled (policy)');
    return 'OK: delegation disabled (policy)';
  }

  // ------------- bus handling -------------
  _attachBus() {
    const handler = (evt) => this._onIncident(evt);
    onIncident(handler);
    return () => { /* no-op disposer; incidentBus currently has no unsubscribe */ };
  }

  _onIncident(evt) {
    if (this.status !== 'running') return;

    // Visibility only
    if (evt.type === 'bus.disconnected') { this._log('bus disconnected (tower-sim unavailable)'); return; }
    if (evt.type === 'bus.reconnected')  { this._log('bus reconnected (tower-sim available)');  return; }

    // We only correlate alarms and state updates
    const isAlarmEvt = evt.type === 'alarm.raised' || evt.type === 'alarm.cleared';
    const isState    = evt.type === 'state.update';
    if (!isAlarmEvt && !isState) return;

    const siteId = evt.siteId || 'unknown';

    // For state updates: if healthy, close open incident & bail
    if (isState) {
      const siteSnap = evt?.state?.sites?.[siteId];
      if (siteSnap && siteSnap.siteAlive && siteSnap.mains === 'on') {
        this._closeOpenIncident(siteId, 'service_restored');
      }
      return;
    }

    // --- Alarm events: filter noise first ---
    const alarm = evt.alarm || evt.type || 'unknown';
    if (!siteId || siteId === 'unknown') return;         // skip unknown site noise
    if (isNoiseAlarm(alarm)) return;                      // skip unknown/heartbeat/noop

    // Policy-aware filter (case-insensitive)
    const policyMode = String(getPolicy()?.alarmPrioritization || '').toLowerCase() || 'critical first';
    if (policyMode === 'critical first' && !isCriticalAlarm(alarm)) {
      // ignore non-critical alarms in this mode
      return;
    }

    // Merge into incident window
    const s = this._ensureSite(siteId);
    const now = Date.now();
    const withinWindow = s.open && (now - new Date(s.open.end).getTime() <= this.windowMs);

    if (!s.open) {
      s.open = this._newIncident(siteId, evt);
      this._notifyStart(s.open);
    } else if (withinWindow) {
      this._extend(s.open, evt);
    } else {
      this._closeOpenIncident(siteId, 'window_elapsed');
      s.open = this._newIncident(siteId, evt);
      this._notifyStart(s.open);
    }

    // If the alarm cleared and no critical remains, close early
    if (evt.type === 'alarm.cleared') {
      const hasCritical = (s.open?.types ?? new Set()).size
        ? [...s.open.types].some(isCriticalAlarm)
        : false;
      if (!hasCritical) {
        this._closeOpenIncident(siteId, 'alarm_cleared');
      }
    }
  }

  // ------------- correlation primitives -------------
  _ensureSite(siteId) {
    if (!this.perSite[siteId]) this.perSite[siteId] = { open: null, closed: [] };
    return this.perSite[siteId];
  }

  _newIncident(siteId, evt) {
    const inc = {
      siteId,
      start: evt.timestamp,
      end: evt.timestamp,
      count: 1,
      types: new Set([evt.alarm || evt.type]),
      events: [evt],
    };
    return inc;
  }

  _extend(inc, evt) {
    inc.end = evt.timestamp;
    inc.count += 1;
    inc.types.add(evt.alarm || evt.type);
    inc.events.push(evt);
  }

  _closeOpenIncident(siteId, reason = 'closed') {
    const s = this._ensureSite(siteId);
    if (!s.open) return;
    const closed = s.open;
    s.open = null;

    const out = {
      siteId,
      start: closed.start,
      end: closed.end,
      count: closed.count,
      types: [...closed.types],
      events: closed.events,
      reason,
    };
    s.closed.push(out);

    this.lastTask = `incident.closed ${siteId} (${reason}) with ${out.count} events`;
    this.tasks += 1;
    this._log(this.lastTask);

    // Inform Supervisor (fire-and-forget)
    supervisorNote(
      `Correlation: closed incident @${siteId} (${reason}). Alarms: ${out.types.join(', ')}`
    );
    return out;
  }

  _notifyStart(inc) {
    this.lastTask = `incident.started ${inc.siteId} (alarms=${[...inc.types].join(', ')})`;
    this.tasks += 1;
    this._log(this.lastTask);

    // Inform Supervisor (fire-and-forget)
    supervisorNote(
      `Correlation: started incident @${inc.siteId} (${[...inc.types].join(', ')})`
    );
  }

  // ------------- utility (optional external call) -------------
  correlate(events = []) {
    // Batch-correlation with the same noise & policy filters applied.
    const policyMode = String(getPolicy()?.alarmPrioritization || '').toLowerCase() || 'critical first';

    const filtered = events.filter((e) => {
      const siteId = e.siteId ?? 'unknown';
      const typ = e.type || e.alarm || 'unknown';
      if (!siteId || siteId === 'unknown') return false;
      if (isNoiseAlarm(typ)) return false;
      if (policyMode === 'critical first' && !isCriticalAlarm(typ)) return false;
      return true;
    });

    const bySite = new Map();
    for (const e of filtered) {
      const k = e.siteId;
      if (!bySite.has(k)) bySite.set(k, []);
      bySite.get(k).push(e);
    }

    const incidents = [];
    const WINDOW_MS = this.windowMs;

    for (const [site, list] of bySite.entries()) {
      list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      let cur = null;

      const PUSH = () => {
        if (!cur) return;
        incidents.push({
          siteId: site,
          start: cur.start,
          end: cur.end,
          count: cur.count,
          types: [...cur.types],
          events: cur.events,
        });
      };

      for (const ev of list) {
        const t = new Date(ev.timestamp).getTime();
        if (!cur) {
          cur = { start: ev.timestamp, end: ev.timestamp, count: 1, types: new Set([ev.type || ev.alarm]), events: [ev] };
          continue;
        }
        const last = new Date(cur.end).getTime();
        if (t - last <= WINDOW_MS) {
          cur.end = ev.timestamp;
          cur.count++;
          cur.types.add(ev.type || ev.alarm);
          cur.events.push(ev);
        } else {
          PUSH();
          cur = { start: ev.timestamp, end: ev.timestamp, count: 1, types: new Set([ev.type || ev.alarm]), events: [ev] };
        }
      }
      PUSH();
    }

    this.lastTask = `correlated ${filtered.length} events → ${incidents.length} incidents`;
    this.tasks += 1;
    this._log(this.lastTask);
    return { incidents };
  }
}

export const correlationAgent = new CorrelationAgent('Agent A');
