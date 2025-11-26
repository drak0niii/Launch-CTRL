// server/memory/incidents.js
// Persistent incident lifecycle storage (Option B – Full persistence)

import fs from 'fs';
import path from 'path';

const FILE_PATH = path.resolve(process.cwd(), 'server/memory/incidents.json');

// -----------------------------
// Load existing or bootstrap
// -----------------------------
let incidents = { sites: {} };

try {
  if (fs.existsSync(FILE_PATH)) {
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === 'object') {
      incidents = parsed;
    }
  }
} catch (err) {
  console.error('[INCIDENT_MEMORY] Failed to load incidents.json:', err);
}

// Ensure correct schema
if (!incidents.sites || typeof incidents.sites !== 'object') {
  incidents.sites = {};
}

// ----------------------------------
// Utility: save to disk (sync-safe)
// ----------------------------------
function persist() {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(incidents, null, 2), 'utf8');
  } catch (err) {
    console.error('[INCIDENT_MEMORY] Failed to write incidents.json:', err);
  }
}

// ----------------------------------
// Ensure site structure exists
// ----------------------------------
function ensureSite(siteId) {
  if (!incidents.sites[siteId]) {
    incidents.sites[siteId] = {
      history: [],         // Array of lifecycle events
      activeIncident: null // Object or null
    };
  }
  return incidents.sites[siteId];
}

// ----------------------------------
// Record lifecycle event
// ----------------------------------
export function recordEvent(siteId, type, payload = {}) {
  const site = ensureSite(siteId);

  const evt = {
    type,
    ts: new Date().toISOString(),
    ...payload
  };

  site.history.push(evt);

  // Update active incident state machine
  switch (type) {
    case 'alarm_raised':
      if (!site.activeIncident) {
        site.activeIncident = {
          siteId,
          startedAt: evt.ts,
          lastUpdate: evt.ts,
          state: 'investigating',
          details: {}
        };
      }
      break;

    case 'investigating':
      if (site.activeIncident) {
        site.activeIncident.state = 'investigating';
        site.activeIncident.lastUpdate = evt.ts;
      }
      break;

    case 'mitigation_started':
      if (site.activeIncident) {
        site.activeIncident.state = 'mitigating';
        site.activeIncident.lastUpdate = evt.ts;
      }
      break;

    case 'stabilized':
      if (site.activeIncident) {
        site.activeIncident.state = 'stabilized';
        site.activeIncident.stabilizedAt = evt.ts;
        site.activeIncident.lastUpdate = evt.ts;
      }
      break;

    case 'restored':
      if (site.activeIncident) {
        site.activeIncident.state = 'restored';
        site.activeIncident.restoredAt = evt.ts;
        site.activeIncident.lastUpdate = evt.ts;
      }
      break;

    case 'dispatch_issued':
      if (site.activeIncident) {
        site.activeIncident.state = 'dispatch_issued';
        site.activeIncident.dispatchAt = evt.ts;
        site.activeIncident.lastUpdate = evt.ts;
      }
      break;

    case 'closed':
      if (site.activeIncident) {
        site.activeIncident.closedAt = evt.ts;
        site.activeIncident.lastUpdate = evt.ts;
        site.activeIncident = null;
      }
      break;
  }

  persist();
  return evt;
}

// ----------------------------------
// Query helpers
// ----------------------------------
export function getActiveIncident(siteId) {
  const site = incidents.sites[siteId];
  return site?.activeIncident || null;
}

export function getIncidentHistory(siteId) {
  const site = incidents.sites[siteId];
  return site?.history || [];
}

export function getAllIncidents() {
  return incidents;
}

/**
 * Get the last known event of a certain type (e.g., 'restored', 'stabilized')
 */
export function getLastEventOfType(siteId, type) {
  const hist = getIncidentHistory(siteId);
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].type === type) return hist[i];
  }
  return null;
}

// ----------------------------------
// Reset (for testing)
// ----------------------------------
export function clearIncidents() {
  incidents = { sites: {} };
  persist();
}
