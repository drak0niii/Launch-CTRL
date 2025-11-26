// server/routes/system.js
// System control routes + narration for Command Console

import express from 'express';
import { start, stop, pause, resume, summary } from '../supervisor/store.js';
import { broadcastNarration } from '../narrator/registry.js';
import { appendMessage } from '../memory/storage.js';
import {
  subscribeSystemStream,
  unsubscribeSystemStream,
  getSystemStateSnapshot
} from '../system/state.js';

export const router = express.Router();

/**
 * Helper: narrate + persist to console memory.
 */
async function narrate(text) {
  try {
    broadcastNarration(text);
    await appendMessage("assistant", text);
  } catch (e) {
    console.error("[narration.error]", e);
  }
}

/**
 * /api/system/status
 * Returns live snapshot. No narration.
 */
router.get('/status', (req, res) => {
  try {
    const snap = summary();
    return res.json(snap);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * NEW:
 * /api/system/stream
 * SSE endpoint for frontend Command Console.
 */
router.get('/stream', (req, res) => {
  // --- 1. Headers ---
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // --- 2. Helper to push events ---
  const push = (evt) => {
    res.write(`event: system\n`);
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  };

  // --- 3. Send initial snapshot ---
  push({
    type: "snapshot",
    ts: new Date().toISOString(),
    state: getSystemStateSnapshot()
  });

  // --- 4. Register subscriber ---
  const subscriber = (evt) => {
    push(evt);
  };
  subscribeSystemStream(subscriber);

  // --- 5. Clean up ---
  req.on('close', () => {
    unsubscribeSystemStream(subscriber);
  });
});

/**
 * /api/system/start
 */
router.post('/start', async (req, res) => {
  try {
    const out = await start();
    await narrate("System is powering on. Supervisor is now active and monitoring events.");
    return res.json({ ok: true, message: out });
  } catch (e) {
    await narrate("Failed to start the system. Something unexpected occurred, and supervision could not begin.");
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * /api/system/stop
 */
router.post('/stop', async (req, res) => {
  try {
    const out = await stop();
    await narrate("System shutdown complete. Supervisor and agents are now offline.");
    return res.json({ ok: true, message: out });
  } catch (e) {
    await narrate("Unable to shut down the system properly. A fault occurred during the stop procedure.");
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * /api/system/pause
 */
router.post('/pause', async (req, res) => {
  try {
    const out = await pause();
    await narrate("Supervisor has paused operations. Automated actions are temporarily halted.");
    return res.json({ ok: true, message: out });
  } catch (e) {
    await narrate("The system was unable to pause supervision. Something went wrong.");
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * /api/system/resume
 */
router.post('/resume', async (req, res) => {
  try {
    const out = await resume();
    await narrate("Supervisor has resumed duties and is monitoring the network again.");
    return res.json({ ok: true, message: out });
  } catch (e) {
    await narrate("Failed to resume supervisor operations. The system may require attention.");
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * /api/system/restart
 */
router.post('/restart', async (req, res) => {
  try {
    await stop();
    await narrate("Restarting system… shutting down components.");
    await start();
    await narrate("System has restarted successfully and supervision has resumed.");
    return res.json({ ok: true, message: "Restarted" });
  } catch (e) {
    await narrate("System restart failed. Manual intervention may be required.");
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
