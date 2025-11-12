// server/tower/client.js
// HTTP client wrapper for tower-sim control and state endpoints.

const BASE = process.env.TOWER_HTTP_BASE || 'http://127.0.0.1:7071';
const RETRY_MS = 1000;
const MAX_RETRIES = 2;

// --- Internal helper for safe JSON fetch with retries ---
async function json(req, attempt = 0) {
  try {
    const res = await req;
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await res.json() : await res.text();

    if (!res.ok) {
      const msg = typeof body === 'string' ? body : body?.error || 'Request failed';
      throw new Error(`[tower-client] ${msg}`);
    }
    return body;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      console.warn(`[tower-client] Retry ${attempt + 1}/${MAX_RETRIES} after error: ${err.message}`);
      await new Promise(r => setTimeout(r, RETRY_MS));
      return json(req, attempt + 1);
    }
    console.error('[tower-client] Request failed permanently:', err.message);
    throw err;
  }
}

// --- API methods ---
export async function getState() {
  return json(fetch(`${BASE}/state`));
}

export async function power({ sites = 'all', state }) {
  return json(fetch(`${BASE}/power`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sites, state }),
  }));
}

export async function rru({ site, antenna, state }) {
  return json(fetch(`${BASE}/rru`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site, antenna, state }),
  }));
}

export async function scenario({ site, mode, crqId }) {
  return json(fetch(`${BASE}/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site, mode, crqId }),
  }));
}

// Optional general command passthrough
export async function action(command) {
  return json(fetch(`${BASE}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  }));
}

// --- Snapshot helper used by Supervisor / RCA ---
export async function getTowerSnapshot() {
  try {
    const state = await getState();
    return { ok: true, state, source: BASE };
  } catch (err) {
    console.error('[tower-client] getTowerSnapshot failed:', err.message);
    return { ok: false, error: err.message, source: BASE };
  }
}

// Expose base URL for diagnostics
export function getTowerBase() {
  return BASE;
}

console.log(`[tower-client] Connected to tower-sim base: ${BASE}`);
