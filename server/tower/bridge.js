// server/tower/bridge.js
import http from 'http';
import WebSocket from 'ws';

// NEW: internal bus + delta diff
import { incidentBus } from '../bus/incidentBus.js';
import { deltaEmitter } from '../bus/deltaEmitter.js';

// --- CONFIG ---
const WS_URL = process.env.TOWER_WS || 'ws://localhost:7070';
const HTTP_STATE = process.env.TOWER_HTTP_STATE || 'http://localhost:7071/state';
const HTTP_REFRESH_MS = 5000;
const HTTP_TIMEOUT_MS = 3000;
const QUIET_WARN_SEC = 15;

const RECONNECT_BASE_MS = 1000;   // 1s
const RECONNECT_MAX_MS  = 10000;  // 10s
const SSE_HEARTBEAT_MS  = 15000;  // keep-alive for SSE

// --- STATE ---
let lastEnvelope = null;       // last envelope from tower-sim (state.update, alarm.raised, etc.)
let lastState = null;          // cached plain state JSON from HTTP or WS
const subscribers = new Set(); // SSE clients

let ws = null;
let wsConnected = false;
let reconnectAttempts = 0;
let lastMsgTs = 0;
let quietTimer = null;

// --- Utils ---
const nowIso = () => new Date().toISOString();

function safeJsonParse(buf) {
  try {
    return JSON.parse(typeof buf === 'string' ? buf : buf.toString());
  } catch (e) {
    console.error('[tower-bridge] Invalid JSON:', e.message);
    return null;
  }
}

function broadcast(obj) {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of subscribers) {
    try { res.write(line); } catch { /* ignore broken pipes */ }
  }
}

function startQuietTimer() {
  stopQuietTimer();
  quietTimer = setInterval(() => {
    if (!wsConnected) return;
    const idleSec = (Date.now() - lastMsgTs) / 1000;
    if (idleSec > QUIET_WARN_SEC) {
      console.warn(`[tower-bridge] No WS messages for ${idleSec.toFixed(0)}s (connected=${wsConnected}).`);
    }
  }, 5000);
}

function stopQuietTimer() {
  if (quietTimer) clearInterval(quietTimer);
  quietTimer = null;
}

// Helper: forward a normalized bus event to the incident bus (unified 'event' channel)
function emitBusEvent(data) {
  const evt = {
    type: data?.type ?? 'unknown',
    siteId: data?.siteId ?? (data?.type === 'state.update' ? 'all' : 'unknown'),
    alarm: data?.alarm ?? null,
    payload: data?.payload ?? null,
    ts: data?.ts ?? nowIso(),
  };
  incidentBus.emit('event', evt);
}

// --- WS handling with backoff ---
function connectWS() {
  try {
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      wsConnected = true;
      reconnectAttempts = 0;
      lastMsgTs = Date.now();
      // Reset delta memory on reconnect to avoid spurious clears/raises
      deltaEmitter.reset?.();
      startQuietTimer();
      console.log('[tower-bridge] WS connected:', WS_URL);
    });

    ws.on('message', (buf) => {
      const msg = safeJsonParse(buf);
      if (!msg) return;

      lastEnvelope = msg;
      lastMsgTs = Date.now();

      // Cache state when provided via WS envelopes
      if (msg?.type === 'state.update') {
        const stateObj =
          msg?.state ??                // some sims emit { type, state }
          msg?.payload?.state ?? null; // others { type, payload: { state } }

        if (stateObj && typeof stateObj === 'object') {
          lastState = stateObj;

          // Feed the delta emitter → emits alarm.raised / alarm.cleared / service.changed
          try {
            deltaEmitter.ingest(stateObj);
          } catch (e) {
            console.error('[tower-bridge] deltaEmitter.ingest error:', e?.message || e);
          }

          // Also expose a normalized bus event for Supervisor/Agents
          emitBusEvent({
            type: 'state.update',
            siteId: 'all',
            alarm: null,
            payload: { ts: nowIso(), state: stateObj },
            ts: nowIso(),
          });
        }
      } else {
        // Non-snapshot envelopes (e.g., direct alarm events) → forward as-is
        emitBusEvent({ ...msg, ts: msg.ts || nowIso() });
      }

      // Keep broadcasting to UI subscribers for the dashboard stream
      broadcast({ event: 'tower', payload: msg, at: nowIso() });
    });

    ws.on('close', () => {
      wsConnected = false;
      stopQuietTimer();
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('[tower-bridge] WS error:', err?.message || String(err));
      // error is followed by close on many stacks; if not, force a close
      try { ws.close(); } catch {}
    });
  } catch (e) {
    console.error('[tower-bridge] WS connect exception:', e.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  reconnectAttempts += 1;
  const exp = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1));
  // jitter ±20%
  const delay = Math.max(250, Math.floor(exp * (0.8 + Math.random() * 0.4)));
  console.log(`[tower-bridge] WS disconnected, reconnecting in ${delay}ms…`);
  setTimeout(connectWS, delay);
}

