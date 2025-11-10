import { useEffect, useState } from "react";
import { fetchCorrelationSummary, type CorrelationSummary } from "../services/correlationAgent";

export function useCorrelationAgent(refreshMs = 1500) {
  const [agent, setAgent] = useState<CorrelationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const s = await fetchCorrelationSummary();
        if (!stop) {
          setAgent(s);
          setLoading(false);
          setError(null);
        }
      } catch (e: any) {
        if (!stop) {
          setError(e?.message || "Failed to load agent");
          setLoading(false);
        }
      } finally {
        if (!stop) timer = window.setTimeout(tick, refreshMs);
      }
    };

    tick();
    return () => {
      stop = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [refreshMs]);

  return { agent, loading, error };
}