import { useState, useRef, useLayoutEffect, useEffect, useCallback } from "react";
import { PolicyLayer } from "./components/PolicyLayer";
import { ManagerLayer } from "./components/ManagerLayer";
import { AgentNode } from "./components/AgentNode";
import { InfoSidebar } from "./components/InfoSidebar";
import { ConnectionLines } from "./components/ConnectionLines";
import { motion } from "motion/react";
import { Power } from "lucide-react";

interface Position {
  x: number;
  y: number;
}

interface ConnectionPoints {
  policyBottom: Position;
  managerTop: Position;
  managerBottomLeft: Position;
  managerBottomCenter: Position;
  managerBottomRight: Position;
  agentATop: Position;
  agentBTop: Position;
  agentCTop: Position;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const policyRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<HTMLDivElement>(null);
  const agentARef = useRef<HTMLDivElement>(null);
  const agentBRef = useRef<HTMLDivElement>(null);
  const agentCRef = useRef<HTMLDivElement>(null);

  // track if user moved nodes (so we don’t auto-recenter them on resize)
  const userAdjusted = useRef<{ manager: boolean; a: boolean; b: boolean; c: boolean }>({
    manager: false,
    a: false,
    b: false,
    c: false,
  });

  const [showConnections, setShowConnections] = useState(false);
  const [nodesLoaded, setNodesLoaded] = useState(false);
  const [systemEnabled, setSystemEnabled] = useState(true);

  // Positions for draggable elements
  const [managerPos, setManagerPos] = useState<Position>({ x: 0, y: 0 });
  const [agentAPos, setAgentAPos] = useState<Position>({ x: 0, y: 0 });
  const [agentBPos, setAgentBPos] = useState<Position>({ x: 0, y: 0 });
  const [agentCPos, setAgentCPos] = useState<Position>({ x: 0, y: 0 });

  // Track container size to maintain centering on resize
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Connection points state
  const [connectionPoints, setConnectionPoints] = useState<ConnectionPoints>({
    policyBottom: { x: 0, y: 0 },
    managerTop: { x: 0, y: 0 },
    managerBottomLeft: { x: 0, y: 0 },
    managerBottomCenter: { x: 0, y: 0 },
    managerBottomRight: { x: 0, y: 0 },
    agentATop: { x: 0, y: 0 },
    agentBTop: { x: 0, y: 0 },
    agentCTop: { x: 0, y: 0 },
  });

  // Helper to get a connection point position relative to container
  const getConnectionPointPosition = useCallback((element: HTMLElement | null, pointName: string): Position => {
    if (!element || !containerRef.current) return { x: 0, y: 0 };
    const containerRect = containerRef.current.getBoundingClientRect();
    const connectionDot = element.querySelector(`[data-connection-point="${pointName}"]`) as HTMLElement | null;
    if (connectionDot) {
      const dotRect = connectionDot.getBoundingClientRect();
      return {
        x: dotRect.left + dotRect.width / 2 - containerRect.left,
        y: dotRect.top + dotRect.height / 2 - containerRect.top,
      };
    }
    return { x: 0, y: 0 };
  }, []);

