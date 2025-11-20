import {
  Brain,
  ArrowDownUp,
  Activity,
  BatteryFull,
  Gauge,
} from "lucide-react";
import { motion } from "motion/react";
import React, { forwardRef, RefObject, useEffect, useState } from "react";

export interface ManagerLayerProps {
  position: { x: number; y: number };
  onDrag: (e: any, info: any) => void;
  dragConstraints?: RefObject<HTMLElement | null>;
}

// Simulator site IDs (3 nodes)
const SITE_IDS = ["NYNYNJ0836", "NYNYNJ0837", "TX0482"] as const;
type SiteId = (typeof SITE_IDS)[number];

type SiteMetrics = {
  battery: number | null;
  prevBattery: number | null;
  mains: "on" | "off" | null;
};

type MetricsMap = Record<SiteId, SiteMetrics>;

export const ManagerLayer = forwardRef<HTMLDivElement, ManagerLayerProps>(
  ({ position, onDrag, dragConstraints }, ref) => {
    // --- Battery + mains state for the 3 nodes ---
    const [metrics, setMetrics] = useState<MetricsMap>({
      NYNYNJ0836: { battery: null, prevBattery: null, mains: null },
      NYNYNJ0837: { battery: null, prevBattery: null, mains: null },
      TX0482: { battery: null, prevBattery: null, mains: null },
    });

    useEffect(() => {
      // Subscribe to tower bridge SSE
      const es = new EventSource("/api/tower/stream");

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // We support both shapes:
          // { event: 'tower.http.state', payload: { state: { sites: {...} } } }
          // or direct { state: { sites: {...} } } or { sites: {...} }
          const payload = data?.payload ?? data;
          const state = payload?.state ?? payload;
          const sites = state?.sites ?? {};

          setMetrics((prev) => {
            const next: MetricsMap = { ...prev };
            SITE_IDS.forEach((id) => {
              const site = sites?.[id];
              if (!site) return;

              const rawBatt = site.batteryPercent;
              const mains = site.mains as "on" | "off" | undefined;

              if (typeof rawBatt === "number" && !Number.isNaN(rawBatt)) {
                const current = prev[id] ?? {
                  battery: null,
                  prevBattery: null,
                  mains: null,
                };
                next[id] = {
                  battery: rawBatt,
                  prevBattery: current.battery,
                  mains: mains ?? current.mains ?? null,
                };
              } else if (mains) {
                // update mains even if battery not present in this tick
                const current = prev[id] ?? {
                  battery: null,
                  prevBattery: null,
                  mains: null,
                };
                next[id] = {
                  ...current,
                  mains,
                };
              }
            });
            return next;
          });
        } catch {
          // Ignore malformed lines; SSE stream may also send heartbeats
        }
      };

      es.onerror = () => {
        // keep the connection; errors are common with SSE during idle/refresh
      };

      return () => {
        es.close();
      };
    }, []);

    // Helpers
    const fmtBattery = (val: number | null) =>
      typeof val === "number" ? `${Math.round(val)}%` : "--%";

    const getBatteryColor = (val: number | null) => {
      if (val == null || Number.isNaN(val)) return "text-cyan-300";
      const rounded = Math.round(val);
      if (rounded <= 0) return "text-red-400"; // 0% → red
      if (rounded === 100) return "text-emerald-400"; // 100% → green
      return "text-amber-400"; // 1–99% → orange
    };

    const renderBatteryCard = (siteId: SiteId) => {
      const m = metrics[siteId];
      const iconClass = getBatteryColor(m.battery);

      return (
        <div
          key={siteId}
          className="bg-black/30 rounded-lg px-2 py-1.5 text-center border border-cyan-400/20"
        >
          <BatteryFull className={`w-4 h-4 mx-auto mb-1 ${iconClass}`} />
          <p className="text-cyan-100 text-xs opacity-80 leading-tight">
            Battery
          </p>
          <p className="text-cyan-50 text-sm font-semibold leading-tight">
            {fmtBattery(m.battery)}
          </p>
        </div>
      );
    };

    return (
      <motion.div
        drag
        dragMomentum={false}
        dragElastic={0.1}
        dragConstraints={dragConstraints}
        onDrag={onDrag}
        className="absolute cursor-move will-change-transform select-none"
        style={{ left: position.x, top: position.y }}
        whileHover={{ scale: 1.02 }}
        whileDrag={{ scale: 1.05 }}
        role="button"
        tabIndex={0}
        aria-grabbed="true"
        aria-label="Supervisor agent"
      >
        <div ref={ref} className="relative">
          {/* Glow effect */}
          <div className="pointer-events-none absolute inset-0 bg-cyan-500/20 rounded-2xl blur-xl" />

          <div className="relative bg-gradient-to-br from-blue-900/90 to-cyan-900/90 backdrop-blur-sm rounded-2xl p-6 border-2 border-cyan-400/50 shadow-2xl min-w-[350px] max-w-[380px] text-white">
            {/* Header */}
            <div className="flex flex-col items-center text-center mb-4">
              <div className="p-3 bg-cyan-500/20 rounded-xl border border-cyan-400/40 mb-3">
                <Brain className="w-8 h-8 text-cyan-300" />
              </div>
              <h3 className="text-lg font-semibold">Supervisor Agent</h3>
              <span className="text-cyan-200 text-xs mt-1 opacity-80">
                State: Running — Power Mains Failure Workflow
              </span>
            </div>

            {/* Goal & Policy */}
            <div className="bg-black/20 rounded-lg p-3 border border-cyan-400/20 mb-3">
              <p className="text-cyan-100 text-sm mb-1">
                <strong className="text-cyan-300">Goal:</strong> Restore site
                power or dispatch FLM
              </p>
              <p className="text-cyan-100 text-xs opacity-80">
                Policy: Critical First • Human-in-the-Loop • SLA {" >"}95%
              </p>
            </div>

            {/* Active Playbook */}
            <div className="bg-black/20 rounded-lg p-3 border border-cyan-400/20 mb-3">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-4 h-4 text-cyan-300" />
                <span className="text-cyan-100 text-sm font-medium">
                  Active Playbook
                </span>
              </div>
              <p className="text-cyan-100 text-xs opacity-80 ml-6">
                Power Mains Failure v2.3
              </p>
              <p className="text-cyan-100 text-xs ml-6 opacity-70">
                Steps: Detect → Validate Grid → Check On-Site → Dispatch FLM →
                Monitor → Close
              </p>
            </div>

            {/* Task Coordination */}
            <div className="space-y-2 mb-3">
              <div className="flex flex-col bg-black/30 rounded-lg border border-cyan-400/20">
                <div className="flex items-center gap-2 p-3 border-b border-cyan-400/10">
                  <ArrowDownUp className="w-4 h-4 text-cyan-300" />
                  <span className="text-cyan-100 text-sm">Task Coordination</span>
                </div>
                <div className="px-4 py-2 text-xs text-cyan-100 space-y-1">
                  <p>
                    • <strong>Agent A:</strong> Check power company outage — ✅
                    Done
                  </p>
                  <p>
                    • <strong>Agent B:</strong> Monitor outage resolution — 🔄
                    Running
                  </p>
                  <p>
                    • <strong>Agent C:</strong> Standby for dispatch — ⏸ Idle
                  </p>
                </div>
              </div>
            </div>

            {/* Metrics → Progress + 3 thinner Battery blocks (4 in a row) */}
            <div className="grid grid-cols-4 gap-2 mt-4">
              {/* Progress box (left) */}
              <div className="bg-black/30 rounded-lg px-2 py-1.5 text-center border border-cyan-400/20">
                <Gauge className="w-4 h-4 text-cyan-300 mx-auto mb-1" />
                <p className="text-cyan-100 text-xs opacity-80 leading-tight">
                  Progress
                </p>
                <p className="text-cyan-50 text-sm font-semibold leading-tight">
                  60%
                </p>
              </div>

              {/* 3 battery boxes */}
              {SITE_IDS.map(renderBatteryCard)}
            </div>
          </div>

          {/* Connection points (pointer-events-none so they never block dragging) */}
          <div
            data-connection-point="top"
            className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-cyan-400 rounded-full border-2 border-cyan-200 shadow-lg shadow-cyan-400/50 z-10"
          />
          <div
            data-connection-point="bottom-left"
            className="pointer-events-none absolute -bottom-2 left-4 w-4 h-4 bg-cyan-400 rounded-full border-2 border-cyan-200 shadow-lg shadow-cyan-400/50 z-10"
          />
          <div
            data-connection-point="bottom-center"
            className="pointer-events-none absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-cyan-400 rounded-full border-2 border-cyan-200 shadow-lg shadow-cyan-400/50 z-10"
          />
          <div
            data-connection-point="bottom-right"
            className="pointer-events-none absolute -bottom-2 right-4 w-4 h-4 bg-cyan-400 rounded-full border-2 border-cyan-200 shadow-lg shadow-cyan-400/50 z-10"
          />
        </div>
      </motion.div>
    );
  }
);

ManagerLayer.displayName = "ManagerLayer";
