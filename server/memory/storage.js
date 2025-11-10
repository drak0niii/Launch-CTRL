// server/memory/storage.js
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Change this name if you want different memories per agent/console
const MEM_DIR = path.join(__dirname);
const DEFAULT_FILE = path.join(MEM_DIR, 'console.json');

async function ensureDir() {
  try { await fs.mkdir(MEM_DIR, { recursive: true }); } catch {}
}

function nowISO() {
  return new Date().toISOString();
}

function emptyMemory() {
  const now = nowISO();
  return {
    id: 'command-console',
    createdAt: now,
    updatedAt: now,
    // free-form human notes you want the LLM to always see
    notes: [
      'Agent A = Correlation Agent',
      'Agent B = Troubleshooting Agent',
      'Agent C = Dispatch Agent',
      'Delegation must remain disabled for Agent A by policy.',
    ],
    // structured key/value memory (system facts, flags, configurations)
    tags: {
      delegationPolicyAgentA: 'disabled',
      systemName: 'Launch CTRL',
    },
    // rolling conversation memory (trimmed automatically)
    // [{ role: 'user'|'assistant'|'system', content: string, timestamp: ISOString, ts?: ISOString }]
    messages: [],
    // optional compact summaries you can maintain over time
    summaries: [], // [{ timestamp: ISOString, content: string }]
  };
}

export async function loadConsoleMemory() {
  await ensureDir();
  try {
    const raw = await fs.readFile(DEFAULT_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return data;
  } catch {
    const fresh = emptyMemory();
    await fs.writeFile(DEFAULT_FILE, JSON.stringify(fresh, null, 2), 'utf-8');
    return fresh;
  }
}

export async function saveConsoleMemory(mem) {
  mem.updatedAt = nowISO();
  await ensureDir();
  await fs.writeFile(DEFAULT_FILE, JSON.stringify(mem, null, 2), 'utf-8');
}

/**
 * Append a message to the rolling transcript.
 * - Ensures canonical `timestamp` (keeps legacy `ts` for back-compat).
 * - Trims to the last MAX_MSG to bound file size.
 */
export async function appendMessage(role, content) {
  const mem = await loadConsoleMemory();

  // Normalize role/content
  const safeRole = typeof role === 'string' ? role : 'system';
  const safeContent = typeof content === 'string' ? content : String(content ?? '');

  const stamp = nowISO();
  mem.messages.push({
    role: safeRole,
    content: safeContent,
    timestamp: stamp,     // ← canonical going forward
    ts: stamp,            // ← keep legacy field so older readers don't break
  });

  // trim to last N messages to keep file small
  const MAX_MSG = 200;
  if (mem.messages.length > MAX_MSG) {
    mem.messages = mem.messages.slice(-MAX_MSG);
  }

  await saveConsoleMemory(mem);
  return mem;
}

export async function addNote(note) {
  const mem = await loadConsoleMemory();
  mem.notes.push(note);
  await saveConsoleMemory(mem);
  return mem;
}

export async function setTag(key, value) {
  const mem = await loadConsoleMemory();
  mem.tags[key] = value;
  await saveConsoleMemory(mem);
  return mem;
}

export async function resetConsoleMemory() {
  const fresh = emptyMemory();
  await saveConsoleMemory(fresh);
  return fresh;
}

/**
 * Returns a lightweight slice of recent messages for LLM tools.
 * Each item has: { role, content, timestamp }
 * - `timestamp` is taken from `timestamp` if present, else legacy `ts`, else null.
 * - `limit` is clamped to [1, 500].
 */
export async function getRecentConsoleMessages(limit = 200) {
  const mem = await loadConsoleMemory();
  const all = Array.isArray(mem?.messages) ? mem.messages : [];

  const clamped = Math.min(Math.max(1, limit), 500);
  const slice = all.slice(-clamped);

  return slice.map(m => ({
    role: typeof m.role === 'string' ? m.role : 'system',
    content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
    timestamp: m.timestamp || m.ts || null,
  }));
}