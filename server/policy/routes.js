// server/policy/routes.js
import { Router } from 'express';
import { getPolicy, setPolicy, addSubscriber } from './store.js';

const router = Router();

// GET current policy
router.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json(getPolicy());
});

// POST partial update { alarmPrioritization?, waysOfWorking?, kpiAlignment? }
router.post('/', (req, res) => {
  try {
    const patch = req.body ?? {};
    const next = setPolicy(patch, 'rest:post');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json(next);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// SSE stream of policy changes
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // send current policy immediately
  res.write(`event: policy\ndata: ${JSON.stringify(getPolicy())}\n\n`);

  addSubscriber(res);
});

export default router;
