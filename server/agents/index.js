// server/agents/index.js
// Central registry for all agents (avoids cross-import spaghetti)

import { correlationAgent } from './correlationAgent.js';
import { troubleshootingAgent } from './troubleshooting.js';
import { rcaAgent } from './rca.js';

const registry = {
  correlation: correlationAgent,      // Agent A
  troubleshooting: troubleshootingAgent, // Agent B
  rca: rcaAgent,                      // Agent C
};

const aliasMap = new Map([
  ['a', 'correlation'],
  ['agent a', 'correlation'],
  ['correlation', 'correlation'],

  ['b', 'troubleshooting'],
  ['agent b', 'troubleshooting'],
  ['mitigation', 'troubleshooting'],
  ['troubleshooting', 'troubleshooting'],

  ['c', 'rca'],
  ['agent c', 'rca'],
  ['dispatch', 'rca'],
  ['rca', 'rca'],
]);

export function getAgentKey(input = '') {
  const key = String(input || '').trim().toLowerCase();
  return aliasMap.get(key) || null;
}

export function getAgent(input = '') {
  const k = getAgentKey(input);
  return k ? registry[k] : null;
}

export function listAgents() {
  return Object.entries(registry).map(([key, agent]) => ({
    key,
    name: agent?.name ?? key,
    status: agent?.summary?.status ?? 'Unknown',
    tasks: agent?.summary?.tasks ?? 0,
  }));
}

export function statusSnapshot() {
  return {
    correlation: correlationAgent.summary,
    troubleshooting: troubleshootingAgent.summary,
    rca: rcaAgent.summary,
  };
}

export { registry as agents };
