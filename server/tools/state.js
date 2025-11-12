// server/tools/state.js
// Adapter around tower/client.getState + small helpers

import { getState as getStateApi } from '../tower/client.js';

function nowIso() { return new Date().toISOString(); }

/**
 * Get full simulator state (raw).
 * @returns {Promise<{ok: boolean, ts: string, state?: any, error?: string}>}
 */
export async function getState() {
  try {
    const state = await getStateApi();
    return { ok: true, ts: nowIso(), state };
  } catch (e) {
    return { ok: false, ts: nowIso(), error: String(e?.message || e) };
  }
}

/**
 * Pull only one site snapshot from current state.
 * @param {string} siteId
 */
export async function getSite(siteId) {
  const snap = await getState();
  if (!snap.ok) return snap;
  const site = snap.state?.state?.sites?.[siteId] || null;
  return { ok: !!site, ts: snap.ts, site, error: site ? undefined : 'site_not_found' };
}

/**
 * Cheap predicate for "service restored".
 * Requires: mains=on, siteAlive=true, A1/A2 Available.
 */
export function isRestored(site) {
  if (!site) return false;
  return (
    site.mains === 'on' &&
    site.siteAlive === true &&
    site.antenna1?.service === 'Available' &&
    site.antenna2?.service === 'Available'
  );
}
