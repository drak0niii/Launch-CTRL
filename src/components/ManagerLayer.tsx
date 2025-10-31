import { Brain, ArrowDownUp, Activity, Gauge, AlertTriangle, CheckCircle2 } from "lucide-react";
import { motion } from "motion/react";
import { forwardRef, RefObject } from "react";

export interface ManagerLayerProps {
  position: { x: number; y: number };
  onDrag: (e: any, info: any) => void;
  dragConstraints?: RefObject<Element>;
}

export const ManagerLayer = forwardRef<HTMLDivElement, ManagerLayerProps>(
  ({ position, onDrag, dragConstraints }, ref) => {
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
                <strong className="text-cyan-300">Goal:</strong> Restore site power or dispatch FLM
              </p>
              <p className="text-cyan-100 text-xs opacity-80">
                Policy: Critical First • Human-in-the-Loop • SLA {'>'}95%
              </p>
            </div>

            {/* Active Playbook */}
            <div className="bg-black/20 rounded-lg p-3 border border-cyan-400/20 mb-3">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-4 h-4 text-cyan-300" />
                <span className="text-cyan-100 text-sm font-medium">Active Playbook</span>
              </div>
              <p className="text-cyan-100 text-xs opacity-80 ml-6">Power Mains Failure v2.3</p>
              <p className="text-cyan-100 text-xs ml-6 opacity-70">
                Steps: Detect → Validate Grid → Check On-Site → Dispatch FLM → Monitor → Close
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
                  <p>• <strong>Agent A:</strong> Check power company outage — ✅ Done</p>
                  <p>• <strong>Agent B:</strong> Monitor outage resolution — 🔄 Running</p>
                  <p>• <strong>Agent C:</strong> Standby for dispatch — ⏸ Idle</p>
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div className="bg-black/30 rounded-lg p-2 text-center border border-cyan-400/20">
                <Gauge className="w-4 h-4 text-cyan-300 mx-auto mb-1" />
                <p className="text-cyan-100 text-xs">Progress</p>
                <p className="text-cyan-50 text-sm font-semibold">60%</p>
              </div>
              <div className="bg-black/30 rounded-lg p-2 text-center border border-cyan-400/20">
                <AlertTriangle className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                <p className="text-cyan-100 text-xs">Battery</p>
                <p className="text-cyan-50 text-sm font-semibold">42%</p>
              </div>
              <div className="bg-black/30 rounded-lg p-2 text-center border border-cyan-400/20">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                <p className="text-cyan-100 text-xs">SLA</p>
                <p className="text-cyan-50 text-sm font-semibold">On Track</p>
              </div>
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
