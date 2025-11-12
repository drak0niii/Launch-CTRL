// server/bus/incidentBus.js
import { EventEmitter } from 'node:events';

// --- CONFIG ---
const MAX_EVENTS = 100;

// --- CORE BUS (named export!) ---
export const incidentBus = new EventEmitter();
incidentBus.setMaxListeners(1000);

// --- INTERNAL STATE FOR SSE / INSPECTION ---
const subscribers = new Set();   // SSE clients
const buffer = [];               // recent events

// When *any* producer emits a normalized bus event, store & fan out via SSE.
// Convention: producers should emit on the generic channel 'event' with a
// normalized payload: { type, siteId, alarm?, payload?, timestamp }
incidentBus.on('event', (evt) => {
  try {
    if (evt && typeof evt === 'object') {
      buffer.push(evt);
      if (buffer.length > MAX_EVENTS) buffer.shift();

      const line = `data: ${JSON.stringify(evt)}\n\n`;
      for (const res of subscribers) {
        try { res.write(line); } catch { /* ignore broken pipe */ }
      }
    }
  } catch { /* avoid breaking producers */ }
});

// --- HELPERS (OPTIONAL) ---
export function onIncident(listener) {
  // compatibility alias; many modules use this name
  incidentBus.on('event', listener);
  return () => incidentBus.off('event', listener);
}

export function publish(evt) {
  // convenience helper if producers prefer a function call
  incidentBus.emit('event', evt);
}

// --- SSE SUBSCRIPTION (used by server/bus/incidentBus.routes.js) ---
export function subscribe(res) {
  subscribers.add(res);
  res.on('close', () => {
    subscribers.delete(res);
    try { res.end(); } catch {}
  });

  // Send a small banner and the last few items to hydrate UIs
  res.write(`data: [connected ${new Date().toISOString()}]\n\n`);
  const recent = buffer.slice(-5);
  for (const e of recent) {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  }
}

// --- INSPECTION UTILS (used by /api/bus/status, etc.) ---
export function getRecentEvents() {
  return buffer.slice();
}

export function getStatus() {
  return {
    bufferSize: buffer.length,
    lastEvent: buffer.at(-1) || null,
    // WS connectivity is now handled in server/tower/bridge.js, so we don’t
    // report it here anymore. Keep the shape minimal & honest.
    wsManagedBy: 'tower/bridge.js',
  };
}
