// server/system/state.js

// === Core live state ===
let enabled = true;
let version = 0;                           // bumps ONLY on power-on
let updatedAt = new Date().toISOString();

let lastOnAt = null;
let lastOffAt = null;

// === Telemetry ===
const counts = { on: 0, off: 0 };
const history = [];                        // [{ version, enabled, source, updatedAt }]
let uptimeSeconds = 0;

// ======================================================
// === NEW SSE SUBSCRIBER MODEL (function-based) ========
// ======================================================

// Subscribers receive structured events:
// push({ type: "...", ts: "...", ...payload })
const systemSubscribers = new Set();

export function subscribeSystemStream(fn) {
  if (typeof fn === "function") {
    systemSubscribers.add(fn);
  }
}

export function unsubscribeSystemStream(fn) {
  systemSubscribers.delete(fn);
}

function broadcastSystem(evt) {
  for (const fn of systemSubscribers) {
    try {
      fn(evt);
    } catch {}
  }
}

// ======================================================
// === BACKWARD-COMPAT Legacy API (KEEP IT) =============
// ======================================================

// Old-style direct SSE clients stored raw res objects.
const legacySubscribers = new Set();

export function subscribe(res) {
  // Keep old behaviour intact
  legacySubscribers.add(res);
  res.on('close', () => {
    legacySubscribers.delete(res);
    try { res.end(); } catch {}
  });
}

function broadcastLegacy(payload) {
  const data = JSON.stringify(payload);
  for (const r of legacySubscribers) {
    try {
      r.write(`event: system\n`);
      r.write(`data: ${data}\n\n`);
    } catch {}
  }
}

// ======================================================
// === Snapshot Helpers =================================
// ======================================================

function baseSnapshot() {
  return {
    enabled,
    version,
    updatedAt,
    lastOnAt,
    lastOffAt,
    counts: { ...counts },
    history: history.slice(-200),
  };
}

function liveUptime() {
  if (!enabled || !lastOnAt) return 0;
  const start = new Date(lastOnAt).getTime();
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

export function getSystemStateSnapshot() {
  return {
    ...baseSnapshot(),
    uptimeSeconds: uptimeSeconds + liveUptime(),
  };
}

// Backward compatibility name
export function getSystemState() {
  return getSystemStateSnapshot();
}

export function getSystemCounts() {
  return { ...counts };
}

export function getSystemHistory() {
  return history.slice();
}

// ======================================================
// === State Mutation Handler ===========================
// ======================================================

/**
 * Sets system enabled/disabled.
 * Emits SSE events in BOTH:
 *   • NEW model  (function subscribers)
 *   • LEGACY model (raw res.write subscribers)
 */
export function setSystemEnabled(next, source = 'unknown') {
  const nextEnabled = Boolean(next);
  if (nextEnabled === enabled) {
    const snap = getSystemStateSnapshot();

    // still broadcast a NO-OP update in new model
    broadcastSystem({
      type: "noop",
      ts: new Date().toISOString(),
      state: snap
    });

    return snap;
  }

  const nowIso = new Date().toISOString();

  if (nextEnabled) {
    // === POWER ON ===
    enabled = true;
    version = (version || 0) + 1;
    updatedAt = nowIso;
    lastOnAt = nowIso;
    counts.on += 1;

    history.push({ version, enabled: true, source, updatedAt: nowIso });

  } else {
    // === POWER OFF ===
    if (lastOnAt) {
      const started = new Date(lastOnAt).getTime();
      const delta = Math.max(0, Math.floor((Date.now() - started) / 1000));
      uptimeSeconds += delta;
    }

    enabled = false;
    updatedAt = nowIso;
    lastOffAt = nowIso;
    counts.off += 1;

    history.push({ version, enabled: false, source, updatedAt: nowIso });
  }

  // trim history
  if (history.length > 200) history.splice(0, history.length - 200);

  const snap = getSystemStateSnapshot();

  // NEW model broadcast
  broadcastSystem({
    type: nextEnabled ? "system.on" : "system.off",
    ts: nowIso,
    state: snap,
    source,
  });

  // LEGACY model broadcast
  broadcastLegacy(snap);

  return snap;
}