  // RAF-throttled calculation so we don’t spam layout reads
  const rafRef = useRef<number | null>(null);
  const calculateConnectionPoints = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const points: ConnectionPoints = {
        policyBottom: getConnectionPointPosition(policyRef.current, "bottom"),
        managerTop: getConnectionPointPosition(managerRef.current, "top"),
        managerBottomLeft: getConnectionPointPosition(managerRef.current, "bottom-left"),
        managerBottomCenter: getConnectionPointPosition(managerRef.current, "bottom-center"),
        managerBottomRight: getConnectionPointPosition(managerRef.current, "bottom-right"),
        agentATop: getConnectionPointPosition(agentARef.current, "top"),
        agentBTop: getConnectionPointPosition(agentBRef.current, "top"),
        agentCTop: getConnectionPointPosition(agentCRef.current, "top"),
      };
      setConnectionPoints(points);
      rafRef.current = null;
    });
  }, [getConnectionPointPosition]);

  // Clean up any pending RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Initialize positions based on container size; keep tiers centered
  const initializePositions = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.offsetWidth;
    const height = container.offsetHeight;

    setContainerSize({ w: width, h: height });

    // Approx widths to center by offsets
    const managerWidth = 350;
    const agentWidth = 240;

    const centerX = width / 2;

    setManagerPos({
      x: centerX - managerWidth / 2,
      y: Math.max(280, height * 0.35),
    });

    const spacing = Math.min(300, width * 0.2);
    const agentY = Math.max(550, height * 0.65);

    setAgentAPos({ x: centerX - spacing - agentWidth / 2, y: agentY });
    setAgentBPos({ x: centerX - agentWidth / 2, y: agentY });
    setAgentCPos({ x: centerX + spacing - agentWidth / 2, y: agentY });

    setNodesLoaded(true);

    // compute after layout paints (2 RAFs ensures children have rendered)
    requestAnimationFrame(() => requestAnimationFrame(calculateConnectionPoints));
  }, [calculateConnectionPoints]);

  // On mount: set initial positions after first layout
  useLayoutEffect(() => {
    const t = setTimeout(() => {
      initializePositions();
    }, 60);
    return () => clearTimeout(t);
  }, [initializePositions]);

  // Recalculate connection points whenever positions change; batch with a short timeout
  useEffect(() => {
    const t = setTimeout(() => {
      calculateConnectionPoints();
    }, 16); // ~1 frame
    return () => clearTimeout(t);
  }, [managerPos, agentAPos, agentBPos, agentCPos, calculateConnectionPoints]);

  // Keep nodes visually centered on container resize without snapping if user has already adjusted them
  useEffect(() => {
    if (!containerRef.current) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newW = entry.contentRect.width;
        const newH = entry.contentRect.height;

        setContainerSize((prev) => {
          // guard the very first fire to avoid big jump
          if (prev.w === 0 && prev.h === 0) {
            requestAnimationFrame(calculateConnectionPoints);
            return { w: newW, h: newH };
          }

          const dx = (newW - prev.w) / 2;
          const dy = (newH - prev.h) / 2;

          // shift positions only if the user hasn’t moved that node
          if (!userAdjusted.current.manager) {
            setManagerPos((p) => ({ x: p.x + dx, y: p.y + dy }));
          }
          if (!userAdjusted.current.a) {
            setAgentAPos((p) => ({ x: p.x + dx, y: p.y + dy }));
          }
          if (!userAdjusted.current.b) {
            setAgentBPos((p) => ({ x: p.x + dx, y: p.y + dy }));
          }
          if (!userAdjusted.current.c) {
            setAgentCPos((p) => ({ x: p.x + dx, y: p.y + dy }));
          }

          requestAnimationFrame(calculateConnectionPoints);
          return { w: newW, h: newH };
        });
      }
    });

    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [calculateConnectionPoints]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-900 p-4 md:p-8">
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <motion.div
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8 }}
          className="mb-8"
        >
          <h1 className="text-white text-2xl md:text-4xl mb-2 bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            Agentic Framework Interconnectivity Map
          </h1>
          <p className="text-gray-400">Visualizing Hybrid Agentic Model Communication &amp; Decision Flow</p>
        </motion.div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
          {/* Main Canvas */}
          <div className="relative">
            <div
              ref={containerRef}
              className="relative bg-black/20 backdrop-blur-sm rounded-2xl border border-purple-500/20 p-8 min-h-[950px] overflow-hidden"
            >
              {/* System Disabled Overlay */}
              {!systemEnabled && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-30 rounded-2xl flex items-center justify-center"
                >
                  <div className="bg-slate-900/90 border border-red-500/50 rounded-xl p-6 text-center">
                    <Power className="w-12 h-12 text-red-400 mx-auto mb-3" />
                    <p className="text-red-300 text-lg">System Disabled</p>
                  </div>
                </motion.div>
              )}
              
              {/* Connection Lines */}
              <ConnectionLines {...connectionPoints} showConnections={showConnections && systemEnabled} />

              {/* Top Layer - Policy & Governance */}
              <motion.div initial={{ y: -100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.8, delay: 0.2 }}>
                <PolicyLayer ref={policyRef} />
              </motion.div>

              {/* Middle Layer - Manager/Supervisor */}
              {nodesLoaded && (
                <motion.div 
                  initial={{ scale: 0, opacity: 0 }} 
                  animate={{ scale: 1, opacity: systemEnabled ? 1 : 0.4 }} 
                  transition={{ duration: 0.8, delay: 0.5 }}
                >
                  <ManagerLayer
                    ref={managerRef}
                    position={managerPos}
                    dragConstraints={containerRef}
                    onDrag={(_e: any, info: { delta: { x: number; y: number } }) => {
                      userAdjusted.current.manager = true;
                      setManagerPos((prev) => ({ x: prev.x + info.delta.x, y: prev.y + info.delta.y }));
                    }}
                  />
                </motion.div>
              )}

              {/* Bottom Layer - Agent Nodes */}
              {nodesLoaded && (
                <>
                  <motion.div 
                    initial={{ y: 100, opacity: 0 }} 
                    animate={{ y: 0, opacity: systemEnabled ? 1 : 0.4 }} 
                    transition={{ duration: 0.8, delay: 0.8 }}
                  >
                    <AgentNode
                      ref={agentARef}
                      id="agent-a"
                      label="Agent A"
                      isDelegating={systemEnabled}
                      position={agentAPos}
                      dragConstraints={containerRef}
                      onDrag={(_e: any, info: { delta: { x: number; y: number } }) => {
                        userAdjusted.current.a = true;
                        setAgentAPos((prev) => ({ x: prev.x + info.delta.x, y: prev.y + info.delta.y }));
                      }}
                    />
                  </motion.div>

                  <motion.div 
                    initial={{ y: 100, opacity: 0 }} 
                    animate={{ y: 0, opacity: systemEnabled ? 1 : 0.4 }} 
                    transition={{ duration: 0.8, delay: 1 }}
                  >
                    <AgentNode
                      ref={agentBRef}
                      id="agent-b"
                      label="Agent B"
                      isDelegating={systemEnabled}
                      position={agentBPos}
                      dragConstraints={containerRef}
                      onDrag={(_e: any, info: { delta: { x: number; y: number } }) => {
                        userAdjusted.current.b = true;
                        setAgentBPos((prev) => ({ x: prev.x + info.delta.x, y: prev.y + info.delta.y }));
                      }}
                    />
                  </motion.div>

                  <motion.div 
                    initial={{ y: 100, opacity: 0 }} 
                    animate={{ y: 0, opacity: systemEnabled ? 1 : 0.4 }} 
                    transition={{ duration: 0.8, delay: 1.1 }}
                  >
                    <AgentNode
                      ref={agentCRef}
                      id="agent-c"
                      label="Agent C"
                      isDelegating={false}
                      position={agentCPos}
                      dragConstraints={containerRef}
                      onDrag={(_e: any, info: { delta: { x: number; y: number } }) => {
                        userAdjusted.current.c = true;
                        setAgentCPos((prev) => ({ x: prev.x + info.delta.x, y: prev.y + info.delta.y }));
                      }}
                    />
                  </motion.div>
                </>
              )}
            </div>
          </div>

          {/* Info Sidebar */}
          <InfoSidebar
            showConnections={showConnections}
            onToggleConnections={() => setShowConnections((s) => !s)}
            systemEnabled={systemEnabled}
            onSystemToggle={setSystemEnabled}
          />
        </div>

        {/* Legend */}
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.2 }}
          className="mt-8 bg-black/20 backdrop-blur-sm rounded-xl border border-purple-500/20 p-4 sm:p-6"
        >
          <h3 className="text-white mb-4">Legend</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 sm:gap-6">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-purple-500 rounded-full border-2 border-purple-300 shadow-lg shadow-purple-500/50 flex-shrink-0" />
              <span className="text-gray-300 text-sm">Policy Connection</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-cyan-400 rounded-full border-2 border-cyan-200 shadow-lg shadow-cyan-400/50 flex-shrink-0" />
              <span className="text-gray-300 text-sm">Manager Node</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-green-400 rounded-full border-2 border-green-200 shadow-lg flex-shrink-0" />
              <span className="text-gray-300 text-sm">Active Agent</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-gray-400 rounded-full border-2 border-gray-200 shadow-lg flex-shrink-0" />
              <span className="text-gray-300 text-sm">Constrained Agent</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-1 bg-gradient-to-r from-cyan-400 via-cyan-300 to-transparent rounded-full shadow-lg shadow-cyan-400/30 flex-shrink-0" />
              <span className="text-gray-300 text-sm">Connection Traffic</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
