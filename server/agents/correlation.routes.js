// server/agents/correlation.routes.js
import { Router } from 'express';
import { correlationAgent } from './correlationAgent.js';

// Lazy-load supervisor note() to avoid circular import
async function supervisorNoteLazy(text) {
  try {
    const mod = await import('../supervisor/store.js');
    return mod?.note?.(String(text || ''));
  } catch {
    return null;
  }
}

const router = Router();

function fresh(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res;
}

// Snapshot
router.get('/', (_req, res) => {
  fresh(res).json({ ok: true, agent: correlationAgent.summary });
});

// Controls
router.post('/start', (_req, res) => {
  const msg = correlationAgent.start();
  fresh(res).json({ ok: true, message: msg, agent: correlationAgent.summary });
});

router.post('/stop', (_req, res) => {
  const msg = correlationAgent.stop();
  fresh(res).json({ ok: true, message: msg, agent: correlationAgent.summary });
});

// Delegation is policy-locked disabled; expose as a no-op for consistency
router.post('/delegation', (_req, res) => {
  const msg = correlationAgent.setDelegation(false);
  fresh(res).json({ ok: true, message: msg, agent: correlationAgent.summary });
});

// Batch correlate (optional helper for tests/tools)
router.post('/correlate', async (req, res) => {
  const { events } = req.body ?? {};
  if (!Array.isArray(events)) {
    return fresh(res).status(400).json({ ok: false, error: 'Body must include array "events"' });
  }
  if (correlationAgent.status !== 'running') {
    return fresh(res).status(409).json({ ok: false, error: 'Agent not running' });
  }

  const result = correlationAgent.correlate(events);
  const clusters = result?.incidents?.length ?? 0;

  // Brief signal to Supervisor (so it can decide to trigger Agent B)
  await supervisorNoteLazy(`Correlation: ${clusters} incident(s) detected from ${events.length} event(s).`);

  fresh(res).json({ ok: true, result, agent: correlationAgent.summary });
});

// Logs (SSE)
router.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: [connected ${new Date().toISOString()}]\n\n`);
  correlationAgent.subscribeLogs(res);
});

export default router;
