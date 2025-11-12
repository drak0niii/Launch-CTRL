// server/system/state.js

// === Core live state ===
let enabled = true;
let version = 0;                           // ⬅️ Bumps ONLY on ON transitions
let updatedAt = new Date().toISOString();

let lastOnAt = null;                       // when we most recently went Online
let lastOffAt = null;                      // when we most recently went Offline

// === Telemetry ===
const counts = { on: 0, off: 0 };          // how many times system turned on/off
const history = [];                        // [{ version, enabled, source, updatedAt }]
let uptimeSeconds = 0;                     // accumulates across ON windows

// === SSE clients ===
const subscribers = new Set();

// --- helpers ---
function baseSnapshot() {
  return {
    enabled,
    version,
    updatedAt,
    lastOnAt,
    lastOffAt,
    counts: { ...counts },
    history: history.slice(-200),          // avoid unbounded growth in payload
  };
}

function liveUptime() {
  if (!enabled || !lastOnAt) return 0;
  const start = new Date(lastOnAt).getTime();
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

function snapshot() {
  // Report accumulated uptime + live delta if online now
  return {
    ...baseSnapshot(),
    uptimeSeconds: uptimeSeconds + liveUptime(),
  };
}

// === Accessors ===
export function getSystemState() {
  return snapshot();
}

export function getSystemCounts() {
  return { ...counts };
}

export function getSystemHistory() {
  return history.slice();
}

/**
 * Updates system state and notifies subscribers.
 * Rules:
 *  - Version increments ONLY when transitioning to enabled=true (power ON)
 *  - Turning OFF does NOT increment version
 *  - Uptime accumulates when going from ON -> OFF
 *
 * @param {boolean} next - desired enabled state
 * @param {string} source - who triggered the change ("console:llm", "rest:post", etc.)
 */
export function setSystemEnabled(next, source = 'unknown') {
  const nextEnabled = Boolean(next);
  if (nextEnabled === enabled) {
    // No state change — still return a fresh snapshot for the caller
    return snapshot();
  }

  const nowIso = new Date().toISOString();

  if (nextEnabled) {
    // === ON transition ===
    enabled = true;
    version = (version || 0) + 1;         // ⬅️ bump only here
    updatedAt = nowIso;
    lastOnAt = nowIso;
    counts.on += 1;

    history.push({ version, enabled: true, source, updatedAt: nowIso });
  } else {
    // === OFF transition ===
    // Accumulate uptime from the last ON window
    if (lastOnAt) {
      const started = new Date(lastOnAt).getTime();
      const delta = Math.max(0, Math.floor((Date.now() - started) / 1000));
      uptimeSeconds += delta;
    }

    enabled = false;
    updatedAt = nowIso;
    lastOffAt = nowIso;
    counts.off += 1;

    // Keep the SAME version for OFF entries
    history.push({ version, enabled: false, source, updatedAt: nowIso });
  }

  // Trim history if needed
  if (history.length > 200) history.splice(0, history.length - 200);

  broadcast();
  return snapshot();
}

// === SSE subscription ===
export function subscribe(res) {
  subscribers.add(res);
  res.on('close', () => {
    subscribers.delete(res);
    try { res.end(); } catch {}
  });
}

// === Broadcast helper ===
function broadcast() {
  const payload = JSON.stringify(snapshot());
  for (const r of subscribers) {
    try {
      r.write(`event: system\ndata: ${payload}\n\n`);
    } catch {}
  }
}
