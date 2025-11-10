// server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { getSystemState, setSystemEnabled, subscribe } from './system/state.js';

// Memory helpers (unchanged)
import {
  loadConsoleMemory,
  appendMessage,
  addNote,
  setTag,
  resetConsoleMemory,
  getRecentConsoleMessages,     // ⬅️ NEW: expose recent transcript for LLM tool
} from './memory/storage.js';

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* =======================================================================================
 * Small helpers for uniform, fresh JSON
 * =======================================================================================
 */
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

// --- health ping ---
app.get('/health', (_req, res) => {
  fresh(res).json(ok());
});

/* =======================================================================================
 * Helpers
 * =======================================================================================
 */

// Minimal regex safety net (kept; LLM should handle most cases)
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

/**
 * Intent classifier tailored to the dashboard assistant.
 * Adds `system_query` so the LLM can understand questions like:
 *  - "is the system online?", "uptime", "history", etc.
 */
async function classifyIntentLLM(prompt) {
  const sys = `
You are the intent brain for a dashboard command console. Classify the user's line into a console intent.

Return ONLY a JSON object (no prose) in exactly one of these shapes (no extra keys):
{"intent":"system_power","action":"on"|"off"}
{"intent":"system_query","aspect":"status"|"count_on"|"count_off"|"version"|"last_updated"|"history"|"uptime"|"uptime_minutes"}
{"intent":"toggle_connections","action":"on"|"off"|"toggle"}
{"intent":"console_panel","action":"expand"|"collapse"}
{"intent":"none"}

Rules:
- If the user asks about uptime/for how long it's been up (including “uptime in minutes”), classify as:
  - {"intent":"system_query","aspect":"uptime"} or {"intent":"system_query","aspect":"uptime_minutes"}.
- Do NOT classify uptime questions as "status".
- If they ask for current online/offline state, classify as {"intent":"system_query","aspect":"status"}.
- Only classify "system_power" when they're clearly asking to change state (turn on/off, power up/down, start/stop).
- Be robust to typos, synonyms, and indirect phrasing.

MAPPING EXAMPLES
// Queries
"is the system online?"                      -> {"intent":"system_query","aspect":"status"}
"what's the system status?"                  -> {"intent":"system_query","aspect":"status"}
"are we up?"                                 -> {"intent":"system_query","aspect":"status"}
"how many times did I turn it on?"           -> {"intent":"system_query","aspect":"count_on"}
"how many times off?"                        -> {"intent":"system_query","aspect":"count_off"}
"what version is the system state?"          -> {"intent":"system_query","aspect":"version"}
"when was the last change?"                  -> {"intent":"system_query","aspect":"last_updated"}
"show history"                               -> {"intent":"system_query","aspect":"history"}

// Uptime-specific (must NOT map to status)
"what is the uptime?"                        -> {"intent":"system_query","aspect":"uptime"}
"for how long has it been up?"               -> {"intent":"system_query","aspect":"uptime"}
"uptime in minutes"                          -> {"intent":"system_query","aspect":"uptime_minutes"}
"give me the dashboard uptime"               -> {"intent":"system_query","aspect":"uptime"}
"how long online since last start?"          -> {"intent":"system_query","aspect":"uptime"}

// Controls
"power it down"                              -> {"intent":"system_power","action":"off"}
"turn system offline"                        -> {"intent":"system_power","action":"off"}
"bring it back online"                       -> {"intent":"system_power","action":"on"}
"start the system"                           -> {"intent":"system_power","action":"on"}
"show connections"                           -> {"intent":"toggle_connections","action":"on"}
"hide connections"                           -> {"intent":"toggle_connections","action":"off"}
"toggle links"                               -> {"intent":"toggle_connections","action":"toggle"}
"expand console"                             -> {"intent":"console_panel","action":"expand"}
"minimize console"                           -> {"intent":"console_panel","action":"collapse"}

If the line is a greeting, a general question, or unclear, return {"intent":"none"}.
`.trim();

  try {
    const cmp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },

        // A few concise anchors to minimize drift
        { role: 'user', content: 'what is the uptime?' },
        { role: 'assistant', content: '{"intent":"system_query","aspect":"uptime"}' },

        { role: 'user', content: 'uptime in minutes' },
        { role: 'assistant', content: '{"intent":"system_query","aspect":"uptime_minutes"}' },

        { role: 'user', content: 'is the system online?' },
        { role: 'assistant', content: '{"intent":"system_query","aspect":"status"}' },

        { role: 'user', content: 'power it down' },
        { role: 'assistant', content: '{"intent":"system_power","action":"off"}' },

        // Real query
        { role: 'user', content: String(prompt) },
      ],
    });

    const raw = cmp.choices?.[0]?.message?.content?.trim() || '{}';
    const text = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const data = JSON.parse(text);
    if (data && typeof data === 'object' && data.intent) return data;
  } catch {
    // fall through to regex (for power only)
  }
  return { intent: 'none' };
}

