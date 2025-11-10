// client/src/services/system.ts
// Centralized API base + System helpers (REST + SSE)

const API_BASE =
  (import.meta as any)?.env?.VITE_API_BASE_URL || 'http://localhost:8787';

console.info('[system.ts] Using API base →', API_BASE);

// -----------------------------------------------------------------------------
// Fetch current system state
// -----------------------------------------------------------------------------
export async function getSystem(): Promise<{ ok: boolean; enabled: boolean }> {
  const r = await fetch(`${API_BASE}/api/system`, { credentials: 'omit' });
  if (!r.ok) throw new Error(`GET /api/system ${r.status}`);
  return r.json();
}

// -----------------------------------------------------------------------------
// Update system state (enable/disable)
// -----------------------------------------------------------------------------
export async function setSystem(
  enabled: boolean
): Promise<{ ok: boolean; enabled: boolean }> {
  const r = await fetch(`${API_BASE}/api/system`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
    credentials: 'omit',
  });
  if (!r.ok) throw new Error(`POST /api/system ${r.status}`);
  return r.json();
}

// -----------------------------------------------------------------------------
// Subscribe to live system state via Server-Sent Events
// IMPORTANT: call onUpdate with a boolean, not the whole object
// -----------------------------------------------------------------------------
export function subscribeSystem(onUpdate: (enabled: boolean) => void): () => void {
  const url = `${API_BASE.replace(/\/$/, '')}/api/system/stream`;

  console.info('[system.ts] Opening SSE →', url);

  const es = new EventSource(url, { withCredentials: false });

  es.onmessage = (evt) => {
    try {
      // Server sends lines like: data: {"enabled":true}
      const data = JSON.parse(evt.data) as { enabled?: unknown };
      if (typeof data?.enabled === 'boolean') {
        onUpdate(data.enabled);
      }
    } catch (e) {
      // ignore malformed lines (e.g., comment pings)
    }
  };

  es.onerror = (err) => {
    console.warn('[system.ts] SSE error →', err);
    // Let the browser auto-reconnect; do not close here.
  };

  // Return unsubscribe fn
  return () => es.close();
}