// server/routes/rca.routes.js
import { Router } from 'express';
import { rcaAgent } from '../agents/rca.js';

const router = Router();

function fresh(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res;
}

// Snapshot
router.get('/', (_req, res) => {
  fresh(res).json({ ok: true, agent: rcaAgent.summary });
});

// Controls
router.post('/start', (_req, res) => {
  const msg = rcaAgent.start();
  fresh(res).json({ ok: true, message: msg, agent: rcaAgent.summary });
});

router.post('/stop', (_req, res) => {
  const msg = rcaAgent.stop();
  fresh(res).json({ ok: true, message: msg, agent: rcaAgent.summary });
});

// Record RCA
// body: { siteId, cause, actions?: string[]|object[], resolution?: 'restored'|'mitigated'|'unknown'|... }
router.post('/record', async (req, res) => {
  const { siteId, cause, actions = [], resolution = 'unknown' } = req.body ?? {};
  if (!siteId) return fresh(res).status(400).json({ ok: false, error: 'Missing "siteId"' });

  const out = await rcaAgent.recordIncident({ siteId, cause, actions, resolution });
  return fresh(res).status(out.ok ? 200 : 409).json({ ...out, agent: rcaAgent.summary });
});

// Site summary
router.get('/summary/:siteId', (req, res) => {
  const { siteId } = req.params;
  fresh(res).json(rcaAgent.summaryForSite(siteId));
});

// Compose dispatch email for latest unresolved case
router.post('/dispatch-email/:siteId', async (req, res) => {
  const { siteId } = req.params;
  if (!siteId) return fresh(res).status(400).json({ ok: false, error: 'Missing "siteId"' });
  const out = await rcaAgent.composeDispatchEmail(siteId);
  if (!out.ok) return fresh(res).status(409).json(out);
  fresh(res).json({ ok: true, ...out, agent: rcaAgent.summary });
});

// Logs (SSE)
router.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: [connected ${new Date().toISOString()}]\n\n`);
  const recent = rcaAgent.logs.slice(-20);
  for (const line of recent) res.write(`data: ${line}\n\n`);

  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 30000);

  rcaAgent.subscribers.add(res);
  req.on('close', () => {
    clearInterval(ping);
    rcaAgent.subscribers.delete(res);
    try { res.end(); } catch {}
  });
});

export default router;
