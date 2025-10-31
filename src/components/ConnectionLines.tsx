import { motion } from 'motion/react';

interface Point {
  x: number;
  y: number;
}

interface ConnectionLinesProps {
  policyBottom: Point;
  managerTop: Point;
  managerBottomLeft: Point;
  managerBottomCenter: Point;
  managerBottomRight: Point;
  agentATop: Point;
  agentBTop: Point;
  agentCTop: Point;
  showConnections: boolean;
}

export function ConnectionLines({
  policyBottom,
  managerTop,
  managerBottomLeft,
  managerBottomCenter,
  managerBottomRight,
  agentATop,
  agentBTop,
  agentCTop,
  showConnections,
}: ConnectionLinesProps) {
  if (!showConnections) return null;

  // Create curved paths between connection points
  const createPath = (start: Point, end: Point) => {
    const midY = start.y + (end.y - start.y) / 2;
    return `M ${start.x} ${start.y} C ${start.x} ${midY}, ${end.x} ${midY}, ${end.x} ${end.y}`;
  };

  const connections = [
    { 
      from: policyBottom, 
      to: managerTop, 
      color: '#a78bfa', 
      label: 'Policy → Supervisor',
      strokeWidth: 4,
      glowIntensity: 6
    },
    { 
      from: managerBottomLeft, 
      to: agentATop, 
      color: '#22d3ee', 
      label: 'Supervisor → Agent A',
      strokeWidth: 3.5,
      glowIntensity: 5
    },
    { 
      from: managerBottomCenter, 
      to: agentBTop, 
      color: '#22d3ee', 
      label: 'Supervisor → Agent B',
      strokeWidth: 3.5,
      glowIntensity: 5
    },
    { 
      from: managerBottomRight, 
      to: agentCTop, 
      color: '#22d3ee', 
      label: 'Supervisor → Agent C',
      strokeWidth: 3.5,
      glowIntensity: 5
    },
  ];

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 1, width: '100%', height: '100%' }}
    >
      <defs>
        {/* Gradients for each connection */}
        {connections.map((conn, idx) => (
          <linearGradient key={`grad-${idx}`} id={`grad-${idx}`}>
            <stop offset="0%" stopColor={conn.color} stopOpacity="1" />
            <stop offset="100%" stopColor={conn.color} stopOpacity="0.6" />
          </linearGradient>
        ))}
        
        {/* Glow filters */}
        {connections.map((conn, idx) => (
          <filter key={`glow-${idx}`} id={`glow-${idx}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={conn.glowIntensity} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        ))}
      </defs>

      {/* Draw each connection */}
      {connections.map((conn, idx) => {
        const pathData = createPath(conn.from, conn.to);
        
        return (
          <motion.g key={idx}>
            {/* Outer glow layer (largest) - very visible */}
            <motion.path
              d={pathData}
              stroke={conn.color}
              strokeWidth={conn.strokeWidth + 10}
              strokeLinecap="round"
              fill="none"
              opacity="0.12"
              filter={`url(#glow-${idx})`}
            />
            
            {/* Middle glow layer */}
            <motion.path
              d={pathData}
              stroke={conn.color}
              strokeWidth={conn.strokeWidth + 5}
              strokeLinecap="round"
              fill="none"
              opacity="0.25"
            />
            
            {/* Main line with gradient - highly visible */}
            <motion.path
              d={pathData}
              stroke={`url(#grad-${idx})`}
              strokeWidth={conn.strokeWidth}
              fill="none"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ 
                duration: 1.8, 
                delay: idx * 0.3,
                ease: [0.4, 0, 0.2, 1]
              }}
            />
            
            {/* Bright core line for extra visibility */}
            <motion.path
              d={pathData}
              stroke={conn.color}
              strokeWidth={conn.strokeWidth / 2}
              fill="none"
              strokeLinecap="round"
              opacity="0.8"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ 
                duration: 1.8, 
                delay: idx * 0.3,
                ease: [0.4, 0, 0.2, 1]
              }}
            />
            
            {/* Animated pulse dot (larger and brighter) */}
            <motion.circle 
              r="6" 
              fill={conn.color} 
              opacity="0.95"
              filter={`url(#glow-${idx})`}
            >
              <animateMotion 
                dur="4s" 
                repeatCount="indefinite" 
                path={pathData}
                begin={`${idx * 0.6}s`}
              />
            </motion.circle>
            
            {/* Secondary pulse dot */}
            <motion.circle 
              r="4" 
              fill={conn.color} 
              opacity="0.75"
            >
              <animateMotion 
                dur="4s" 
                repeatCount="indefinite" 
                path={pathData}
                begin={`${idx * 0.6 + 2}s`}
              />
            </motion.circle>
          </motion.g>
        );
      })}
    </svg>
  );
}
