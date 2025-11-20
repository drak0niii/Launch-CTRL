// Fetch + types for Agent A (Correlation)
import { API_BASE } from "../lib/config";

export type CorrelationSummary = {
  name: string;
  status: "Active" | "Stopped" | "Idle";
  runtimeSec: number;
  tasks: number;
  lastTask: string | null;
  delegation?: "Enabled" | "Disabled";
};

export async function fetchCorrelationSummary(): Promise<CorrelationSummary> {
  try {
    const r = await fetch(`${API_BASE}/api/agents/correlation`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const s = data?.agent ?? data ?? {};
    return {
      name: String(s?.name ?? "Agent A"),
      status: (s?.status ?? "Stopped") as CorrelationSummary["status"],
      runtimeSec: Number(s?.runtimeSec ?? 0),
      tasks: Number(s?.tasks ?? 0),
      lastTask: s?.lastTask ?? null,
      delegation: s?.delegation === "Enabled" ? "Enabled" : "Disabled",
    };
  } catch {
    return { name: "Agent A", status: "Stopped", runtimeSec: 0, tasks: 0, lastTask: null, delegation: "Disabled" };
  }
}
