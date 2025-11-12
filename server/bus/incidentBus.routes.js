// server/bus/incidentBus.routes.js
import { Router } from 'express';
import { getStatus, getRecentEvents, subscribe } from './incidentBus.js';

const router = Router();

// Quick snapshot
router.get('/', (_req, res) => {
  res.json({ ok: true, bus: getStatus(), recent: getRecentEvents().slice(-5) });
});

// SSE stream for live events
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  subscribe(res);
});

export default router;
