// server/supervisor/routes.js
import { Router } from 'express';
import {
  summary,
  start,
  stop,
  pause,
  resume,
  note,
  subscribeLogs,
  subscribeStream,
  // approvals API from store
  listApprovals,
  resolveApproval,
} from './store.js';
import { setAutoEnabled, getAutoStatus } from './pipeline.js';

const router = Router();

function fresh(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res;
}

/**
 * IMPORTANT:
 * Supervisor *orchestrates* agents while it is RUNNING.
 * Starting the Supervisor (`POST /api/supervisor/start`) engages the orchestrator
 * inside supervisor/store.js (A→B→C with policy + manual auto toggle).
 */

// Snapshot
router.get('/', (_req, res) => {
  fresh(res).json({ ok: true, supervisor: summary() });
});

// Snapshot stream (SSE)
router.get('/stream', (_req, res) => {
  subscribeStream(res);
});

// --- Auto-pipeline controls ---
// Status
router.get('/auto', (_req, res) => {
  fresh(res).json({ ok: true, auto: getAutoStatus(), supervisor: summary() });
});

// Toggle { enabled: boolean }
router.post('/auto', (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const out = setAutoEnabled(enabled);
  fresh(res).json({ ok: true, auto: out, supervisor: summary() });
});

// Controls
router.post('/start', (_req, res) => {
  const msg = start(); // engages orchestration in store.js
  fresh(res).json({ ok: true, message: msg, supervisor: summary() });
});

router.post('/stop', (_req, res) => {
  const msg = stop(); // disengages orchestration in store.js
  fresh(res).json({ ok: true, message: msg, supervisor: summary() });
});

router.post('/pause', (_req, res) => {
  const msg = pause();
  fresh(res).json({ ok: true, message: msg, supervisor: summary() });
});

router.post('/resume', (_req, res) => {
  const msg = resume();
  fresh(res).json({ ok: true, message: msg, supervisor: summary() });
});

// Notes from UI
router.post('/note', (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) return fresh(res).status(400).json({ ok: false, error: 'Missing "message"' });
  const out = note(message);
  fresh(res).json({ ok: true, message: out, supervisor: summary() });
});

// Logs (SSE)
router.get('/logs', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: [connected ${new Date().toISOString()}]\n\n`);
  subscribeLogs(res);
});

// ---- HITL Approvals ----

// List pending approvals
router.get('/approvals', (_req, res) => {
  const list = listApprovals();
  fresh(res).json({ ok: true, approvals: list, supervisor: summary() });
});

// Resolve an approval via generic decision payload { decision: "approved" | "rejected" }
router.post('/approvals/:id', (req, res) => {
  const id = String(req.params.id || '');
  const decision = String(req.body?.decision || '').toLowerCase();
  if (!id) return fresh(res).status(400).json({ ok: false, error: 'Missing approval id' });
  if (!['approved', 'rejected'].includes(decision)) {
    return fresh(res).status(400).json({ ok: false, error: 'decision must be "approved" or "rejected"' });
  }
  const item = resolveApproval(id, decision);
  if (!item) return fresh(res).status(404).json({ ok: false, error: 'Approval not found' });
  fresh(res).json({ ok: true, approval: item, supervisor: summary() });
});

// Convenience endpoints used by your console:
// POST /approvals/:id/approve
router.post('/approvals/:id/approve', (req, res) => {
  const id = String(req.params.id || '');
  if (!id) return fresh(res).status(400).json({ ok: false, error: 'Missing approval id' });
  const item = resolveApproval(id, 'approved');
  if (!item) return fresh(res).status(404).json({ ok: false, error: 'Approval not found' });
  fresh(res).json({ ok: true, approval: item, supervisor: summary() });
});

// POST /approvals/:id/reject
router.post('/approvals/:id/reject', (req, res) => {
  const id = String(req.params.id || '');
  if (!id) return fresh(res).status(400).json({ ok: false, error: 'Missing approval id' });
  const item = resolveApproval(id, 'rejected');
  if (!item) return fresh(res).status(404).json({ ok: false, error: 'Approval not found' });
  fresh(res).json({ ok: true, approval: item, supervisor: summary() });
});

export default router;
