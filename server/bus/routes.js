// server/bus/routes.js
import { Router } from 'express';
import { emitIncident } from './incidentBus.js';

const router = Router();

// Simple GET check
router.get('/', (_req, res) => {
  res.json({ ok: true, message: 'Incident Bus active' });
});

// POST /api/bus/event  — receive incidents from Tower Simulator
router.post('/event', (req, res) => {
  const evt = req.body;
  if (!evt || !evt.siteId) {
    res.status(400).json({ ok: false, error: 'Missing siteId or invalid event' });
    return;
  }

  evt.timestamp = evt.timestamp || new Date().toISOString();
  evt.type = evt.type || 'alarm';
  emitIncident(evt);
  res.json({ ok: true, received: evt });
});

export default router;
