// server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

// Top-level utility routes
import logsRoutes from './routes/logs.routes.js';
import rcaRoutes from './routes/rca.routes.js';               // /api/rca  (top-level RCA)

// System state (for console tools)
import { getSystemState, setSystemEnabled, subscribe } from './system/state.js';

// Policy + Supervisor
import policyRoutes from './policy/routes.js';
import supervisorRoutes from './supervisor/routes.js';
import { getPolicy } from './policy/store.js';

// Agent routers (agent-scoped)
import correlationRoutes from './agents/correlation.routes.js';
import troubleshootingRoutes from './agents/troubleshooting.routes.js';
import rcaAgentRoutes from './agents/rca.routes.js';          // alias to avoid name clash

// Tower bridge + routes
import towerRoutes from './tower/routes.js';
import { initTowerBridge } from './tower/bridge.js';

// Incident bus (SSE) routes
import busRoutes from './bus/incidentBus.routes.js';

// Pipeline wiring
import { initPipeline } from './supervisor/pipeline.js';

// ✅ use the real exports from supervisor/store.js
import {
  summary as supervisorSummary,
  start as supervisorStart,
  stop as supervisorStop,
  pause as supervisorPause,
  resume as supervisorResume,
} from './supervisor/store.js';

// Memory helpers (console)
import {
  loadConsoleMemory,
  appendMessage,
  addNote,
  setTag,
  resetConsoleMemory,
  getRecentConsoleMessages,
} from './memory/storage.js';

const app = express();
app.use(cors());
app.use(express.json());

// --- mount routes ---
app.use('/api/policy', policyRoutes);
app.use('/api/supervisor', supervisorRoutes);
app.use('/api/agents/correlation', correlationRoutes);
app.use('/api/agents/troubleshooting', troubleshootingRoutes);
app.use('/api/agents/rca', rcaAgentRoutes);   // <- agent-scoped RCA routes
app.use('/api/tower', towerRoutes);
app.use('/api/bus', busRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/rca', rcaRoutes);               // <- top-level RCA routes

// --- tower bridge + pipeline init ---
initTowerBridge();
// pass a getter that returns the latest supervisor summary
initPipeline({ getSupervisor: supervisorSummary });

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });



/* =======================================================================================
 * Console behavior rules (single source of truth)
 * ======================================================================================= */
const CONSOLE_BEHAVIOR_PROMPT = `
You are the Command Console Assistant for the Launch-CTRL system.

Your role:
- Interpret console commands (power on/off, status queries, connection toggles, supervisor start/pause/resume/stop, etc.).
- For casual conversation (greetings, identity questions, small talk), respond politely and briefly, then offer "Type \`help\` to see available commands."

Strict rules (very important):
- Never count how many times the user said or asked something.
- Do not perform meta-analysis of the chat (e.g., "you said X N times").
- When referring to a prior user message, DO NOT quote it verbatim; paraphrase ("that question", "your greeting") instead.
- If you must reason over conversation history, consider ONLY user messages; ignore assistant messages for any counts or stats.
- For system facts (online/offline, counts on/off, version, last update, history, uptime), always use the system tool output; do not guess numbers.
- Keep responses concise and focused on console operations.
`;

/* =======================================================================================
 * Helpers
 * ======================================================================================= */
function fresh(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res;
}
function ok(body = {}) {
  return { ok: true, serverTime: new Date().toISOString(), ...body };
}
function err(message, extra = {}) {
  return { ok: false, serverTime: new Date().toISOString(), error: message, ...extra };
}

// --- Health (now also returns supervisor snapshot) ---
app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    service: 'Launch-CTRL server',
    ts: new Date().toISOString(),
    supervisor: supervisorSummary(),
  });
});

/* =======================================================================================
 * Intent parsing + LLM helpers
 * ======================================================================================= */
function parseSystemIntent(prompt = '') {
  const p = String(prompt).toLowerCase();
  const off =
    /\b(turn|switch|set)\s+(the\s+)?system\s+(off|down|disable(d)?|stop|shutdown|shut\s*down)\b/.test(p) ||
    /\bdisable\s+system\b/.test(p) ||
    /\bsystem\s*:\s*off\b/.test(p);
  const on =
    /\b(turn|switch|set)\s+(the\s+)?system\s+(on|up|enable(d)?|start)\b/.test(p) ||
    /\benable\s+system\b/.test(p) ||
    /\bsystem\s*:\s*on\b/.test(p);

  if (on && !off) return { match: true, intent: 'system_power', action: 'on' };
  if (off && !on) return { match: true, intent: 'system_power', action: 'off' };
  return { match: false };
}

