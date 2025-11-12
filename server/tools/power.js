// server/tools/power.js
// Thin adapter around tower/client.power with stable return shape

import { power } from '../tower/client.js';

function nowIso() { return new Date().toISOString(); }

/**
 * Set power state for one site or "all".
 * @param {{sites?: string, state: 'on'|'off'}} params
 * @returns {Promise<{ok: boolean, ts: string, result?: any, error?: string}>}
 */
export async function setPower(params = {}) {
  try {
    const result = await power(params);
    return { ok: true, ts: nowIso(), result };
  } catch (e) {
    return { ok: false, ts: nowIso(), error: String(e?.message || e) };
  }
}

/** Convenience helpers */
export function powerOn(siteId = 'all') {
  return setPower({ sites: siteId, state: 'on' });
}

export function powerOff(siteId = 'all') {
  return setPower({ sites: siteId, state: 'off' });
}
