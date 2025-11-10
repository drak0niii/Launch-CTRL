import { useCorrelationAgent } from '../hooks/useCorrelationAgent';
import { Bot, CheckCircle, XCircle, Clock, ListChecks } from "lucide-react";
import { motion } from "motion/react";
import { forwardRef, RefObject } from "react";

interface AgentNodeProps {
  id: string;
  label: string;
  isDelegating: boolean; // for B/C; Agent A will override to Disabled
  position: { x: number; y: number };
  onDrag: (e: any, info: any) => void;
dragConstraints?: RefObject<Element | null>;
}

export const AgentNode = forwardRef<HTMLDivElement, AgentNodeProps>(
  ({ id, label, isDelegating, position, onDrag, dragConstraints }, ref) => {
    // We always call the hook (can’t be conditional), but we’ll only use it for Agent A.
    const { agent, loading } = useCorrelationAgent(1500);
    const isAgentA = id === 'agent-a';

    // --- Effective state mapping ---
    // Delegation: for Agent A it's ALWAYS Disabled; for others use prop.
    const delegationEnabled = isAgentA ? false : isDelegating;

    // Status label:
    //  - Agent A: use backend (Active | Stopped | Idle). Default to Stopped when unknown.
    //  - Others: keep prior mapping (Active when delegating, Constrained otherwise).
    const statusLabel = isAgentA
      ? (agent?.status ?? (loading ? 'Loading…' : 'Stopped'))
      : (isDelegating ? 'Active' : 'Constrained');

    // Is the node visually "active" (drives colors)?
    const isActive = isAgentA
      ? agent?.status === 'Active'
      : isDelegating;

    // Runtime & Tasks:
    const runtimeLabel = isAgentA
      ? `${((agent?.runtimeSec ?? 0)).toFixed(1)}s`
      : (isDelegating ? "2.3s" : "5.7s");

    const tasksLabel = isAgentA
      ? String(agent?.tasks ?? 0)
      : (isDelegating ? 47 : 12);

    // Colors (driven by active vs not)
    const statusColor = isActive ? "from-green-500 to-emerald-500" : "from-gray-500 to-slate-500";
    const borderColor = isActive ? "border-green-400/50" : "border-gray-400/50";
    const glowColor = isActive ? "bg-green-500/20" : "bg-gray-500/20";

    return (
      <motion.div
        id={id}
        drag
        dragMomentum={false}
        dragElastic={0.1}
        dragConstraints={dragConstraints}
        onDrag={onDrag}
        className="absolute cursor-move will-change-transform"
        style={{ left: position.x, top: position.y }}
        whileHover={{ scale: 1.02 }}
        whileDrag={{ scale: 1.05 }}
        role="button"
        tabIndex={0}
        aria-grabbed="true"
        aria-label={`${label} node`}
      >
        <div ref={ref} className="relative">
          {/* Glow effect (kept separate so it doesn't affect layout) */}
          <div className={`pointer-events-none absolute inset-0 ${glowColor} rounded-2xl blur-xl`} />

          <div
            className={`relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm rounded-2xl p-5 border-2 ${borderColor} shadow-2xl min-w-[240px]`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 bg-gradient-to-br ${statusColor} rounded-full border ${borderColor}`}>
                <Bot className="w-6 h-6 text-white" />
              </div>
              {delegationEnabled ? (
                <CheckCircle className="w-5 h-5 text-green-400" aria-label="Delegation enabled" />
              ) : (
                <XCircle className="w-5 h-5 text-gray-400" aria-label="Delegation disabled" />
              )}
            </div>

            <h4 className="text-white mb-3">{label}</h4>

            <div className="space-y-2">
              {/* Task Status */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Task Status</span>
                <span className={
                  isAgentA
                    ? (isActive ? "text-green-300" : "text-gray-300")
                    : (isDelegating ? "text-green-300" : "text-gray-300")
                }>
                  {statusLabel}
                </span>
              </div>

              {/* Delegation */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Delegation</span>
                <span className={delegationEnabled ? "text-green-300" : "text-gray-300"}>
                  {delegationEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>

              {/* Metrics */}
              <div className="space-y-2 mt-3">
                <div className="flex items-center gap-2 bg-black/30 rounded-lg p-2 border border-gray-600/20">
                  <Clock className="w-4 h-4 text-cyan-300" />
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-gray-400 text-xs">Runtime</span>
                    <span className="text-white text-xs">{runtimeLabel}</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 bg-black/30 rounded-lg p-2 border border-gray-600/20">
                  <ListChecks className="w-4 h-4 text-purple-300" />
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-gray-400 text-xs">Tasks</span>
                    <span className="text-white text-xs">{tasksLabel}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Connection point (top) — pointer-events-none so it never blocks dragging */}
          <div
            data-connection-point="top"
            className={`pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 ${
              isActive ? "bg-green-400" : "bg-gray-400"
            } rounded-full border-2 ${isActive ? "border-green-200" : "border-gray-200"} shadow-lg z-10`}
          />
        </div>
      </motion.div>
    );
  }
);

AgentNode.displayName = "AgentNode";