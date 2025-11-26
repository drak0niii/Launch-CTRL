// server/routes/narrator.routes.js
import express from 'express';
import { registerStream } from '../narrator/registry.js';

const router = express.Router();

/**
 * SSE stream for real-time narration.
 * Emits events when broadcastNarration(message) is called.
 */
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Register this client in the narrator registry (SSE mode)
  registerStream(res, { mode: 'sse' });

  res.write(`event: narration\ndata: ${JSON.stringify({ ok: true, msg: "narrator connected", ts: new Date().toISOString() })}\n\n`);

  req.on('close', () => {
    try { res.end(); } catch {}
  });
});

export default router;