// Build a short preamble from memory
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

/* -------------------- Authoritative snapshot helpers -------------------- */
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
  const s = getSystemState(); // { enabled, version, updatedAt, counts, history, uptimeSeconds, ... }
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
      return s.enabled
        ? `Uptime: ${mins} minute(s).`
        : `The system is Offline ⛔. Uptime is 0 minutes while offline.`;
    }
    default:
      return `The system is ${s.enabled ? 'Online ✅' : 'Offline ⛔'} (v${s.version}, updated ${s.updatedAt}).`;
  }
}

/* -------------------- LLM Tools: let the model fetch live state + transcript -------------------- */
const LLM_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_system_state', // ✅ valid: only letters/numbers/_/-
      description:
        'Return the authoritative live system state (enabled, version, updatedAt, lastOnAt, lastOffAt, uptimeSeconds, counts, history[≤200]).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_console_messages', // ✅ valid
      description:
        'Return a slice of the recent console transcript so you can compute conversation stats. Each item: { role, content, timestamp }. Use to answer questions like how many times the user greeted, what they said, etc.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 500,
            description: 'Max number of recent messages to return. Default 200.',
          },
        },
        additionalProperties: false,
      },
    },
  },
];

/**
 * Two-pass tool runner:
 *  - Pass 1: let the model decide whether to call one or more tools
 *  - We execute the calls and return Pass 2 with tool outputs for a grounded answer
 */
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

  if (!calls.length) {
    return assistantMsg?.content ?? '';
  }

  const toolMessages = [];
  for (const call of calls) {
    const toolName = call.function?.name;
    const rawArgs = call.function?.arguments;

    try {
      if (toolName === 'get_system_state') {
        const state = getSystemState();
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(state),
        });
      } else if (toolName === 'get_console_messages') {
        let limit = 200;
        if (rawArgs) {
          try {
            const parsed = JSON.parse(rawArgs);
            if (Number.isInteger(parsed?.limit) && parsed.limit >= 1 && parsed.limit <= 500) {
              limit = parsed.limit;
            }
          } catch { /* ignore parse errors; use default */ }
        }
        const msgs = await getRecentConsoleMessages(limit);
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ messages: msgs }),
        });
      }
    } catch (e) {
      // Return a structured tool error so the model can gracefully handle it
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({ error: String(e?.message || e || 'tool_error') }),
      });
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
 * Command Console endpoints (PERSISTENT MEMORY + SEMANTIC INTENT ROUTING)
 * =======================================================================================
 */

