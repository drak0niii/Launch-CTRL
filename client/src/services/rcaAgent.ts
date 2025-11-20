import { API_BASE } from "../lib/config";

export type RcaSummary = {
  name: string;
  status: "Active" | "Stopped" | "Idle";
  runtimeSec: number;
  tasks: number;
  lastTask: string | null;
};

export async function fetchRcaSummary(): Promise<RcaSummary> {
  try {
    const r = await fetch(`${API_BASE}/api/agents/rca`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const s = data?.agent ?? data ?? {};
    return {
      name: String(s?.name ?? "Agent C"),
      status: (s?.status ?? "Stopped") as RcaSummary["status"],
      runtimeSec: Number(s?.runtimeSec ?? 0),
      tasks: Number(s?.tasks ?? 0),
      lastTask: s?.lastTask ?? null,
    };
  } catch {
    return { name: "Agent C", status: "Stopped", runtimeSec: 0, tasks: 0, lastTask: null };
  }
}