// agent alias mapper (A/B/C or names)
function mapAgent(a = '') {
  const t = String(a).toLowerCase();
  if (t === 'a' || t.includes('correlation')) return 'correlation';
  if (t === 'b' || t.includes('troubleshooting') || t.includes('mitigation')) return 'troubleshooting';
  if (t === 'c' || t === 'rca' || t.includes('dispatch')) return 'rca';
  return null;
}

// approvals regex fallback
function parseApprovalFallback(prompt = '') {
  const p = String(prompt).trim();
  const approve = p.match(/^\s*(approve|accept)\s*#?\s*(\d+)\s*$/i);
  if (approve) return { intent: 'approvals', action: 'approve', id: Number(approve[2]) };
  const reject = p.match(/^\s*(reject|deny|decline)\s*#?\s*(\d+)\s*$/i);
  if (reject) return { intent: 'approvals', action: 'reject', id: Number(reject[2]) };
  if (/^\s*(list|show)\s+(approval|approvals)\s*$/i.test(p)) return { intent: 'approvals', action: 'list' };
  return null;
}

async function classifyIntentLLM(prompt) {
  const sys = `
You are the intent brain for a dashboard command console. Classify the user's line into a console intent.

Return ONLY a JSON object (no prose) in exactly one of these shapes (no extra keys):
{"intent":"system_power","action":"on"|"off"}
{"intent":"system_query","aspect":"status"|"count_on"|"count_off"|"version"|"last_updated"|"history"|"uptime"|"uptime_minutes"}
{"intent":"toggle_connections","action":"on"|"off"|"toggle"}
{"intent":"console_panel","action":"expand"|"collapse"}
{"intent":"policy_query","aspect":"version"|"values"|"last_updated"}
{"intent":"supervisor_control","action":"start"|"pause"|"resume"|"stop"}
{"intent":"supervisor_query","aspect":"status"}
{"intent":"supervisor_auto","enabled":true|false}
{"intent":"agent_control","agent":"a"|"b"|"c"|"correlation"|"troubleshooting"|"rca","action":"start"|"stop"}
{"intent":"agent_query","agent":"a"|"b"|"c"|"correlation"|"troubleshooting"|"rca","aspect":"status"|"logs_url"}
{"intent":"approvals","action":"list"|"approve"|"reject","id"?:number}
{"intent":"none"}
`.trim();

  try {
    const cmp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: String(prompt) },
      ],
    });

    const raw = cmp.choices?.[0]?.message?.content?.trim() || '{}';
    const text = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const data = JSON.parse(text);
    if (data && typeof data === 'object' && data.intent) return data;
  } catch { /* ignore */ }
  return { intent: 'none' };
}

function buildMemoryPreamble(mem) {
  return [
    'You are the Command Console Assistant for Launch CTRL.',
    'You understand the dashboard and its controls. Be concise.',
    'Agents:',
    '- Agent A: Correlation Agent (delegation disabled by policy).',
    '- Agent B: Troubleshooting Agent.',
    '- Agent C: Dispatch Agent.',
    'Persistent Memory (notes):',
    ...(mem?.notes ?? []).map((n) => `- ${n}`),
    'Persistent Memory (tags):',
    ...Object.entries(mem?.tags ?? {}).map(([k, v]) => `- ${k}: ${v}`),
    'Use the memory to interpret the user’s needs and explain actions that do not map to a console intent.',
  ].join('\n');
}

function buildSystemSnapshotLine(state = getSystemState(), extras = {}) {
  const { enabled, version, updatedAt } = state || {};
  const serverTime = new Date().toISOString();
  const parts = [
    `SYSTEM_STATE v${version ?? '0'}`,
    `enabled=${Boolean(enabled)}`,
    `updatedAt=${updatedAt ?? serverTime}`,
    `serverTime=${serverTime}`,
  ];
  if (extras.dashboardEnabled !== undefined) {
    parts.push(`dashboardEnabled=${Boolean(extras.dashboardEnabled)}`);
  }
  return parts.join(' ');
}

