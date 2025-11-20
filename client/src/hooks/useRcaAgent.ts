import { useEffect, useState } from "react";
import { fetchRcaSummary, type RcaSummary } from "../services/rcaAgent";

export function useRcaAgent(refreshMs = 1500) {
  const [agent, setAgent] = useState<RcaSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false, t: number | undefined;
    const tick = async () => {
      try {
        const s = await fetchRcaSummary();
        if (!stop) { setAgent(s); setError(null); setLoading(false); }
      } catch (e: any) {
        if (!stop) { setError(String(e?.message || e)); setLoading(false); }
      } finally {
        if (!stop) t = window.setTimeout(tick, refreshMs);
      }
    };
    tick();
    return () => { stop = true; if (t) clearTimeout(t); };
  }, [refreshMs]);

  return { agent, loading, error };
}
