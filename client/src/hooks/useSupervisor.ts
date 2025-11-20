// client/src/hooks/useSupervisor.ts
import { useEffect, useRef, useState } from "react";

// If you already have a central config (e.g. ../lib/config with API_BASE),
// you can swap this for that import. For now we default to localhost:8787.
const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ?? "http://localhost:8787";

export interface SupervisorPolicy {
  alarmPrioritization: string;
  waysOfWorking: string;
  kpiAlignment: string;
  version: number;
  updatedAt?: string;
}

export interface SupervisorSummary {
  status: "idle" | "running" | "paused" | "stopped";
  startedAt: string | null;
  runtimeSec: number;
  tasksRouted: number;
  lastNote: string | null;
  autoEnabled: boolean; // effective (policy OR toggle)
  storedAutoEnabled: boolean; // manual toggle
  approvalsPending: number;
  policy?: SupervisorPolicy | null;
  // optional battery field if you add it later on backend
  batteryPct?: number;
}

interface UseSupervisorResult {
  supervisor: SupervisorSummary | null;
  loading: boolean;
  error: string | null;
}

export function useSupervisor(): UseSupervisorResult {
  const [supervisor, setSupervisor] = useState<SupervisorSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `${API_BASE}/api/supervisor/stream`;
    const es = new EventSource(url);
    esRef.current = es;

    const handleMessage = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        setSupervisor(data);
        setLoading(false);
      } catch (e) {
        console.error("Supervisor SSE parse error", e);
      }
    };

    // default event
    es.onmessage = handleMessage;
    // named event (we emit "supervisor" from the backend)
    es.addEventListener("supervisor", handleMessage as any);

    es.onerror = (err) => {
      console.error("Supervisor SSE error", err);
      setError("Supervisor stream disconnected");
      setLoading(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  return { supervisor, loading, error };
}
