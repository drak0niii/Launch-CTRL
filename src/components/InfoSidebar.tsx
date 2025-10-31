import { Info, Lightbulb, Radio, TrendingUp, Eye, EyeOff, Terminal, Maximize2, Minimize2, Send, FileText, X, CheckCircle, XCircle, Clock, AlertTriangle, Zap, Activity, Cpu, DollarSign, Power } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useState, useRef, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Switch } from './ui/switch';

interface InfoSidebarProps {
  showConnections: boolean;
  onToggleConnections: () => void;
  systemEnabled?: boolean;
  onSystemToggle?: (enabled: boolean) => void;
}

export function InfoSidebar({ showConnections, onToggleConnections, systemEnabled = true, onSystemToggle }: InfoSidebarProps) {
  const [logs, setLogs] = useState<string[]>([
    '[INIT] System initialized.',
    '[POLICY] Governance parameters loaded.',
    '[SUPERVISOR] Monitoring tasks started.',
  ]);
  const [command, setCommand] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [showPolicyDetails, setShowPolicyDetails] = useState(false);
  const [showCommandDetails, setShowCommandDetails] = useState(false);
  const [showPerformanceDetails, setShowPerformanceDetails] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // auto-scroll logs to bottom
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleSend = () => {
    if (!command.trim()) return;
    setLogs((prev) => [...prev, `[USER] ${command.trim()}`, '[AGENT] Command acknowledged.']);
    setCommand('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Mock data for Policy Directives
  const policyDirectives = [
    { id: 1, name: 'Critical Alarm Prioritization', status: 'Active', priority: 'High', compliance: '100%', lastUpdated: '2025-10-30 08:45', description: 'All critical alarms must be handled within 5 minutes of detection.' },
    { id: 2, name: 'Human-in-the-Loop Validation', status: 'Active', priority: 'High', compliance: '100%', lastUpdated: '2025-10-30 07:30', description: 'Major decisions require human approval before execution.' },
    { id: 3, name: 'SLA Compliance Monitoring', status: 'Active', priority: 'Critical', compliance: '98%', lastUpdated: '2025-10-30 09:15', description: 'Maintain >95% SLA compliance for all service requests.' },
    { id: 4, name: 'Adaptive Correlation Rules', status: 'Active', priority: 'Medium', compliance: '100%', lastUpdated: '2025-10-29 16:20', description: 'Dynamically adjust alarm correlation based on network patterns.' },
    { id: 5, name: 'Data Privacy Protection', status: 'Active', priority: 'Critical', compliance: '100%', lastUpdated: '2025-10-30 06:00', description: 'No PII data can be logged or transmitted without encryption.' },
    { id: 6, name: 'Escalation Workflow', status: 'Active', priority: 'High', compliance: '95%', lastUpdated: '2025-10-30 05:45', description: 'Auto-escalate unresolved issues after 30 minutes.' },
    { id: 7, name: 'Resource Throttling', status: 'Active', priority: 'Medium', compliance: '100%', lastUpdated: '2025-10-29 14:10', description: 'Limit concurrent operations to prevent system overload.' },
    { id: 8, name: 'Audit Logging', status: 'Active', priority: 'Critical', compliance: '100%', lastUpdated: '2025-10-30 09:00', description: 'All agent actions must be logged for compliance audits.' },
    { id: 9, name: 'Failover Protocols', status: 'Active', priority: 'High', compliance: '100%', lastUpdated: '2025-10-30 08:20', description: 'Automatic failover to backup systems on primary failure.' },
    { id: 10, name: 'Cost Optimization', status: 'Active', priority: 'Low', compliance: '92%', lastUpdated: '2025-10-29 22:30', description: 'Minimize API costs while maintaining service quality.' },
    { id: 11, name: 'Multi-Region Sync', status: 'Active', priority: 'Medium', compliance: '100%', lastUpdated: '2025-10-30 07:55', description: 'Synchronize agent states across geographic regions.' },
    { id: 12, name: 'Performance Benchmarking', status: 'Active', priority: 'Low', compliance: '100%', lastUpdated: '2025-10-29 18:40', description: 'Track and report agent performance metrics hourly.' },
  ];

  // Mock data for Command Audit
  const commandsByType = {
    issued: 47,
    successful: 46,
    retries: 3,
    timeouts: 1,
    failed: 0,
  };

  const commandHistory = [
    { id: 1, timestamp: '2025-10-30 09:42:15', type: 'CHECK_POWER_OUTAGE', agent: 'Agent A', status: 'Success', duration: '2.3s', user: 'Supervisor AI', retry: 0 },
    { id: 2, timestamp: '2025-10-30 09:41:50', type: 'MONITOR_RESOLUTION', agent: 'Agent B', status: 'Success', duration: '1.8s', user: 'Supervisor AI', retry: 0 },
    { id: 3, timestamp: '2025-10-30 09:40:22', type: 'VALIDATE_GRID_STATUS', agent: 'Agent A', status: 'Success', duration: '3.1s', user: 'Supervisor AI', retry: 1 },
    { id: 4, timestamp: '2025-10-30 09:39:45', type: 'DISPATCH_FLM', agent: 'Agent C', status: 'Timeout', duration: '30.0s', user: 'System Auto', retry: 0 },
    { id: 5, timestamp: '2025-10-30 09:38:10', type: 'CHECK_SITE_BATTERY', agent: 'Agent B', status: 'Success', duration: '1.2s', user: 'Supervisor AI', retry: 0 },
  ];

  const agentCommandStats = [
    { 
      agent: 'Agent A', 
      issued: 18, 
      successful: 17, 
      failed: 0, 
      successRate: '94.4%',
      recommendations: ['Optimize grid validation queries', 'Cache power company API responses']
    },
    { 
      agent: 'Agent B', 
      issued: 22, 
      successful: 22, 
      failed: 0, 
      successRate: '100%',
      recommendations: ['Excellent performance', 'Consider expanding role scope']
    },
    { 
      agent: 'Agent C', 
      issued: 7, 
      successful: 6, 
      failed: 1, 
      successRate: '85.7%',
      recommendations: ['Increase timeout threshold for dispatch commands', 'Add retry logic for FLM dispatch']
    },
  ];

  // Mock data for Agent Performance
  const agentPerformance = [
    {
      name: 'Agent A',
      role: 'Power Grid Validator',
      completion: 94,
      accuracy: 97.2,
      failRate: 5.6,
      overrides: 2,
      precision: 0.95,
      recall: 0.92,
      autoRetrySuccess: 88,
      tokensUsed: 145230,
      model: 'GPT-4o',
      avgCostPerTask: '$0.042',
      issues: ['Occasional grid API timeouts', 'Cache hit rate could be improved']
    },
    {
      name: 'Agent B',
      role: 'Outage Monitor',
      completion: 100,
      accuracy: 99.1,
      failRate: 0,
      overrides: 0,
      precision: 0.99,
      recall: 0.98,
      autoRetrySuccess: 100,
      tokensUsed: 98450,
      model: 'GPT-4o-mini',
      avgCostPerTask: '$0.015',
      issues: []
    },
    {
      name: 'Agent C',
      role: 'FLM Dispatcher',
      completion: 67,
      accuracy: 85.7,
      failRate: 14.3,
      overrides: 5,
      precision: 0.82,
      recall: 0.79,
      autoRetrySuccess: 65,
      tokensUsed: 67890,
      model: 'Claude 3.5 Sonnet',
      avgCostPerTask: '$0.038',
      issues: ['Delegation disabled - constrained mode', 'Timeout threshold too low', 'Needs improved retry logic']
    },
  ];

  return (
    <>
      {/* Normal Sidebar */}
      {!expanded && (
        <motion.div 
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
          className="bg-gradient-to-b from-slate-900/95 to-slate-800/95 backdrop-blur-sm rounded-2xl p-5 border border-purple-500/30 shadow-2xl min-h-[950px] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-purple-500/20 rounded-lg border border-purple-400/30">
                <Info className="w-4 h-4 text-purple-300" />
              </div>
              <h3 className="text-white text-base">System Metrics</h3>
            </div>
          </div>
          
          <div className="space-y-3 flex-1 overflow-y-auto">
            {/* System Power Control */}
            <div className={`rounded-lg p-3 border transition-all ${
              systemEnabled 
                ? 'bg-green-500/10 border-green-400/30' 
                : 'bg-red-500/10 border-red-400/30'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Power className={`w-4 h-4 transition-colors ${
                    systemEnabled ? 'text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.5)]' : 'text-red-400'
                  }`} />
                  <span className={`text-sm transition-colors ${
                    systemEnabled ? 'text-green-300' : 'text-red-300'
                  }`}>
                    System {systemEnabled ? 'Online' : 'Offline'}
                  </span>
                </div>
                <Switch 
                  checked={systemEnabled} 
                  onCheckedChange={onSystemToggle}
                  aria-label="Toggle system power"
                  className="data-[state=checked]:bg-green-500"
                />
              </div>
              <p className="text-[10px] text-gray-400 leading-tight">
                {systemEnabled 
                  ? 'Agentic System is turn on' 
                  : 'Turn on to start system'}
              </p>
            </div>
            {/* Policy Directives */}
            <div className="bg-black/30 rounded-lg p-3 border border-purple-400/20">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-3.5 h-3.5 text-yellow-400" />
                  <span className="text-purple-200 text-xs">Policy Directives</span>
                </div>
                <button
                  onClick={() => setShowPolicyDetails(true)}
                  className="p-1 rounded hover:bg-purple-500/20 border border-purple-400/30 transition"
                  title="View Details"
                >
                  <FileText className="w-3 h-3 text-purple-300" />
                </button>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-400">Active Rules</span>
                  <span className="text-white">12</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-400">Compliance</span>
                  <span className="text-green-400">100%</span>
                </div>
              </div>
            </div>
            
            {/* Managerial Commands */}
            <div className="bg-black/30 rounded-lg p-3 border border-cyan-400/20">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Radio className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-cyan-200 text-xs">Commands Issued</span>
                </div>
                <button
                  onClick={() => setShowCommandDetails(true)}
                  className="p-1 rounded hover:bg-cyan-500/20 border border-cyan-400/30 transition"
                  title="View Details"
                >
                  <FileText className="w-3 h-3 text-cyan-300" />
                </button>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-400">Last Hour</span>
                  <span className="text-white">47</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-400">Success Rate</span>
                  <span className="text-green-400">98.2%</span>
                </div>
              </div>
            </div>
            
            {/* Agent Performance */}
            <div className="bg-black/30 rounded-lg p-3 border border-green-400/20">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-green-200 text-xs">Agent Performance</span>
                </div>
                <button
                  onClick={() => setShowPerformanceDetails(true)}
                  className="p-1 rounded hover:bg-green-500/20 border border-green-400/30 transition"
                  title="View Details"
                >
                  <FileText className="w-3 h-3 text-green-300" />
                </button>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-400">Avg Response</span>
                  <span className="text-white">2.3s</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-400">Task Completion</span>
                  <span className="text-green-400">91%</span>
                </div>
              </div>
            </div>

            {/* Command Console */}
            <div className="bg-black/40 rounded-lg p-3 border border-blue-400/20">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-blue-200 text-xs">Command Console</span>
                </div>
                <button
                  onClick={() => setExpanded(true)}
                  className="p-1 rounded hover:bg-blue-500/20 border border-blue-400/30 transition"
                  title="Expand Console"
                  disabled={!systemEnabled}
                >
                  <Maximize2 className="w-3 h-3 text-blue-300" />
                </button>
              </div>

              {/* Logs window */}
              <div className="bg-slate-950/60 border border-slate-700 rounded-md p-2 text-[10px] text-gray-300 font-mono overflow-y-auto h-80">
                {logs.map((line, i) => (
                  <p key={i} className="whitespace-pre-wrap leading-tight">{line}</p>
                ))}
                <div ref={logEndRef} />
              </div>

              {/* Command input */}
              <div className="mt-2 flex items-end gap-2">
                <textarea
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="Type command here"
                  disabled={!systemEnabled}
                  className="flex-1 bg-slate-800/70 border border-slate-700 rounded-md text-[10px] text-gray-200 p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ lineHeight: '1.2em' }}
                  aria-label="Command input"
                />
                <button
                  onClick={handleSend}
                  disabled={!systemEnabled}
                  className="flex items-center justify-center bg-blue-600 hover:bg-blue-500 transition text-white text-[10px] font-semibold rounded-md px-2 py-1.5 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Send command"
                >
                  <Send className="w-3 h-3 mr-1" /> Send
                </button>
              </div>
            </div>

            {/* Connection Toggle */}
            <button
              onClick={onToggleConnections}
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 rounded-lg p-3 border border-purple-400/30 transition-all shadow-lg hover:shadow-purple-500/20"
            >
              <div className="flex items-center justify-center gap-2">
                {showConnections ? (
                  <Eye className="w-4 h-4 text-white" />
                ) : (
                  <EyeOff className="w-4 h-4 text-white" />
                )}
                <span className="text-white text-sm">
                  {showConnections ? 'Hide' : 'Show'} Connections
                </span>
              </div>
            </button>
          </div>
        </motion.div>
      )}

      {/* Expanded Console (Bottom Right) */}
      <AnimatePresence>
        {expanded && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setExpanded(false)}
            />
            
            {/* Expanded Console */}
            <motion.div
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.3 }}
              transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
              style={{ transformOrigin: 'bottom right' }}
              className="fixed bottom-8 right-8 z-50 w-[800px] h-[600px] bg-gradient-to-b from-slate-900/98 to-slate-800/98 backdrop-blur-md rounded-2xl p-6 border border-blue-500/40 shadow-2xl"
            >
            {/* Expanded Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-blue-400" />
                <h3 className="text-white">Command Console - Expanded</h3>
              </div>
              <button
                onClick={() => setExpanded(false)}
                className="p-2 rounded-lg hover:bg-blue-500/20 border border-blue-400/30 transition"
                title="Minimize Console"
              >
                <X className="w-4 h-4 text-blue-300" />
              </button>
            </div>

            {/* Expanded Content */}
            <div className="flex flex-col h-[calc(100%-3rem)]">
              {/* Logs window - Full height */}
              <div className="flex-1 bg-slate-950/60 border border-slate-700 rounded-md p-3 text-xs text-gray-300 font-mono overflow-y-auto mb-4">
                {logs.map((line, i) => (
                  <p key={i} className="whitespace-pre-wrap leading-relaxed">{line}</p>
                ))}
                <div ref={logEndRef} />
              </div>

              {/* Command input */}
              <div className="flex items-end gap-2">
                <textarea
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="Type command here"
                  disabled={!systemEnabled}
                  className="flex-1 bg-slate-800/70 border border-slate-700 rounded-md text-sm text-gray-200 p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ lineHeight: '1.4em' }}
                  aria-label="Command input"
                />
                <button
                  onClick={handleSend}
                  disabled={!systemEnabled}
                  className="flex items-center justify-center bg-blue-600 hover:bg-blue-500 transition text-white text-sm font-semibold rounded-md px-4 py-3 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Send command"
                >
                  <Send className="w-4 h-4 mr-2" /> Send
                </button>
              </div>
            </div>
          </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Policy Directives Details Modal */}
      <AnimatePresence>
        {showPolicyDetails && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
              onClick={() => setShowPolicyDetails(false)}
            />
            
            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-[1200px] h-[85vh] max-h-[900px] bg-gradient-to-b from-slate-900/98 to-slate-800/98 backdrop-blur-md rounded-2xl p-6 border border-purple-500/40 shadow-2xl"
            >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-yellow-400" />
                <h3 className="text-white">Policy Directives - Detailed View</h3>
              </div>
              <button
                onClick={() => setShowPolicyDetails(false)}
                className="p-2 rounded-lg hover:bg-purple-500/20 border border-purple-400/30 transition"
                title="Close"
              >
                <X className="w-4 h-4 text-purple-300" />
              </button>
            </div>

            <div className="overflow-y-auto h-[calc(100%-3rem)]">
              <div className="grid gap-3">
                {policyDirectives.map((policy) => (
                  <div key={policy.id} className="bg-black/30 rounded-lg p-4 border border-purple-400/20 hover:border-purple-400/40 transition">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-white">{policy.name}</h4>
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            policy.priority === 'Critical' ? 'bg-red-500/20 text-red-300 border border-red-400/30' :
                            policy.priority === 'High' ? 'bg-orange-500/20 text-orange-300 border border-orange-400/30' :
                            policy.priority === 'Medium' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-400/30' :
                            'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                          }`}>
                            {policy.priority}
                          </span>
                        </div>
                        <p className="text-gray-400 text-sm mb-2">{policy.description}</p>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-gray-500">Updated: {policy.lastUpdated}</span>
                          <span className="flex items-center gap-1">
                            <CheckCircle className="w-3 h-3 text-green-400" />
                            <span className="text-green-400">Compliance: {policy.compliance}</span>
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 px-2 py-1 bg-green-500/20 border border-green-400/30 rounded text-xs text-green-300">
                        <Activity className="w-3 h-3" />
                        {policy.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Command Details Modal */}
      <AnimatePresence>
        {showCommandDetails && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
              onClick={() => setShowCommandDetails(false)}
            />
            
            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-[1200px] h-[85vh] max-h-[900px] bg-gradient-to-b from-slate-900/98 to-slate-800/98 backdrop-blur-md rounded-2xl p-6 border border-cyan-500/40 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-cyan-400" />
                <h3 className="text-white">Command Audit Trail - Full Details</h3>
              </div>
              <button
                onClick={() => setShowCommandDetails(false)}
                className="p-2 rounded-lg hover:bg-cyan-500/20 border border-cyan-400/30 transition"
                title="Close"
              >
                <X className="w-4 h-4 text-cyan-300" />
              </button>
            </div>

            <div className="h-[calc(100%-3rem)]">
              <Tabs defaultValue="by-type" className="h-full flex flex-col">
                <TabsList className="bg-slate-800/50 border border-cyan-400/20 mb-4">
                  <TabsTrigger value="by-type" className="data-[state=active]:bg-cyan-500/20">By Command Type</TabsTrigger>
                  <TabsTrigger value="by-agent" className="data-[state=active]:bg-cyan-500/20">By Target Agent</TabsTrigger>
                  <TabsTrigger value="history" className="data-[state=active]:bg-cyan-500/20">Command History</TabsTrigger>
                </TabsList>

                <TabsContent value="by-type" className="flex-1 overflow-y-auto">
                  <div className="grid grid-cols-5 gap-4 mb-6">
                    <div className="bg-black/30 rounded-lg p-4 border border-cyan-400/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-cyan-400" />
                        <span className="text-gray-400 text-xs">Issued</span>
                      </div>
                      <p className="text-white text-2xl">{commandsByType.issued}</p>
                    </div>
                    <div className="bg-black/30 rounded-lg p-4 border border-green-400/20">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle className="w-4 h-4 text-green-400" />
                        <span className="text-gray-400 text-xs">Successful</span>
                      </div>
                      <p className="text-white text-2xl">{commandsByType.successful}</p>
                    </div>
                    <div className="bg-black/30 rounded-lg p-4 border border-yellow-400/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-yellow-400" />
                        <span className="text-gray-400 text-xs">Retries</span>
                      </div>
                      <p className="text-white text-2xl">{commandsByType.retries}</p>
                    </div>
                    <div className="bg-black/30 rounded-lg p-4 border border-orange-400/20">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-orange-400" />
                        <span className="text-gray-400 text-xs">Timeouts</span>
                      </div>
                      <p className="text-white text-2xl">{commandsByType.timeouts}</p>
                    </div>
                    <div className="bg-black/30 rounded-lg p-4 border border-red-400/20">
                      <div className="flex items-center gap-2 mb-2">
                        <XCircle className="w-4 h-4 text-red-400" />
                        <span className="text-gray-400 text-xs">Failed</span>
                      </div>
                      <p className="text-white text-2xl">{commandsByType.failed}</p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="by-agent" className="flex-1 overflow-y-auto">
                  <div className="space-y-4">
                    {agentCommandStats.map((agent, idx) => (
                      <div key={idx} className="bg-black/30 rounded-lg p-4 border border-cyan-400/20">
                        <h4 className="text-white mb-3">{agent.agent}</h4>
                        <div className="grid grid-cols-4 gap-4 mb-4">
                          <div>
                            <span className="text-gray-400 text-xs">Issued</span>
                            <p className="text-white">{agent.issued}</p>
                          </div>
                          <div>
                            <span className="text-gray-400 text-xs">Successful</span>
                            <p className="text-green-400">{agent.successful}</p>
                          </div>
                          <div>
                            <span className="text-gray-400 text-xs">Failed</span>
                            <p className="text-red-400">{agent.failed}</p>
                          </div>
                          <div>
                            <span className="text-gray-400 text-xs">Success Rate</span>
                            <p className="text-white">{agent.successRate}</p>
                          </div>
                        </div>
                        <div className="bg-black/40 rounded p-3 border border-yellow-400/20">
                          <p className="text-yellow-300 text-xs mb-2">Recommendations:</p>
                          <ul className="text-gray-300 text-xs space-y-1">
                            {agent.recommendations.map((rec, i) => (
                              <li key={i}>• {rec}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="history" className="flex-1 overflow-y-auto">
                  <div className="space-y-2">
                    {commandHistory.map((cmd) => (
                      <div key={cmd.id} className="bg-black/30 rounded-lg p-3 border border-cyan-400/20 hover:border-cyan-400/40 transition">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className="text-gray-500 text-xs font-mono">{cmd.timestamp}</span>
                            <span className="px-2 py-0.5 bg-cyan-500/20 border border-cyan-400/30 rounded text-xs text-cyan-300">{cmd.type}</span>
                            <span className="text-gray-400 text-xs">→ {cmd.agent}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-gray-400 text-xs">{cmd.duration}</span>
                            {cmd.retry > 0 && <span className="text-yellow-400 text-xs">Retry: {cmd.retry}</span>}
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              cmd.status === 'Success' ? 'bg-green-500/20 text-green-300 border border-green-400/30' :
                              cmd.status === 'Timeout' ? 'bg-orange-500/20 text-orange-300 border border-orange-400/30' :
                              'bg-red-500/20 text-red-300 border border-red-400/30'
                            }`}>
                              {cmd.status}
                            </span>
                          </div>
                        </div>
                        <div className="text-gray-500 text-xs">Issued by: {cmd.user}</div>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Agent Performance Details Modal */}
      <AnimatePresence>
        {showPerformanceDetails && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
              onClick={() => setShowPerformanceDetails(false)}
            />
            
            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-[1200px] h-[85vh] max-h-[900px] bg-gradient-to-b from-slate-900/98 to-slate-800/98 backdrop-blur-md rounded-2xl p-6 border border-green-500/40 shadow-2xl"
            >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-400" />
                <h3 className="text-white">Agent Performance - Detailed Analytics</h3>
              </div>
              <button
                onClick={() => setShowPerformanceDetails(false)}
                className="p-2 rounded-lg hover:bg-green-500/20 border border-green-400/30 transition"
                title="Close"
              >
                <X className="w-4 h-4 text-green-300" />
              </button>
            </div>

            <div className="overflow-y-auto h-[calc(100%-3rem)]">
              <div className="space-y-6">
                {agentPerformance.map((agent, idx) => (
                  <div key={idx} className="bg-black/30 rounded-lg p-5 border border-green-400/20">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-white text-lg">{agent.name}</h4>
                      <span className="px-3 py-1 bg-blue-500/20 border border-blue-400/30 rounded text-sm text-blue-300">
                        {agent.role}
                      </span>
                    </div>

                    {/* Performance Metrics Grid */}
                    <div className="grid grid-cols-5 gap-3 mb-4">
                      <div className="bg-black/40 rounded p-3 border border-green-400/20">
                        <span className="text-gray-400 text-xs">Completion %</span>
                        <p className="text-white text-xl mt-1">{agent.completion}%</p>
                        <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
                          <div className="bg-green-400 h-1.5 rounded-full" style={{ width: `${agent.completion}%` }} />
                        </div>
                      </div>
                      <div className="bg-black/40 rounded p-3 border border-blue-400/20">
                        <span className="text-gray-400 text-xs">Accuracy</span>
                        <p className="text-white text-xl mt-1">{agent.accuracy}%</p>
                        <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
                          <div className="bg-blue-400 h-1.5 rounded-full" style={{ width: `${agent.accuracy}%` }} />
                        </div>
                      </div>
                      <div className="bg-black/40 rounded p-3 border border-red-400/20">
                        <span className="text-gray-400 text-xs">Fail Rate %</span>
                        <p className="text-white text-xl mt-1">{agent.failRate}%</p>
                        <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
                          <div className="bg-red-400 h-1.5 rounded-full" style={{ width: `${agent.failRate}%` }} />
                        </div>
                      </div>
                      <div className="bg-black/40 rounded p-3 border border-yellow-400/20">
                        <span className="text-gray-400 text-xs">Overrides</span>
                        <p className="text-white text-xl mt-1">{agent.overrides}</p>
                      </div>
                      <div className="bg-black/40 rounded p-3 border border-purple-400/20">
                        <span className="text-gray-400 text-xs">Auto-Retry %</span>
                        <p className="text-white text-xl mt-1">{agent.autoRetrySuccess}%</p>
                        <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
                          <div className="bg-purple-400 h-1.5 rounded-full" style={{ width: `${agent.autoRetrySuccess}%` }} />
                        </div>
                      </div>
                    </div>

                    {/* ML Metrics */}
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="bg-black/40 rounded p-3 border border-cyan-400/20">
                        <h5 className="text-cyan-300 text-sm mb-3">ML Performance Metrics</h5>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400 text-xs">Precision</span>
                            <span className="text-white text-sm">{agent.precision.toFixed(2)}</span>
                          </div>
                          <div className="w-full bg-gray-700 rounded-full h-1.5">
                            <div className="bg-cyan-400 h-1.5 rounded-full" style={{ width: `${agent.precision * 100}%` }} />
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400 text-xs">Recall</span>
                            <span className="text-white text-sm">{agent.recall.toFixed(2)}</span>
                          </div>
                          <div className="w-full bg-gray-700 rounded-full h-1.5">
                            <div className="bg-cyan-400 h-1.5 rounded-full" style={{ width: `${agent.recall * 100}%` }} />
                          </div>
                        </div>
                      </div>

                      <div className="bg-black/40 rounded p-3 border border-indigo-400/20">
                        <h5 className="text-indigo-300 text-sm mb-3">AI Model & Cost</h5>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Cpu className="w-4 h-4 text-indigo-400" />
                            <span className="text-gray-400 text-xs">Model:</span>
                            <span className="text-white text-sm">{agent.model}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Activity className="w-4 h-4 text-green-400" />
                            <span className="text-gray-400 text-xs">Tokens Used:</span>
                            <span className="text-white text-sm">{agent.tokensUsed.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-yellow-400" />
                            <span className="text-gray-400 text-xs">Avg Cost/Task:</span>
                            <span className="text-white text-sm">{agent.avgCostPerTask}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Issues */}
                    {agent.issues.length > 0 && (
                      <div className="bg-orange-500/10 rounded p-3 border border-orange-400/30">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="w-4 h-4 text-orange-400" />
                          <span className="text-orange-300 text-sm">Issues & Recommendations</span>
                        </div>
                        <ul className="text-gray-300 text-xs space-y-1">
                          {agent.issues.map((issue, i) => (
                            <li key={i}>• {issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {agent.issues.length === 0 && (
                      <div className="bg-green-500/10 rounded p-3 border border-green-400/30">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-400" />
                          <span className="text-green-300 text-sm">No issues detected - Optimal performance</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
