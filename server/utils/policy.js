// server/utils/policy.js
// Centralized, case-insensitive policy helpers + alarm filters

// --- Alarm helpers (exported so agents can import directly) ---
const CRITICAL_PATTERNS = [
  /ServiceUnavailable/i,
  /HeartbeatFailure/i,
  /MainsFailure/i,
];

const NOISE_ALARMS = new Set(['unknown', 'heartbeat', 'noop']);

/** Returns true if alarm string matches our critical patterns. */
export function isCriticalAlarm(alarm) {
  if (!alarm) return false;
  const s = String(alarm);
  return CRITICAL_PATTERNS.some(rx => rx.test(s));
}

/** Returns true if alarm is considered noise (unknown/heartbeat/noop). */
export function isNoiseAlarm(alarm) {
  const a = String(alarm || '').toLowerCase();
  return NOISE_ALARMS.has(a);
}

// --- Policy normalization ---
/** Normalize alarm prioritization string (lowercased, trimmed). */
export function normalizePolicyValue(val) {
  return String(val || '').trim().toLowerCase();
}

/** True if policy.alarmPrioritization is "Critical First". */
export function isPolicyModeCriticalFirst(policy) {
  return normalizePolicyValue(policy?.alarmPrioritization) === 'critical first';
}

/** True if policy.alarmPrioritization is "Adaptive Correlation". */
export function isPolicyModeAdaptive(policy) {
  return normalizePolicyValue(policy?.alarmPrioritization) === 'adaptive correlation';
}

/**
 * Whether we should auto-mitigate (E2E) based on policy + manual toggle.
 * policy.waysOfWorking === 'E2E automation' OR toggle.enabled
 */
export function shouldAutoMitigate(policy, toggle = { enabled: false }) {
  const wow = normalizePolicyValue(policy?.waysOfWorking);
  return wow === 'e2e automation' || !!toggle?.enabled;
}

// Re-export sets/patterns if you need them elsewhere (optional)
export const __internals = { CRITICAL_PATTERNS, NOISE_ALARMS };
