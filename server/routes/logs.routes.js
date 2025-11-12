// server/routes/logs.routes.js
import { Router } from 'express';
import { subscribe as subscribeBus, getRecentEvents } from '../bus/incidentBus.js';
import { subscribeLogs as supSubscribeLogs } from '../supervisor/store.js';
import { correlationAgent } from '../agents/correlationAgent.js';
import { troubleshootingAgent } from '../agents/troubleshooting.js';
import { rcaAgent } from '../agents/rca.js';

const router = Router();

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

function noCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res;
}

/* ----------------------------------------------------------------------------
 * HELP / INDEX
 * ------------------------------------------------------------------------- */
router.get('/', (_req, res) => {
  noCache(res).json({
    ok: true,
    endpoints: {
      sse: {
        supervisor: '/api/logs/supervisor',
        bus: '/api/logs/bus',
        agentCorrelation: '/api/logs/agent/correlation',
        agentTroubleshooting: '/api/logs/agent/troubleshooting',
        agentRca: '/api/logs/agent/rca',
        multiplexAll: '/api/logs/all',
      },
      json: {
        recentBusEvents: '/api/logs/bus/recent',
      },
    },
  });
});

/* ----------------------------------------------------------------------------
 * JSON: recent bus events (quick checks / UIs)
 * ------------------------------------------------------------------------- */
router.get('/bus/recent', (_req, res) => {
  noCache(res).json({ ok: true, events: getRecentEvents() });
});

/* ----------------------------------------------------------------------------
 * SSE: single-source streams
 * ------------------------------------------------------------------------- */

// Supervisor logs (raw)
router.get('/supervisor', (_req, res) => {
  sseHeaders(res);
  res.write(`data: [connected ${new Date().toISOString()}]\n\n`);
  supSubscribeLogs(res); // cleanup handled inside supervisor/store.js
});

// Bus events (raw)
router.get('/bus', (req, res) => {
  sseHeaders(res);
  res.write(`data: [connected ${new Date().toISOString()}]\n\n`);
  subscribeBus(res); // incidentBus handles initial replay + cleanup
});

// Agent logs (raw): correlation|troubleshooting|rca
router.get('/agent/:name', (req, res) => {
  const name = String(req.params.name || '').toLowerCase();
  const map = {
    correlation: correlationAgent,
    troubleshooting: troubleshootingAgent,
    rca: rcaAgent,
  };
  const agent = map[name];
  if (!agent) {
    return noCache(res)
      .status(404)
      .json({ ok: false, error: 'Unknown agent. Use correlation|troubleshooting|rca' });
  }

  sseHeaders(res);
  res.write(`data: [connected ${new Date().toISOString()}]\n\n`);

  // send recent lines
  (agent.logs || []).slice(-20).forEach((l) => res.write(`data: ${l}\n\n`));

  // keep-alive ping
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 30000);

  agent.subscribers.add(res);
  req.on('close', () => {
    clearInterval(ping);
    agent.subscribers.delete(res);
    try { res.end(); } catch {}
  });
});

/* ----------------------------------------------------------------------------
 * SSE: multiplexed "everything" stream
 * Tags each line with an "event" so clients can split by origin.
 * ------------------------------------------------------------------------- */
router.get('/all', (req, res) => {
  sseHeaders(res);
  const now = new Date().toISOString();
  res.write(`data: [connected ${now}]\n\n`);

  // --- Wrap a generic SSE writer so we can tag lines by source
  const makeTaggedWriter = (label) => ({
    write: (chunk) => {
      try {
        // source streams typically write "data: <payload>\n\n"
        const s = chunk.toString().replace(/^data:\s*/i, '').trim();
        if (!s) return;
        res.write(`event: ${label}\ndata: ${s}\n\n`);
      } catch {}
    },
    on: (ev, fn) => {
      if (ev === 'close') req.on('close', fn);
    },
  });

  // --- Supervisor (tagged)
  const supProxy = makeTaggedWriter('supervisor');
  supSubscribeLogs(supProxy);

  // --- Bus (tagged)
  const busProxy = makeTaggedWriter('bus');
  subscribeBus(busProxy);

  // --- Agents (tagged)
  function attachAgent(agent, label) {
    // Flush a few recent lines (stringify to be safe for spaces)
    (agent.logs || [])
      .slice(-10)
      .forEach((l) => res.write(`event: ${label}\ndata: ${JSON.stringify(l)}\n\n`));

    const wrapped = {
      write: (chunk) => {
        try {
          const s = chunk.toString().replace(/^data:\s*/i, '').trim();
          if (!s) return;
          res.write(`event: ${label}\ndata: ${JSON.stringify(s)}\n\n`);
        } catch {}
      },
      on: (ev, fn) => {
        if (ev === 'close') req.on('close', fn);
      },
    };

    agent.subscribers.add(wrapped);
    return () => agent.subscribers.delete(wrapped);
  }

  const detachCorr = attachAgent(correlationAgent, 'agent.correlation');
  const detachTrou = attachAgent(troubleshootingAgent, 'agent.troubleshooting');
  const detachRca  = attachAgent(rcaAgent, 'agent.rca');

  // keep-alive ping for the multiplex stream
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 30000);

  req.on('close', () => {
    clearInterval(ping);
    try { detachCorr(); detachTrou(); detachRca(); } catch {}
    try { res.end(); } catch {}
  });
});

export default router;
