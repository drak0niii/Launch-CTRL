// server/system/state.js

// === Core live state ===
let enabled = true;
let version = 0;
let updatedAt = new Date().toISOString();

// Track last transition moments so the LLM can compute uptime/downtime
let lastOnAt = updatedAt;   // when we most recently went Online
let lastOffAt = null;       // when we most recently went Offline

// === Telemetry ===
const counts = { on: 0, off: 0 };          // how many times system turned on/off
const history = [];                        // [{ version, enabled, source, updatedAt }]

// === SSE clients ===
const subscribers = new Set();

// --- helpers ---
function computeUptimeSeconds(now = Date.now()) {
  // If currently enabled, uptime is time since lastOnAt; else 0 (we're down)
  if (!enabled || !lastOnAt) return 0;
  const start = new Date(lastOnAt).getTime();
  return Math.max(0, Math.floor((now - start) / 1000));
}

function snapshot() {
  return {
    enabled,
    version,
    updatedAt,
    lastOnAt,
    lastOffAt,
    uptimeSeconds: computeUptimeSeconds(),
    counts: { ...counts },
    history: history.slice(-200), // avoid unbounded growth in the payload
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
 * @param {boolean} next - desired enabled state
 * @param {string} source - who triggered the change ("console:llm", "rest:post", etc.)
 */
export function setSystemEnabled(next, source = 'unknown') {
  const nextEnabled = Boolean(next);
  const changed = nextEnabled !== enabled;

  if (!changed) {
    // No state change — still return a fresh snapshot for the caller
    return snapshot();
  }

  enabled = nextEnabled;
  version += 1;
  updatedAt = new Date().toISOString();

  if (enabled) {
    counts.on += 1;
    lastOnAt = updatedAt;
  } else {
    counts.off += 1;
    lastOffAt = updatedAt;
  }

  history.push({ version, enabled, source, updatedAt });

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