function formatSystemQuery(aspect) {
  const s = getSystemState();
  switch (aspect) {
    case 'status':
      return `The system is ${s.enabled ? 'Online ✅' : 'Offline ⛔'} (v${s.version}, updated ${s.updatedAt}).`;
    case 'count_on':
      return `You have turned it on ${s.counts?.on ?? 0} time(s).`;
    case 'count_off':
      return `You have turned it off ${s.counts?.off ?? 0} time(s).`;
    case 'version':
      return `Current state version is v${s.version}.`;
    case 'last_updated':
      return `Last change was at ${s.updatedAt}.`;
    case 'history': {
      const h = Array.isArray(s.history) ? s.history.slice(-5).reverse() : [];
      if (!h.length) return 'No state changes recorded yet.';
      const lines = h.map(
        (e) => `v${e.version}: ${e.enabled ? 'Online' : 'Offline'} @ ${e.updatedAt}${e.source ? ` (${e.source})` : ''}`
      );
      return `Recent changes:\n- ${lines.join('\n- ')}`;
    }
    case 'uptime': {
      const secs = Number(s.uptimeSeconds || 0);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const sc = secs % 60;
      return s.enabled
        ? `Uptime: ${h}h ${m}m ${sc}s since ${s.lastOnAt || s.updatedAt}.`
        : `The system is Offline ⛔. Uptime is 0 while offline. Last online was ${s.lastOnAt || 'unknown'}.`;
    }
    case 'uptime_minutes': {
      const mins = Math.floor(Number(s.uptimeSeconds || 0) / 60);
      return s.enabled ? `Uptime: ${mins} minute(s).` : `The system is Offline ⛔. Uptime is 0 minutes while offline.`;
    }
    default:
      return `The system is ${s.enabled ? 'Online ✅' : 'Offline ⛔'} (v${s.version}, updated ${s.updatedAt}).`;
  }
}

function formatPolicyQuery(aspect) {
  const p = getPolicy();
  switch (aspect) {
    case 'version':
      return `Policy version v${p.version ?? 0}.`;
    case 'last_updated':
      return `Policy last updated at ${p.updatedAt ?? 'unknown'}.`;
    case 'values':
      return `Active policy → Alarm: ${p.alarmPrioritization}, WoW: ${p.waysOfWorking}, KPI: ${p.kpiAlignment} (v${p.version ?? 0}, updated ${p.updatedAt ?? 'unknown'}).`;
    default:
      return `Policy version v${p.version ?? 0} (updated ${p.updatedAt ?? 'unknown'}).`;
  }
}

/* -------------------- LLM Tools -------------------- */
const LLM_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_system_state',
      description:
        'Return the authoritative live system state (enabled, version, updatedAt, lastOnAt, lastOffAt, uptimeSeconds, counts, history[≤200]).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_console_messages',
      description:
        'Return recent console transcript items: { role, content, timestamp }. When computing any conversation statistic, count ONLY items where role === "user".',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Max number of messages.' } },
        additionalProperties: false,
      },
    },
  },
];

async function runLLMWithTools(messages) {
  const first = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    tools: LLM_TOOLS,
    tool_choice: 'auto',
    messages,
  });

  const assistantMsg = first.choices?.[0]?.message;
  const calls = assistantMsg?.tool_calls ?? [];

  if (!calls.length) return assistantMsg?.content ?? '';

  const toolMessages = [];
  for (const call of calls) {
    const toolName = call.function?.name;
    const rawArgs = call.function?.arguments;

    try {
      if (toolName === 'get_system_state') {
        const state = getSystemState();
        toolMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(state) });
      } else if (toolName === 'get_console_messages') {
        let limit = 200;
        if (rawArgs) {
          try {
            const parsed = JSON.parse(rawArgs);
            if (Number.isInteger(parsed?.limit) && parsed.limit >= 1 && parsed.limit <= 500) limit = parsed.limit;
          } catch { /* ignore */ }
        }
        const msgs = await getRecentConsoleMessages(limit);
        toolMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ messages: msgs }) });
      }
    } catch (e) {
      toolMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: String(e?.message || e || 'tool_error') }) });
    }
  }

  const second = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      ...messages,
      { role: 'assistant', tool_calls: calls, content: null },
      ...toolMessages,
    ],
  });

  return second.choices?.[0]?.message?.content ?? '';
}