// Non-streaming (executes side-effects immediately for console intents)
app.post('/api/console', async (req, res) => {
  try {
    const { prompt, system } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string') {
      return fresh(res).status(400).json(err('Missing "prompt" string'));
    }

    await appendMessage('user', prompt);

    // 1) Semantic classification
    let intentData = await classifyIntentLLM(prompt);

    // 2) Regex fallback only for system power if LLM abstains
    if (!intentData || intentData.intent === 'none') {
      const fb = parseSystemIntent(prompt);
      if (fb.match) intentData = { intent: fb.intent, action: fb.action };
    }

    // 3A) Execute console control intents
    if (intentData.intent === 'system_power') {
      const enabled = intentData.action === 'on';
      const state = setSystemEnabled(enabled, 'console:llm');
      const sideEffect = {
        systemEnabled: state.enabled,
        version: state.version,
        updatedAt: state.updatedAt,
      };
      const ack = state.enabled ? '✅ System enabled (Online).' : '⛔ System disabled (Offline).';
      await appendMessage('assistant', ack);
      return fresh(res).json(ok({ text: ack, sideEffect }));
    }
    if (intentData.intent === 'toggle_connections') {
      const sideEffect = { toggleConnections: intentData.action };
      const ack =
        sideEffect.toggleConnections === 'on'
          ? '👁️ Connections shown.'
          : sideEffect.toggleConnections === 'off'
            ? '🙈 Connections hidden.'
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

    // 3B) System query — authoritative, no LLM text generation needed
    if (intentData.intent === 'system_query') {
      const text = formatSystemQuery(intentData.aspect);
      await appendMessage('assistant', text);
      return fresh(res).json(ok({ text }));
    }

    /* 4) No console intent → normal assistant reply (with LIVE snapshot + tools) */
    const dashboardEnabledHdr = req.get('X-Dashboard-Enabled');
    const sysLine = buildSystemSnapshotLine(getSystemState(), {
      dashboardEnabled: dashboardEnabledHdr === undefined ? undefined : dashboardEnabledHdr === 'true',
    });

    const mem = await loadConsoleMemory();
    const memoryPreamble = buildMemoryPreamble(mem);
    const RECENT_K = 20;
    const recent = (mem.messages ?? []).slice(-RECENT_K).map((m) => ({ role: m.role, content: m.content }));

    // Strong steering to use tools for facts & transcript stats
    const sysGuard = [
      'You are the Command Console Assistant for Launch CTRL.',
      'If the user asks about system status, uptime, counts (on/off), version, last update, or history, ' +
        'you MUST call get_system_state and base your answer on its output.',
      'If the user asks about conversation statistics, greetings, or what they said previously, ' +
        'you MUST call get_console_messages and compute the answer from that transcript.',
      'Do not guess numeric values; always use tool output.',
    ].join(' ');

    const text = await runLLMWithTools([
      { role: 'system', content: sysGuard },
      { role: 'system', content: sysLine },              // hint; tool provides truth
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

// Streaming route (emits [[SIDE_EFFECT]] first for console intents)
app.post('/api/console/stream', async (req, res) => {
  try {
    const { prompt, system } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string') {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Missing "prompt" string');
    }

    // streaming headers
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    req.setTimeout(0);
    res.write('');

    await appendMessage('user', prompt);

    // 1) Semantic classification
    let intentData = await classifyIntentLLM(prompt);

    // 2) Regex fallback (system power only)
    if (!intentData || intentData.intent === 'none') {
      const fb = parseSystemIntent(prompt);
      if (fb.match) intentData = { intent: fb.intent, action: fb.action };
    }

    // 3A) Execute control intents with an immediate side-effect line
    if (intentData.intent === 'system_power') {
      const enabled = intentData.action === 'on';
      const state = setSystemEnabled(enabled, 'console:stream');
      const sideEffect = {
        systemEnabled: state.enabled,
        version: state.version,
        updatedAt: state.updatedAt,
      };
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
        sideEffect.toggleConnections === 'on'
          ? '👁️ Connections shown.'
          : sideEffect.toggleConnections === 'off'
            ? '🙈 Connections hidden.'
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

    // 3B) System query — authoritative one-shot text (fast path)
    if (intentData.intent === 'system_query') {
      const text = formatSystemQuery(intentData.aspect);
      res.write(text);
      await appendMessage('assistant', text);
      return res.end();
    }

    /* 4) No console intent → tool-enabled answer (single chunk write) */
    const dashboardEnabledHdr = req.get('X-Dashboard-Enabled');
    const sysLine = buildSystemSnapshotLine(getSystemState(), {
      dashboardEnabled: dashboardEnabledHdr === undefined ? undefined : dashboardEnabledHdr === 'true',
    });

    const mem = await loadConsoleMemory();
    const memoryPreamble = buildMemoryPreamble(mem);
    const RECENT_K = 20;
    const recent = (mem.messages ?? []).slice(-RECENT_K).map((m) => ({ role: m.role, content: m.content }));

    const sysGuard = [
      'You are the Command Console Assistant for Launch CTRL.',
      'If the user asks about system status, uptime, counts (on/off), version, last update, or history, ' +
        'you MUST call get_system_state and base your answer on its output.',
      'If the user asks about conversation statistics, greetings, or what they said previously, ' +
        'you MUST call get_console_messages and compute the answer from that transcript.',
      'Do not guess numeric values; always use tool output.',
    ].join(' ');

    const text = await runLLMWithTools([
      { role: 'system', content: sysGuard },
      { role: 'system', content: sysLine },              // hint, but tools give truth
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
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    try { res.write(`[error] ${err0.message || 'Server error'}`); } catch {}
    return res.end();
  }
});

/* =======================================================================================
 * Memory utility routes
 * =======================================================================================
 */
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
 * =======================================================================================
 */
app.get('/api/system', (_req, res) => {
  const state = getSystemState(); // { enabled, version, updatedAt, counts, history, uptimeSeconds, ... }
  fresh(res).json(ok(state));
});

app.post('/api/system', (req, res) => {
  const { enabled } = req.body ?? {};
  const state = setSystemEnabled(Boolean(enabled), 'rest:post'); // { enabled, version, updatedAt, counts, ... }
  fresh(res).json(ok(state));
});

// Live system state via SSE
app.get('/api/system/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // send current state immediately as a named event ("system") for parity with broadcast()
  const now = getSystemState();
  res.write(`event: system\ndata: ${JSON.stringify(now)}\n\n`);

  subscribe(res);
});

/* =======================================================================================
 * Correlation Agent backend (unchanged)
 * =======================================================================================
 */
class CorrelationAgent {
  constructor(name = 'Agent A') {
    this.name = name;
    this.status = 'stopped';            // 'idle' | 'running' | 'stopped'
    this.delegation = 'disabled';       // 'enabled' | 'disabled'
    this.startedAt = null;              // Date | null
    this.runtimeSec = 0;                // accumulates across runs
    this.tasks = 47;                    // seed to match your UI
    this.lastTask = null;
    this.logs = [];                     // string[]
    this.subscribers = new Set();       // SSE clients
  }

  _log(msg) {
    const line = `[${new Date().toISOString()}] [${this.name}] ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 2000) this.logs.shift();
    for (const res of this.subscribers) {
      try { res.write(`data: ${line}\n\n`); } catch {}
    }
  }

  get summary() {
    const live = this.startedAt ? Math.floor((Date.now() - this.startedAt.getTime()) / 1000) : 0;
    return {
      name: this.name,
      status: this.status === 'running' ? 'Active' : (this.status === 'stopped' ? 'Stopped' : 'Idle'),
      delegation: this.delegation === 'enabled' ? 'Enabled' : 'Disabled',
      runtimeSec: this.runtimeSec + live,
      tasks: this.tasks,
      lastTask: this.lastTask,
    };
  }

  start() {
    if (this.status === 'running') return 'Already running';
    this.status = 'running';
    this.startedAt = new Date();
    this._log('started');
    return 'OK: started';
  }

  stop() {
    if (this.status !== 'running') {
      this.status = 'stopped';
      this._log('stopped (no-op)');
      return 'OK: stopped';
    }
    const delta = Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
    this.runtimeSec += delta;
    this.startedAt = null;
    this.status = 'stopped';
    this._log(`stopped (accumulated ${delta}s)`);
    return 'OK: stopped';
  }

  setDelegation(enabled) {
    this.delegation = enabled ? 'enabled' : 'disabled';
    this._log(`delegation ${this.delegation}`);
    return `OK: delegation ${this.delegation}`;
  }

  // Deterministic correlation baseline (5-min window by siteId)
  correlate(events = []) {
    const bySite = new Map();
    for (const e of events) {
      const key = e.siteId ?? 'unknown';
      if (!bySite.has(key)) bySite.set(key, []);
      bySite.get(key).push(e);
    }
    const incidents = [];
    for (const [site, list] of bySite.entries()) {
      list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      let cur = { siteId: site, start: null, end: null, count: 0, types: new Set(), events: [] };
      const PUSH = () => {
        incidents.push({
          siteId: cur.siteId,
          start: cur.start,
          end: cur.end,
          count: cur.count,
          types: [...cur.types],
          events: cur.events,
        });
      };
      const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
      for (const ev of list) {
        const t = new Date(ev.timestamp).getTime();
        if (!cur.start) {
          cur.start = ev.timestamp;
          cur.end = ev.timestamp;
          cur.count = 1;
          cur.types.add(ev.type);
          cur.events.push(ev);
          continue;
        }
        const last = new Date(cur.end).getTime();
        if (t - last <= WINDOW_MS) {
          cur.end = ev.timestamp;
          cur.count++;
          cur.types.add(ev.type);
          cur.events.push(ev);
        } else {
          PUSH();
          cur = { siteId: site, start: ev.timestamp, end: ev.timestamp, count: 1, types: new Set([ev.type]), events: [ev] };
        }
      }
      if (cur.count > 0) PUSH();
    }

    this.lastTask = `correlated ${events.length} events → ${incidents.length} incidents`;
    this.tasks += 1;
    this._log(this.lastTask);
    return { incidents };
  }
}

const correlationAgent = new CorrelationAgent('Agent A');

// --- Correlation Agent routes ---
app.get('/api/agents/correlation', (_req, res) => {
  return fresh(res).json(ok({ agent: correlationAgent.summary }));
});

app.post('/api/agents/correlation/start', (_req, res) => {
  const out = correlationAgent.start();
  return fresh(res).json(ok({ message: out, agent: correlationAgent.summary }));
});

app.post('/api/agents/correlation/stop', (_req, res) => {
  const out = correlationAgent.stop();
  return fresh(res).json(ok({ message: out, agent: correlationAgent.summary }));
});

app.post('/api/agents/correlation/delegation', (req, res) => {
  const { enabled } = req.body ?? {};
  const out = correlationAgent.setDelegation(Boolean(enabled));
  return fresh(res).json(ok({ message: out, agent: correlationAgent.summary }));
});

app.post('/api/agents/correlation/correlate', (req, res) => {
  const { events } = req.body ?? {};
  if (!Array.isArray(events)) {
    return fresh(res).status(400).json(err('Body must include array "events"'));
  }
  if (correlationAgent.status !== 'running') {
    return fresh(res).status(409).json(err('Agent not running'));
  }
  const result = correlationAgent.correlate(events);
  return fresh(res).json(ok({ result, agent: correlationAgent.summary }));
});

app.get('/api/agents/correlation/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: [connected ${new Date().toISOString()}]\n\n`);
  const recent = correlationAgent.logs.slice(-20);
  for (const line of recent) res.write(`data: ${line}\n\n`);

  correlationAgent.subscribers.add(res);
  req.on('close', () => {
    correlationAgent.subscribers.delete(res);
    try { res.end(); } catch {}
  });
});

/* =======================================================================================
 * Server boot
 * =======================================================================================
 */
const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));