// Minimal, safe service with a fallback if the API isn’t up yet.
import { API_BASE } from "../lib/config";

export type CorrelationSummary = {
  name: string;
  status: "Active" | "Stopped" | "Idle";
  delegation: "Enabled" | "Disabled";
  runtimeSec: number;
  tasks: number;
  lastTask: string | null;
};

export async function fetchCorrelationSummary(): Promise<CorrelationSummary> {
  try {
    const r = await fetch(`${API_BASE}/api/agents/correlation`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    // Expecting { agent: CorrelationSummary }
    if (data?.agent) return data.agent as CorrelationSummary;

    // If server returns a flat shape, coerce it
    return {
      name: data?.name ?? "Agent A",
      status: data?.status ?? "Stopped",
      delegation: data?.delegation ?? "Disabled",
      runtimeSec: Number(data?.runtimeSec ?? 0),
      tasks: Number(data?.tasks ?? 0),
      lastTask: data?.lastTask ?? null,
    };
  } catch (_e) {
    // Fallback mock so the UI doesn’t crash during dev
    return {
      name: "Agent A",
      status: "Stopped",
      delegation: "Disabled",
      runtimeSec: 0,
      tasks: 47,
      lastTask: null,
    };
  }
}