/* =======================================================================================
 * Command Console endpoints
 * ======================================================================================= */
app.post('/api/console', async (req, res) => {
  try {
    const { prompt, system } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string') {
      return fresh(res).status(400).json(err('Missing "prompt" string'));
    }

    await appendMessage('user', prompt);

    let intentData = await classifyIntentLLM(prompt);
    if (!intentData || intentData.intent === 'none') {
      const fbApp = parseApprovalFallback(prompt);
      if (fbApp) intentData = fbApp;
    }
    if (!intentData || intentData.intent === 'none') {
      const fb = parseSystemIntent(prompt);
      if (fb.match) intentData = { intent: fb.intent, action: fb.action };
    }

    // approvals
    if (intentData.intent === 'approvals') {
      if (intentData.action === 'list') {
        const r = await fetch('http://localhost:8787/api/supervisor/approvals');
        const j = await r.json().catch(() => ({}));
        const items = Array.isArray(j?.approvals) ? j.approvals : [];
        const lines = items.length
          ? items.map(a => `#${a.id} • ${a.siteId} • ${a.status} • ${a.reason || 'n/a'}`).join('\n- ')
          : 'No pending approvals.';
        const txt = items.length ? `Pending approvals:\n- ${lines}` : 'No pending approvals.';
        await appendMessage('assistant', txt);
        return fresh(res).json(ok({ text: txt, result: j }));
      }
      if (intentData.action === 'approve' && Number.isInteger(intentData.id)) {
        const r = await fetch(`http://localhost:8787/api/supervisor/approvals/${intentData.id}/approve`, { method: 'POST' });
        const j = await r.json().catch(() => ({}));
        const txt = j?.ok ? `✅ Approved #${intentData.id}.` : `⚠️ Could not approve #${intentData.id}.`;
        await appendMessage('assistant', txt);
        return fresh(res).status(j?.ok ? 200 : 409).json(ok({ text: txt, result: j }));
      }
      if (intentData.action === 'reject' && Number.isInteger(intentData.id)) {
        const r = await fetch(`http://localhost:8787/api/supervisor/approvals/${intentData.id}/reject`, { method: 'POST' });
        const j = await r.json().catch(() => ({}));
        const txt = j?.ok ? `🛑 Rejected #${intentData.id}.` : `⚠️ Could not reject #${intentData.id}.`;
        await appendMessage('assistant', txt);
        return fresh(res).status(j?.ok ? 200 : 409).json(ok({ text: txt, result: j }));
      }
    }

    // supervisor auto on/off
    if (intentData.intent === 'supervisor_auto') {
      const body = JSON.stringify({ enabled: !!intentData.enabled });
      const r = await fetch(`http://localhost:8787/api/supervisor/auto`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body
      });
      const j = await r.json().catch(() => ({}));
      const ack = r.ok
        ? `🤖 Auto pipeline ${intentData.enabled ? 'enabled' : 'disabled'}.`
        : `⚠️ Could not update auto pipeline.`;
      await appendMessage('assistant', ack);
      return fresh(res).status(r.ok ? 200 : 409).json(ok({ text: ack, result: j }));
    }

    if (intentData.intent === 'system_power') {
      const enabled = intentData.action === 'on';
      const state = setSystemEnabled(enabled, 'console:llm');
      const sideEffect = { systemEnabled: state.enabled, version: state.version, updatedAt: state.updatedAt };
      const ack = state.enabled ? '✅ System enabled (Online).' : '⛔ System disabled (Offline).';
      await appendMessage('assistant', ack);
      return fresh(res).json(ok({ text: ack, sideEffect }));
    }
    if (intentData.intent === 'toggle_connections') {
      const sideEffect = { toggleConnections: intentData.action };
      const ack =
        sideEffect.toggleConnections === 'on' ? '👁️ Connections shown.'
        : sideEffect.toggleConnections === 'off' ? '🙈 Connections hidden.'
        : '🔁 Connections toggled.';
      await appendMessage('assistant', ack);
      return fresh(res).json(ok({ text: ack, sideEffect }));
    }
    if (intentData.intent === 'console_panel') {
      const sideEffect = { consolePanel: intentData.action };
      const ack = sideEffect.consolePanel === 'expand' ? '🖥️ Console expanded.' : '🗕 Console minimized.';
      await appendMessage('assistant', ack);
      return fresh(res).json(ok({ text: ack, sideEffect }));
    }
    if (intentData.intent === 'policy_query') {
      const text = formatPolicyQuery(intentData.aspect);
      await appendMessage('assistant', text);
      return fresh(res).json(ok({ text }));
    }
    if (intentData.intent === 'supervisor_control') {
      let msg = 'OK';
      if (intentData.action === 'start') msg = supervisorStart();
      else if (intentData.action === 'pause') msg = supervisorPause();
      else if (intentData.action === 'resume') msg = supervisorResume();
      else if (intentData.action === 'stop') msg = supervisorStop();

      const sup = supervisorSummary();
      const ack = `🧠 Supervisor: ${sup.status.toUpperCase()} • runtime ${sup.runtimeSec}s`;
      await appendMessage('assistant', ack);
      return fresh(res).json(ok({ text: ack, sideEffect: { supervisor: sup }, message: msg }));
    }
    if (intentData.intent === 'supervisor_query' && intentData.aspect === 'status') {
      const sup = supervisorSummary();
      const ack = `🧠 Supervisor status: ${sup.status} • runtime ${sup.runtimeSec}s • tasks ${sup.tasksRouted}`;
      await appendMessage('assistant', ack);
      return fresh(res).json(ok({ text: ack, supervisor: sup }));
    }

    // agent control (start/stop)
    if (intentData.intent === 'agent_control') {
      const agent = mapAgent(intentData.agent);
      if (!agent) {
        const msg = `❓ I couldn't identify the agent ("${intentData.agent}"). Use A/B/C or correlation/troubleshooting/rca.`;
        await appendMessage('assistant', msg);
        return fresh(res).status(409).json(ok({ text: msg }));
      }
      const op = intentData.action === 'start' ? 'start' : 'stop';
      const r = await fetch(`http://localhost:8787/api/agents/${agent}/${op}`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      const ack = r.ok ? `✅ Agent ${agent.toUpperCase()} ${op}ed.` : `⚠️ Could not ${op} agent ${agent.toUpperCase()}.`;
      await appendMessage('assistant', ack);
      return fresh(res).status(r.ok ? 200 : 409).json(ok({ text: ack, result: j }));
    }

    // agent query (status / logs url)
    if (intentData.intent === 'agent_query') {
      const agent = mapAgent(intentData.agent);
      if (!agent) {
        const msg = `❓ I couldn't identify the agent ("${intentData.agent}"). Use A/B/C or correlation/troubleshooting/rca.`;
        await appendMessage('assistant', msg);
        return fresh(res).status(409).json(ok({ text: msg }));
      }
      if (intentData.aspect === 'status') {
        const r = await fetch(`http://localhost:8787/api/agents/${agent}`);
        const j = await r.json().catch(() => ({}));
        const status = j?.agent?.status ?? 'unknown';
        const tasks = j?.agent?.tasks ?? 0;
        const ack = `🧩 Agent ${agent.toUpperCase()} status: ${status} • tasks ${tasks}`;
        await appendMessage('assistant', ack);
        return fresh(res).status(r.ok ? 200 : 409).json(ok({ text: ack, result: j }));
      }
      if (intentData.aspect === 'logs_url') {
        const url = `http://localhost:8787/api/agents/${agent}/logs`;
        const ack = `📜 Open logs stream: ${url}`;
        await appendMessage('assistant', ack);
        return fresh(res).json(ok({ text: ack, url }));
      }
    }

    if (intentData.intent === 'system_query') {
      const text = formatSystemQuery(intentData.aspect);
      await appendMessage('assistant', text);
      return fresh(res).json(ok({ text }));
    }

    // ---------- fallback to LLM tools ----------
    const dashboardEnabledHdr = req.get('X-Dashboard-Enabled');
    const sysLine = buildSystemSnapshotLine(getSystemState(), {
      dashboardEnabled: dashboardEnabledHdr === undefined ? undefined : dashboardEnabledHdr === 'true',
    });

    const mem = await loadConsoleMemory();
    const memoryPreamble = buildMemoryPreamble(mem);
    const RECENT_K = 20;
    const recent = (mem.messages ?? []).slice(-RECENT_K).map((m) => ({ role: m.role, content: m.content }));

    const sysGuard = [
      CONSOLE_BEHAVIOR_PROMPT,
      'If the user asks about system status, uptime, counts (on/off), version, last update, or history, you MUST call get_system_state.',
      'If the user asks about conversation statistics, you MUST call get_console_messages and compute ONLY from USER messages.',
      'Do not guess numeric values.',
    ].join(' ');

    const text = await runLLMWithTools([
      { role: 'system', content: sysGuard },
      { role: 'system', content: sysLine },
      { role: 'system', content: memoryPreamble },
      ...(system ? [{ role: 'system', content: system }] : []),
      ...recent,
      { role: 'user', content: prompt },
    ]);

    await appendMessage('assistant', text);
    fresh(res).json(ok({ text }));
  } catch (err0) {
    console.error(err0);
    fresh(res).status(500).json(err(err0.message || 'Server error'));
  }
});

