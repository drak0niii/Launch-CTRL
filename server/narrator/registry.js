// server/narrator/registry.js
// Registry for all active console SSE-like stream connections
// Used by Narrator Engine, Supervisor, and Agents.

const activeTextStreams = new Set(); // plain-text chunked streams (console)
const activeSseStreams = new Set();  // SSE clients (UI narrator stream)

// Simple dedupe window to avoid narration spam
const lastNarrationByMsg = new Map(); // msg -> timestamp
const DEDUPE_MS = 60000; // suppress identical narration spam within this window

/**
 * Register a console stream response object.
 * Called when /api/console/stream opens.
 */
export function registerStream(res, opts = {}) {
  if (!res) return;
  const mode = opts.mode === 'sse' ? 'sse' : 'text';

  if (mode === 'sse') activeSseStreams.add(res);
  else activeTextStreams.add(res);

  // When client disconnects → remove the stream
  reqOnClose(res, () => {
    activeTextStreams.delete(res);
    activeSseStreams.delete(res);
  });
}

/**
 * Manually remove a stream.
 */
export function unregisterStream(res) {
  if (!res) return;
  activeTextStreams.delete(res);
  activeSseStreams.delete(res);
}

/**
 * Broadcast a narration message to every connected console stream.
 * The UI console will display it immediately.
 */
export function broadcastNarration(text = '') {
  if (!text) return;

  const payload = {
    msg: String(text),
    ts: new Date().toISOString(),
  };

  // Drop near-duplicate messages within a tight window
  const lastTs = lastNarrationByMsg.get(payload.msg);
  const now = Date.now();
  if (lastTs && (now - lastTs) < DEDUPE_MS) return;
  lastNarrationByMsg.set(payload.msg, now);

  // Plain text streams (console) get newline-delimited, timestamped lines
  const line = `[NARRATION ${payload.ts}] ${payload.msg}\n`;
  for (const res of activeTextStreams) {
    try { res.write(line); } catch (err) {
      console.warn('Narration broadcast failed for one text stream:', err.message);
    }
  }

  // SSE clients get structured events
  if (!activeSseStreams.size) return;
  const evt = `event: narration\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of activeSseStreams) {
    try { res.write(evt); } catch {}
  }
}

/**
 * Helper: attach close listener to response.
 */
function reqOnClose(res, cb) {
  if (typeof res.on === 'function') {
    res.on('close', cb);
    res.on('finish', cb);
    res.on('error', cb);
  }
}
