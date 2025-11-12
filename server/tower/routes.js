// server/tower/routes.js
import { Router } from 'express';
import { getTowerSnapshot, subscribeTower } from './bridge.js';

const router = Router();

function fresh(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache'); res.setHeader('Expires', '0'); return res;
}

router.get('/state', async (_req, res) => {
  const snap = await getTowerSnapshot();
  if (!snap.ok) return fresh(res).status(503).json({ ok: false, error: 'tower unavailable' });
  return fresh(res).json(snap);
});

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  subscribeTower(res);
});

export default router;