// Streaming console
app.post('/api/console/stream', async (req, res) => {
  try {
    const { prompt, system } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string') {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Missing "prompt" string');
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    req.setTimeout(0);
    res.write('');

    await appendMessage('user', prompt);

    let intentData = await classifyIntentLLM(prompt);
    if (!intentData || intentData.intent === 'none') {
      const fbApp = parseApprovalFallback(prompt);
      if (fbApp) intentData = fbApp;
    }
    if (!intentData || intentData.intent === 'none') {
      const fb = parseSystemIntent(prompt);
      if (fb.match) intentData = { intent: fb.intent, action: fb.action };
    }

    // approvals (stream)
    if (intentData.intent === 'approvals') {
      if (intentData.action === 'list') {
        const r = await fetch('http://localhost:8787/api/supervisor/approvals');
        const j = await r.json().catch(() => ({}));
        const items = Array.isArray(j?.approvals) ? j.approvals : [];
        const lines = items.length
          ? items.map(a => `#${a.id} • ${a.siteId} • ${a.status} • ${a.reason || 'n/a'}`).join('\n- ')
          : 'No pending approvals.';
        const txt = items.length ? `Pending approvals:\n- ${lines}` : 'No pending approvals.';
        res.write(txt);
        await appendMessage('assistant', txt);
        return res.end();
      }
      if (intentData.action === 'approve' && Number.isInteger(intentData.id)) {
        const r = await fetch(`http://localhost:8787/api/supervisor/approvals/${intentData.id}/approve`, { method: 'POST' });
        const j = await r.json().catch(() => ({}));
        const txt = j?.ok ? `✅ Approved #${intentData.id}.` : `⚠️ Could not approve #${intentData.id}.`;
        res.write(txt);
        await appendMessage('assistant', txt);
        return res.end();
      }
      if (intentData.action === 'reject' && Number.isInteger(intentData.id)) {
        const r = await fetch(`http://localhost:8787/api/supervisor/approvals/${intentData.id}/reject`, { method: 'POST' });
        const j = await r.json().catch(() => ({}));
        const txt = j?.ok ? `🛑 Rejected #${intentData.id}.` : `⚠️ Could not reject #${intentData.id}.`;
        res.write(txt);
        await appendMessage('assistant', txt);
        return res.end();
      }
    }

    // supervisor auto (stream)
    if (intentData.intent === 'supervisor_auto') {
      const body = JSON.stringify({ enabled: !!intentData.enabled });
      const r = await fetch(`http://localhost:8787/api/supervisor/auto`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body
      });
      const j = await r.json().catch(() => ({}));
      res.write(`[[SIDE_EFFECT]]${JSON.stringify({ autoResult: j })}\n`);
      const ack = r.ok
        ? `🤖 Auto pipeline ${intentData.enabled ? 'enabled' : 'disabled'}.`
        : `⚠️ Could not update auto pipeline.`;
      await appendMessage('assistant', ack);
      return res.end(ack);
    }

    if (intentData.intent === 'system_power') {
      const enabled = intentData.action === 'on';
      const state = setSystemEnabled(enabled, 'console:stream');
      const sideEffect = { systemEnabled: state.enabled, version: state.version, updatedAt: state.updatedAt };
      res.write(`[[SIDE_EFFECT]]${JSON.stringify(sideEffect)}\n`);
      const ack = state.enabled ? '✅ System enabled (Online).' : '⛔ System disabled (Offline).';
      res.write(ack);
      await appendMessage('assistant', ack);
      return res.end();
    }
    if (intentData.intent === 'toggle_connections') {
      const sideEffect = { toggleConnections: intentData.action };
      res.write(`[[SIDE_EFFECT]]${JSON.stringify(sideEffect)}\n`);
      const ack =
        sideEffect.toggleConnections === 'on' ? '👁️ Connections shown.'
        : sideEffect.toggleConnections === 'off' ? '🙈 Connections hidden.'
        : '🔁 Connections toggled.';
      res.write(ack);
      await appendMessage('assistant', ack);
      return res.end();
    }
    if (intentData.intent === 'console_panel') {
      const sideEffect = { consolePanel: intentData.action };
      res.write(`[[SIDE_EFFECT]]${JSON.stringify(sideEffect)}\n`);
      const ack = sideEffect.consolePanel === 'expand' ? '🖥️ Console expanded.' : '🗕 Console minimized.';
      res.write(ack);
      await appendMessage('assistant', ack);
      return res.end();
    }
    if (intentData.intent === 'policy_query') {
      const text = formatPolicyQuery(intentData.aspect);
      res.write(text);
      await appendMessage('assistant', text);
      return res.end();
    }
    if (intentData.intent === 'supervisor_control') {
      if (intentData.action === 'start') supervisorStart();
      else if (intentData.action === 'pause') supervisorPause();
      else if (intentData.action === 'resume') supervisorResume();
      else if (intentData.action === 'stop') supervisorStop();

      const sup = supervisorSummary();
      res.write(`[[SIDE_EFFECT]]${JSON.stringify({ supervisor: sup })}\n`);
      const ack = `🧠 Supervisor: ${sup.status.toUpperCase()} • runtime ${sup.runtimeSec}s`;
      await appendMessage('assistant', ack);
      return res.end(ack);
    }
    if (intentData.intent === 'supervisor_query' && intentData.aspect === 'status') {
      const sup = supervisorSummary();
      const ack = `🧠 Supervisor status: ${sup.status} • runtime ${sup.runtimeSec}s • tasks ${sup.tasksRouted}`;
      res.write(ack);
      await appendMessage('assistant', ack);
      return res.end();
    }

    // agent control / query (stream)
    if (intentData.intent === 'agent_control') {
      const agent = mapAgent(intentData.agent);
      if (!agent) {
        const msg = `❓ I couldn't identify the agent ("${intentData.agent}"). Use A/B/C or correlation/troubleshooting/rca.`;
        await appendMessage('assistant', msg);
        return res.end(msg);
      }
      const op = intentData.action === 'start' ? 'start' : 'stop';
      const r = await fetch(`http://localhost:8787/api/agents/${agent}/${op}`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      res.write(`[[SIDE_EFFECT]]${JSON.stringify({ agent: agent.toUpperCase(), op, result: j })}\n`);
      const ack = r.ok ? `✅ Agent ${agent.toUpperCase()} ${op}ed.` : `⚠️ Could not ${op} agent ${agent.toUpperCase()}.`;
      await appendMessage('assistant', ack);
      return res.end(ack);
    }
    if (intentData.intent === 'agent_query') {
      const agent = mapAgent(intentData.agent);
      if (!agent) {
        const msg = `❓ I couldn't identify the agent ("${intentData.agent}"). Use A/B/C or correlation/troubleshooting/rca.`;
        await appendMessage('assistant', msg);
        return res.end(msg);
      }
      if (intentData.aspect === 'status') {
        const r = await fetch(`http://localhost:8787/api/agents/${agent}`);
        const j = await r.json().catch(() => ({}));
        const status = j?.agent?.status ?? 'unknown';
        const tasks = j?.agent?.tasks ?? 0;
        const ack = `🧩 Agent ${agent.toUpperCase()} status: ${status} • tasks ${tasks}`;
        res.write(`[[SIDE_EFFECT]]${JSON.stringify({ agent: agent.toUpperCase(), status, tasks, result: j })}\n`);
        await appendMessage('assistant', ack);
        return res.end(ack);
      }
      if (intentData.aspect === 'logs_url') {
        const url = `http://localhost:8787/api/agents/${agent}/logs`;
        const ack = `📜 Open logs stream: ${url}`;
        await appendMessage('assistant', ack);
        return res.end(ack);
      }
    }

    if (intentData.intent === 'system_query') {
      const text = formatSystemQuery(intentData.aspect);
      res.write(text);
      await appendMessage('assistant', text);
      return res.end();
    }

    // ---------- fallback to LLM tools ----------
    const dashboardEnabledHdr = req.get('X-Dashboard-Enabled');
    const sysLine = buildSystemSnapshotLine(getSystemState(), {
      dashboardEnabled: dashboardEnabledHdr === undefined ? undefined : dashboardEnabledHdr === 'true',
    });

    const mem = await loadConsoleMemory();
    const memoryPreamble = buildMemoryPreamble(mem);
    const RECENT_K = 20;
    const recent = (mem.messages ?? []).slice(-RECENT_K).map((m) => ({ role: m.role, content: m.content }));

    const sysGuard = [
      CONSOLE_BEHAVIOR_PROMPT,
      'If the user asks about system status, uptime, counts (on/off), version, last update, or history, you MUST call get_system_state.',
      'If the user asks about conversation statistics, you MUST call get_console_messages and compute ONLY from USER messages.',
      'Do not guess numeric values.',
    ].join(' ');

    const text = await runLLMWithTools([
      { role: 'system', content: sysGuard },
      { role: 'system', content: sysLine },
      { role: 'system', content: memoryPreamble },
      ...(system ? [{ role: 'system', content: system }] : []),
      ...recent,
      { role: 'user', content: prompt },
    ]);

    res.write(text || '');
    await appendMessage('assistant', text || '');
    return res.end();
  } catch (err0) {
    console.error('Stream error:', err0);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    try { res.write(`[error] ${err0.message || 'Server error'}`); } catch {}
    return res.end();
  }
});

