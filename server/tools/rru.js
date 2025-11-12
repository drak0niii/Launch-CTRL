// server/tools/rru.js
// Thin adapter around tower/client.rru with a couple of conveniences

import { rru as rruApi } from '../tower/client.js';

function nowIso() { return new Date().toISOString(); }

/**
 * Raw RRU command.
 * @param {{site: string, antenna: 'a1'|'a2', state: 'on'|'off'}} params
 * @returns {Promise<{ok: boolean, ts: string, result?: any, error?: string}>}
 */
export async function rru(params = {}) {
  try {
    const result = await rruApi(params);
    return { ok: true, ts: nowIso(), result };
  } catch (e) {
    return { ok: false, ts: nowIso(), error: String(e?.message || e) };
  }
}

export function rruOn(site, antenna) {
  return rru({ site, antenna, state: 'on' });
}

export function rruOff(site, antenna) {
  return rru({ site, antenna, state: 'off' });
}

/**
 * Ensure a radio ends in Available; returns {ok:boolean, attempts:number}
 * Leaves the detailed healing strategy to Agent B; this is a light helper.
 */
export async function ensureRru(site, antenna) {
  const res = await rruOn(site, antenna);
  return { ok: !!res.ok, attempts: 1, raw: res };
}
