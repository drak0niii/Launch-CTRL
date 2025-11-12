// server/bus/deltaEmitter.js
// Turns periodic full-state snapshots into discrete alarm/service events.
//
// Usage in bridge or anywhere you handle full snapshots:
//   import { deltaEmitter } from './bus/deltaEmitter.js';
//   deltaEmitter.ingest(payload.state);
//
// Emits BOTH legacy typed events and a unified envelope on incidentBus:
//   this.bus.emit('alarm.raised',  { ... })
//   this.bus.emit('alarm.cleared', { ... })
//   this.bus.emit('service.changed', { ... })
//   this.bus.emit('event', { type:'alarm.raised'|'alarm.cleared'|'service.changed', ... })

import { incidentBus } from './incidentBus.js';

/** Whether to emit the current alarms as "raised" on the very first snapshot. */
const BOOTSTRAP_EMIT_CURRENT = true;

/** Return an object of Sets with the current alarms per site. */
function extractAlarmsBySite(state) {
  const out = {};
  const sites = (state && state.sites) || {};
  for (const [siteId, site] of Object.entries(sites)) {
    const arr = Array.isArray(site?.alarms) ? site.alarms : [];
    out[siteId] = new Set(arr);
  }
  return out;
}

/** Return a compact service map per site. */
function extractServiceBySite(state) {
  const out = {};
  const sites = (state && state.sites) || {};
  for (const [siteId, site] of Object.entries(sites)) {
    out[siteId] = {
      antenna1: site?.antenna1?.service,
      antenna2: site?.antenna2?.service,
    };
  }
  return out;
}

/** Shallow clone helper for { [k]: Set } maps. */
function cloneMapOfSets(map) {
  const out = {};
  for (const [k, set] of Object.entries(map)) out[k] = new Set(set);
  return out;
}

export class DeltaEmitter {
  constructor(bus, options = {}) {
    this.bus = bus;
    this.bootstrapEmit = options.bootstrapEmit ?? BOOTSTRAP_EMIT_CURRENT;

    /** @type {Record<string, Set<string>>} */
    this.lastAlarmsBySite = null;

    /** @type {Record<string, {antenna1?: string, antenna2?: string}>} */
    this.lastServiceBySite = null;
  }

  /** Clear any remembered state (e.g., when reconnecting the stream). */
  reset() {
    this.lastAlarmsBySite = null;
    this.lastServiceBySite = null;
  }

  /** Unified emit helper: fires legacy typed event AND unified envelope. */
  #emitBoth(type, payload) {
    try {
      this.bus.emit(type, payload);
    } catch {}
    try {
      this.bus.emit('event', { type, ...payload });
    } catch {}
  }

  /**
   * Ingest a new full-state snapshot (payload.state from the bus).
   * Computes deltas vs previous snapshot and emits events.
   * @param {object} newState
   */
  ingest(newState) {
    const ts = new Date().toISOString();

    // Current compact views
    const curAlarms = extractAlarmsBySite(newState);
    const curService = extractServiceBySite(newState);

    // First snapshot: optionally emit existing alarms as raised, and just store services.
    if (!this.lastAlarmsBySite || !this.lastServiceBySite) {
      if (this.bootstrapEmit) {
        for (const [siteId, alarmsSet] of Object.entries(curAlarms)) {
          for (const alarm of alarmsSet) {
            const payload = { siteId, alarm, ts, source: 'delta', bootstrap: true };
            this.#emitBoth('alarm.raised', payload);
          }
        }
      }
      this.lastAlarmsBySite = cloneMapOfSets(curAlarms);
      this.lastServiceBySite = { ...curService };
      return;
    }

    // Compute alarm deltas (raised / cleared) across union of siteIds.
    const allSites = new Set([
      ...Object.keys(this.lastAlarmsBySite),
      ...Object.keys(curAlarms),
    ]);

    for (const siteId of allSites) {
      const prevSet = this.lastAlarmsBySite[siteId] ?? new Set();
      const nextSet = curAlarms[siteId] ?? new Set();

      // Raised: in next but not in prev.
      for (const alarm of nextSet) {
        if (!prevSet.has(alarm)) {
          const payload = { siteId, alarm, ts, source: 'delta' };
          this.#emitBoth('alarm.raised', payload);
        }
      }

      // Cleared: in prev but not in next.
      for (const alarm of prevSet) {
        if (!nextSet.has(alarm)) {
          const payload = { siteId, alarm, ts, source: 'delta' };
          this.#emitBoth('alarm.cleared', payload);
        }
      }
    }

    // Compute service changes per antenna (antenna1/antenna2).
    const allSitesSvc = new Set([
      ...Object.keys(this.lastServiceBySite),
      ...Object.keys(curService),
    ]);

    for (const siteId of allSitesSvc) {
      const prev = this.lastServiceBySite[siteId] ?? {};
      const next = curService[siteId] ?? {};

      if (prev.antenna1 !== next.antenna1) {
        const payload = { siteId, antenna: 'antenna1', from: prev.antenna1, to: next.antenna1, ts, source: 'delta' };
        this.#emitBoth('service.changed', payload);
      }

      if (prev.antenna2 !== next.antenna2) {
        const payload = { siteId, antenna: 'antenna2', from: prev.antenna2, to: next.antenna2, ts, source: 'delta' };
        this.#emitBoth('service.changed', payload);
      }
    }

    // Store current compact views for next diff
    this.lastAlarmsBySite = cloneMapOfSets(curAlarms);
    this.lastServiceBySite = { ...curService };
  }
}

// Singleton export (what you’ll typically import and use)
export const deltaEmitter = new DeltaEmitter(incidentBus);
