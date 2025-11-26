// server/agents/troubleshooting.js
// Agent B — Troubleshooting: builds & executes a bounded mitigation plan.

import { getPolicy } from '../policy/store.js';
import { getState, power, rru } from '../tower/client.js';
import { supervisorNote } from '../tools/supervisorNote.js';
import { incidentBus } from '../bus/incidentBus.js';
import { broadcastNarration } from '../narrator/registry.js';   // ⬅️ NEW

const MAX_SWEEPS = 3;
const MAX_RRU_ATTEMPTS = 3;
const RECHECK_MS = 1200;
const BOOT_SETTLE_MS = 2500;
const BETWEEN_ACTION_MS = 500;
const HEAL_FAIL_SUPPRESS_MS = 60_000;

// cache to suppress repeated failure narrations per site/antenna
const healFailureSeen = new Map(); // key -> timestamp

export class TroubleshootingAgent {
  constructor(name = 'Agent B') {
    this.name = name;
    this.status = 'stopped';
    this.startedAt = null;
    this.runtimeSec = 0;
    this.tasks = 0;
    this.lastTask = null;
    this.logs = [];
    this.subscribers = new Set();
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

  snapshot() { return this.summary; }

  subscribeLogs(res) {
    this.subscribers.add(res);
    res.on('close', () => {
      this.subscribers.delete(res);
      try { res.end(); } catch {}
    });
  }

  start() {
    if (this.status === 'running') return 'Already running';
    this.status = 'running';
    this.startedAt = new Date();
    this._log('started');

    // === narration (friendly)
    broadcastNarration("Agent B is now online and ready to troubleshoot the active incident.");

    return 'OK: started';
  }

  stop() {
    if (this.status !== 'running') {
      this.status = 'stopped';
      this._log('stopped (no-op)');
      broadcastNarration("Agent B is now in standby."); // mild narration
      return 'OK: stopped';
    }
    const delta = Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
    this.runtimeSec += delta;
    this.startedAt = null;
    this.status = 'stopped';
    this._log(`stopped (accumulated ${delta}s)`);

    // === narration (shutdown)
    broadcastNarration(`Agent B has stopped (runtime ${delta}s).`);

    return 'OK: stopped';
  }

  async _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async _fetchSite(siteId) {
    const snap = await getState().catch(() => null);
    return snap?.state?.sites?.[siteId] || null;
  }

  async _waitAndGet(siteId, tries = 3, ms = RECHECK_MS) {
    let last = null;
    for (let i = 0; i < tries; i++) {
      await this._sleep(ms);
      last = await this._fetchSite(siteId);
      if (last) return last;
    }
    return last;
  }

  _detectAlarms(site) {
    const out = [];
    if (!site) return out;
    if (site.mains === 'off') out.push({ code: 'Mains.Off', detail: 'Grid power off' });
    if (site.siteAlive === false) out.push({ code: 'Site.Down', detail: 'Site not reachable/booting' });
    if (site.antenna1?.service === 'Unavailable') out.push({ code: 'Antenna.A1.Unavailable', detail: 'A1 RRU/service down' });
    if (site.antenna2?.service === 'Unavailable') out.push({ code: 'Antenna.A2.Unavailable', detail: 'A2 RRU/service down' });
    const batt = Number(site.batteryPercent ?? 100);
    if (site.mains === 'off' && batt < 40) out.push({ code: 'Battery.Low.GridDown', detail: `Battery ${batt}% with grid down` });
    return out;
  }

  _buildPlan(siteId, site) {
    const alarms = this._detectAlarms(site);
    const steps = [];

    if (alarms.find(a => a.code === 'Mains.Off')) {
      steps.push({ action: 'power.on', args: { siteId }, reason: 'Restore grid power' });
    }
    if (alarms.find(a => a.code === 'Antenna.A1.Unavailable')) {
      steps.push({ action: 'rru.ensure', args: { siteId, antenna: 'a1' }, reason: 'Heal A1 to Available' });
    }
    if (alarms.find(a => a.code === 'Antenna.A2.Unavailable')) {
      steps.push({ action: 'rru.ensure', args: { siteId, antenna: 'a2' }, reason: 'Heal A2 to Available' });
    }

    const batt = Number(site?.batteryPercent ?? 100);
    const a1Up = site?.antenna1?.service === 'Available';
    const a2Up = site?.antenna2?.service === 'Available';
    if (site?.mains === 'off' && batt < 40 && a1Up && a2Up) {
      steps.push({ action: 'rru.off', args: { siteId, antenna: 'a2' }, reason: 'Extend autonomy; keep A1 only' });
    }

    return { alarms, steps };
  }

  async _applyStep(step, _siteBefore) {
    const { action, args } = step || {};
    if (!action || !args) return { ok: true };

    if (action === 'power.on') {
      await power({ sites: args.siteId, state: 'on' }).catch(() => null);
      this._log(`power ON issued for ${args.siteId}`);
      supervisorNote(`Troubleshooting: powered ON ${args.siteId}`);

      broadcastNarration(`Agent B: Attempting to restore power at site ${args.siteId}.`);

      await this._sleep(BOOT_SETTLE_MS);
      return { ok: true };
    }

    if (action === 'rru.off') {
      await rru({ site: args.siteId, antenna: args.antenna, state: 'off' }).catch(() => null);
      this._log(`RRU OFF issued ${args.siteId} ${args.antenna}`);
      broadcastNarration(`Agent B: Temporarily disabling antenna ${args.antenna} to preserve battery at ${args.siteId}.`);
      return { ok: true };
    }

    if (action === 'rru.ensure') {
      broadcastNarration(`Agent B: Healing radio ${args.antenna.toUpperCase()} at ${args.siteId}…`);
      return await this._healRadio(args.siteId, args.antenna);
    }

    if (action === 'rru.on') {
      await rru({ site: args.siteId, antenna: args.antenna, state: 'on' }).catch(() => null);
      this._log(`RRU ON issued ${args.siteId} ${args.antenna}`);
      return { ok: true };
    }

    return { ok: true };
  }

  async _healRadio(siteId, antenna) {
    for (let attempt = 1; attempt <= MAX_RRU_ATTEMPTS; attempt++) {
      await rru({ site: siteId, antenna, state: 'on' }).catch(() => null);
      this._log(`RRU ON issued ${siteId} ${antenna} (attempt ${attempt}/${MAX_RRU_ATTEMPTS})`);
      await this._sleep(RECHECK_MS);
      let s = await this._fetchSite(siteId);

      if (s && s.mains === 'on' && !s.siteAlive) {
        this._log(`waiting siteAlive after RRU ON on ${siteId}…`);
        s = await this._waitAndGet(siteId, 3, RECHECK_MS) || s;
      }

      const svc = antenna === 'a1' ? s?.antenna1?.service : s?.antenna2?.service;
      if (svc === 'Available') return { ok: true };

      await rru({ site: siteId, antenna, state: 'off' }).catch(() => null);
      this._log(`RRU RESET step (OFF) ${siteId} ${antenna} (attempt ${attempt})`);
      await this._sleep(400);
      await rru({ site: siteId, antenna, state: 'on' }).catch(() => null);
      this._log(`RRU RESET step (ON) ${siteId} ${antenna} (attempt ${attempt})`);
      await this._sleep(RECHECK_MS);

      const s2 = await this._fetchSite(siteId);
      const svc2 = antenna === 'a1' ? s2?.antenna1?.service : s2?.antenna2?.service;
      if (svc2 === 'Available') return { ok: true };
    }

    // suppress repeated failure narration for same site/antenna for a short window
    const key = `${siteId}:${antenna}`;
    const last = healFailureSeen.get(key);
    const now = Date.now();
    if (!last || now - last > HEAL_FAIL_SUPPRESS_MS) {
      healFailureSeen.set(key, now);
      broadcastNarration(`Agent B: Radio ${antenna.toUpperCase()} at ${siteId} could not be restored after several attempts.`);
    }

    this._log(`RRU HEAL failed ${siteId} ${antenna} after ${MAX_RRU_ATTEMPTS} attempt(s)`);
    return { ok: false, error: 'rru_unavailable' };
  }

  async mitigateSite(siteId) {
    if (this.status !== 'running') return { ok: false, error: 'Agent not running' };

    const policy = getPolicy();
    const e2e = String(policy?.waysOfWorking || '').toLowerCase() === 'e2e automation';

    let site = await this._fetchSite(siteId);
    if (!site) {
      this._log(`mitigate: site ${siteId} not found`);
      return { ok: false, error: 'site_not_found' };
    }

    this._log(
      `mitigate: start ${siteId} (mains=${site.mains}, alive=${site.siteAlive}, batt=${site.batteryPercent}%, policy.wow="${policy?.waysOfWorking}")`
    );

    broadcastNarration(`Agent B: Starting mitigation at ${siteId} (battery ${site.batteryPercent}%).`);

    const initial = this._buildPlan(siteId, site);

    if (!e2e) {
      const planText = initial.steps.map(s => `- ${s.action} ${JSON.stringify(s.args)} | ${s.reason}`).join('\n');
      supervisorNote(`Troubleshooting (HITL): Proposed plan for ${siteId}:\n${planText || '(no actions needed)'}`);
      this._log(`policy HITL → approval required for ${siteId}, ${initial.steps.length} step(s)`);

      broadcastNarration(`Agent B: Awaiting approval to execute a ${initial.steps.length}-step plan at ${siteId}.`);

      return { ok: false, error: 'approval_required', plan: initial.steps, alarms: initial.alarms, site };
    }

    const actionsTaken = [];
    for (const step of initial.steps) {
      await this._applyStep(step, site);
      actionsTaken.push(step);
      await this._sleep(BETWEEN_ACTION_MS);
    }

    site = await this._waitAndGet(siteId, 2, RECHECK_MS) || site;
    if (site.mains === 'on' && !site.siteAlive) {
      this._log(`waiting for ${siteId} to fully boot after power on…`);
      site = await this._waitAndGet(siteId, 3, RECHECK_MS + 300) || site;
    }

    let pass = 0;
    while (pass < MAX_SWEEPS) {
      pass += 1;
      site = await this._waitAndGet(siteId, 1, RECHECK_MS) || site;

      const alarms = this._detectAlarms(site);
      const radioAlarms = alarms.filter(a => a.code.startsWith('Antenna.'));
      const mainsOff = alarms.some(a => a.code === 'Mains.Off');
      const siteDown = alarms.some(a => a.code === 'Site.Down');

      if (!mainsOff && !siteDown && radioAlarms.length === 0) break;

      for (const ra of radioAlarms) {
        const antenna = ra.code.includes('A1') ? 'a1' : 'a2';
        const ok = await this._healRadio(siteId, antenna);
        actionsTaken.push({ action: 'rru.ensure', args: { siteId, antenna }, reason: 'Radio heal sweep' });
        if (!ok.ok) this._log(`radio heal sweep could not restore ${antenna} on ${siteId}`);
        await this._sleep(BETWEEN_ACTION_MS);
      }

      if (mainsOff) {
        await power({ sites: siteId, state: 'on' }).catch(() => null);
        this._log(`retry power ON for ${siteId} during sweep`);
        actionsTaken.push({ action: 'power.on', args: { siteId }, reason: 'Sweep retry' });
        await this._sleep(BOOT_SETTLE_MS);
      }
    }

    site = await this._waitAndGet(siteId, 2, RECHECK_MS) || site;
    const finalAlarms = this._detectAlarms(site);
    const clearedAlarms = (initial.alarms || []).filter(a0 => !finalAlarms.find(a1 => a1.code === a0.code));
    const allClear = finalAlarms.length === 0;

    this.tasks += 1;
    this.lastTask = `mitigated ${siteId} (mains:${site.mains}, alive:${site.siteAlive}, batt:${site.batteryPercent}%)`;
    this._log(this.lastTask);

    if (allClear) {
      supervisorNote(`Troubleshooting: ${siteId} restored and alarms cleared (${clearedAlarms.length} cleared).`);

      broadcastNarration(`Agent B: ${siteId} fully restored. All alarms cleared.`);

      incidentBus.emit('incident.resolved', {
        siteId,
        incidentId: `${siteId}-${Date.now()}`,
        ts: Date.now(),
        by: 'AgentB',
      });
    } else {
      supervisorNote(`Troubleshooting: ${siteId} stabilized; remaining alarms=${finalAlarms.map(a => a.code).join(', ') || 'none'}.`);

      broadcastNarration(`Agent B: ${siteId} stabilised. Remaining alarms: ${finalAlarms.map(a=>a.code).join(', ') || 'none'}.`);

      incidentBus.emit('incident.stabilized', {
        siteId,
        incidentId: `${siteId}-${Date.now()}`,
        remaining: finalAlarms.map(a => a.code),
        ts: Date.now(),
        by: 'AgentB',
      });
    }

    return {
      ok: true,
      site,
      actionsTaken,
      clearedAlarms,
      remainingAlarms: finalAlarms,
      passes: pass,
      allClear,
    };
  }
}

export const troubleshootingAgent = new TroubleshootingAgent('Agent B');
