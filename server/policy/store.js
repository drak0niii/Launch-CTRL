// server/policy/store.js
// In-memory Policy Store + SSE broadcasting (case-insensitive inputs supported)

const DEFAULT_POLICY = Object.freeze({
  alarmPrioritization: 'Critical First',
  waysOfWorking: 'Human intervention at critical steps',
  kpiAlignment: '>95%',
  updatedAt: new Date().toISOString(),
  version: 1,
});

let policy = { ...DEFAULT_POLICY };
const subscribers = new Set(); // SSE clients

// In-process listeners for internal modules (e.g., supervisor)
const listeners = new Set();
function onChange(fn) {
  if (typeof fn === 'function') listeners.add(fn);
  return () => listeners.delete(fn);
}

const ALARM_OPTIONS = ['Critical First', 'Adaptive Correlation'];
const WOW_OPTIONS = ['E2E automation', 'Human intervention at critical steps'];
const KPI_OPTIONS = ['>95%', '75%'];

// Build case-insensitive lookup maps → canonical strings
const toCanonMap = (arr) =>
  arr.reduce((m, v) => (m.set(String(v).toLowerCase(), v), m), new Map());
const ALARM_CANON = toCanonMap(ALARM_OPTIONS);
const WOW_CANON = toCanonMap(WOW_OPTIONS);
const KPI_CANON = toCanonMap(KPI_OPTIONS);

function toCanonical(value, map, label) {
  if (value === undefined) return undefined;
  const k = String(value).toLowerCase();
  const canon = map.get(k);
  if (!canon) {
    throw new Error(`${label} must be one of: ${[...map.values()].join(', ')}`);
  }
  return canon;
}

function validatePatch(patch = {}) {
  const out = {};
  if (patch.alarmPrioritization !== undefined) {
    out.alarmPrioritization = toCanonical(patch.alarmPrioritization, ALARM_CANON, 'alarmPrioritization');
  }
  if (patch.waysOfWorking !== undefined) {
    out.waysOfWorking = toCanonical(patch.waysOfWorking, WOW_CANON, 'waysOfWorking');
  }
  if (patch.kpiAlignment !== undefined) {
    out.kpiAlignment = toCanonical(patch.kpiAlignment, KPI_CANON, 'kpiAlignment');
  }
  return out;
}

function getPolicy() {
  return { ...policy };
}

function setPolicy(patch = {}, source = 'api') {
  const valid = validatePatch(patch);
  policy = {
    ...policy,
    ...valid,
    version: (policy.version ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    source,
  };

  broadcast();

  // Notify in-process listeners
  for (const fn of listeners) {
    try { fn(getPolicy()); } catch {}
  }
  return getPolicy();
}

function addSubscriber(res) {
  subscribers.add(res);
  res.on('close', () => {
    subscribers.delete(res);
    try { res.end(); } catch {}
  });
}

function subscribeStream(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  addSubscriber(res); // will clean up on 'close'
  res.write(`event: policy\ndata: ${JSON.stringify(policy)}\n\n`);
}

function broadcast() {
  const msg = `event: policy\ndata: ${JSON.stringify(policy)}\n\n`;
  for (const res of subscribers) {
    try { res.write(msg); } catch {}
  }
}

export {
  DEFAULT_POLICY,
  ALARM_OPTIONS, WOW_OPTIONS, KPI_OPTIONS,
  getPolicy, setPolicy,
  addSubscriber, subscribeStream,
  onChange,
};
