// server/agents/troubleshooting.routes.js
import { Router } from 'express';
import { troubleshootingAgent } from './troubleshooting.js';

const router = Router();

function fresh(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res;
}

// Snapshot
router.get('/', (_req, res) => {
  fresh(res).json({ ok: true, agent: troubleshootingAgent.summary });
});

// Controls
router.post('/start', (_req, res) => {
  const msg = troubleshootingAgent.start();
  fresh(res).json({ ok: true, message: msg, agent: troubleshootingAgent.summary });
});

router.post('/stop', (_req, res) => {
  const msg = troubleshootingAgent.stop();
  fresh(res).json({ ok: true, message: msg, agent: troubleshootingAgent.summary });
});

/**
 * Mitigate a site
 * Body:
 *   {
 *     "siteId": "NYNYNJ0836",
 *     "execute": true | false   // default true; false => dry-run (no actions)
 *   }
 */
router.post('/mitigate', async (req, res) => {
  const { siteId, execute = true } = req.body ?? {};
  if (!siteId) return fresh(res).status(400).json({ ok: false, error: 'Missing "siteId"' });

  try {
    // Dry-run mode: return a suggested action plan without executing anything.
    if (execute === false) {
      const plan = [
        { kind: 'check',   desc: `Read current mains/battery/RRU for ${siteId}` },
        { kind: 'mitigate',desc: 'If mains=OFF and battery < 40%, disable A2 to save power' },
        { kind: 'recover', desc: 'If mains restores, re-enable A2 after stability window and verify' }
      ];
      return fresh(res).json({ ok: true, mode: 'dry-run', siteId, plan, agent: troubleshootingAgent.summary });
    }

    // Execute mode
    const out = await troubleshootingAgent.mitigateSite(siteId);

    const softFails = new Set(['Agent not running', 'site_not_found', 'refresh_failed', 'site_not_found_after_power']);
    if (!out.ok) {
      const code = softFails.has(out.error) ? 409 : 500;
      return fresh(res).status(code).json(out);
    }

    return fresh(res).json({ ok: true, ...out, agent: troubleshootingAgent.summary });
  } catch (e) {
    return fresh(res).status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Logs (SSE)
router.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: [connected ${new Date().toISOString()}]\n\n`);
  const recent = troubleshootingAgent.logs.slice(-20);
  for (const line of recent) res.write(`data: ${line}\n\n`);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 30000);

  troubleshootingAgent.subscribers.add(res);
  req.on('close', () => {
    clearInterval(ping);
    troubleshootingAgent.subscribers.delete(res);
    try { res.end(); } catch {}
  });
});

export default router;