/* =======================================================================================
 * Memory utility routes
 * ======================================================================================= */
app.get('/api/memory/console', async (_req, res) => {
  try {
    const mem = await loadConsoleMemory();
    fresh(res).json(mem);
  } catch (e) {
    fresh(res).status(500).json(err(e.message));
  }
});

app.post('/api/memory/console/reset', async (_req, res) => {
  try {
    const freshMem = await resetConsoleMemory();
    fresh(res).json(freshMem);
  } catch (e) {
    fresh(res).status(500).json(err(e.message));
  }
});

app.post('/api/memory/console/note', async (req, res) => {
  try {
    const { note } = req.body ?? {};
    if (!note) return fresh(res).status(400).json(err('Missing "note"'));
    const mem = await addNote(note);
    fresh(res).json(mem);
  } catch (e) {
    fresh(res).status(500).json(err(e.message));
  }
});

app.post('/api/memory/console/tag', async (req, res) => {
  try {
    const { key, value } = req.body ?? {};
    if (!key) return fresh(res).status(400).json(err('Missing "key"'));
    const mem = await setTag(key, value);
    fresh(res).json(mem);
  } catch (e) {
    fresh(res).status(500).json(err(e.message));
  }
});

/* =======================================================================================
 * System power state (REST + SSE)
 * ======================================================================================= */
app.get('/api/system', (_req, res) => {
  const state = getSystemState();
  fresh(res).json(ok(state));
});

app.post('/api/system', (req, res) => {
  const { enabled } = req.body ?? {};
  const state = setSystemEnabled(Boolean(enabled), 'rest:post');
  fresh(res).json(ok(state));
});

app.get('/api/system/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const now = getSystemState();
  res.write(`event: system\ndata: ${JSON.stringify(now)}\n\n`);

  subscribe(res);
});

/* =======================================================================================
 * Server boot
 * ======================================================================================= */
const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