// --- HTTP fallback snapshot ---
function fetchHttpState(cb) {
  try {
    const req = http.get(HTTP_STATE, { timeout: HTTP_TIMEOUT_MS }, (res) => {
      const { statusCode } = res;
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (statusCode && statusCode >= 400) {
          return cb(new Error(`HTTP ${statusCode}`));
        }
        const parsed = safeJsonParse(data);
        if (!parsed) return cb(new Error('JSON.parse'));
        cb(null, parsed);
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('HTTP timeout'));
    });
    req.on('error', (e) => cb(e));
  } catch (e) {
    cb(e);
  }
}

// --- Public API ---
export function initTowerBridge() {
  connectWS();

  // Periodically refresh HTTP snapshot as a fallback
  setInterval(() => {
    fetchHttpState((err, js) => {
      if (!err && js) {
        // Some sims return { state: {...} }, others return plain {...}
        // Normalize to plain state object when possible
        const normalized = js.state && typeof js.state === 'object' ? js.state : js;
        lastState = normalized;

        // Feed delta emitter from HTTP too (keeps correlation alive even if WS is quiet)
        try {
          deltaEmitter.ingest(normalized);
        } catch (e) {
          console.error('[tower-bridge] deltaEmitter.ingest (HTTP) error:', e?.message || e);
        }

        // Emit a normalized bus event so Supervisor/Agents can consume snapshots
        emitBusEvent({
          type: 'state.update',
          siteId: 'all',
          alarm: null,
          payload: { ts: nowIso(), state: normalized },
          ts: nowIso(),
        });

        // Still broadcast to dashboard subscribers
        broadcast({ event: 'tower.http.state', payload: normalized, at: nowIso() });
      }
    });
  }, HTTP_REFRESH_MS);
}

export function getTowerSnapshot() {
  // Prefer the freshest known state (WS cache), fallback to HTTP on demand
  return new Promise((resolve) => {
    if (lastState) {
      return resolve({ ok: true, ...lastState, source: 'ws-cache' });
    }
    fetchHttpState((err, js) => {
      if (err || !js) return resolve({ ok: false, error: 'unavailable' });
      const normalized = js.state && typeof js.state === 'object' ? js.state : js;
      resolve({ ok: true, ...normalized, source: 'http' });
    });
  });
}

export function subscribeTower(res) {
  subscribers.add(res);
  res.on('close', () => {
    subscribers.delete(res);
    try { res.end(); } catch {}
    // clear per-response heartbeat timer if any
    if (res.__hb) clearInterval(res.__hb);
  });

  // SSE heartbeat: comment line keeps the connection alive through proxies
  res.__hb = setInterval(() => {
    try { res.write(':hb\n\n'); } catch {}
  }, SSE_HEARTBEAT_MS);

  // initial marker + snapshots for faster UI hydration
  res.write(`data: ${JSON.stringify({ event: 'connected', at: nowIso(), wsConnected })}\n\n`);
  if (lastEnvelope) {
    res.write(`data: ${JSON.stringify({ event: 'tower', payload: lastEnvelope, at: nowIso() })}\n\n`);
  }
  if (lastState) {
    res.write(`data: ${JSON.stringify({ event: 'tower.http.state', payload: lastState, at: nowIso() })}\n\n`);
  }
}
