// server/agents/correlationAgent.js
export class CorrelationAgent {
  constructor(name = 'Agent A') {
    this.name = name;
    this.status = 'stopped';        // 'idle' | 'running' | 'stopped'  -> default OFF
    this.delegation = 'disabled';   // 'enabled' | 'disabled'          -> policy: disabled
    this.startedAt = null;          // Date | null
    this.runtimeSec = 0;            // accumulates across runs
    this.tasks = 47;                // seed to match your UI
    this.lastTask = null;
    this.logs = [];                 // string[]
    this.subscribers = new Set();   // SSE clients

    this._log('initialized (stopped, delegation disabled by policy)');
  }

  _log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 2000) this.logs.shift();
    for (const res of this.subscribers) {
      try { res.write(`data: ${line}\n\n`); } catch {}
    }
  }

  get summary() {
    const live = this.startedAt ? Math.floor((Date.now() - this.startedAt.getTime()) / 1000) : 0;
    return {
      name: this.name,
      status: this.status === 'running' ? 'Active' : (this.status === 'stopped' ? 'Stopped' : 'Idle'),
      delegation: this.delegation === 'enabled' ? 'Enabled' : 'Disabled',
      runtimeSec: this.runtimeSec + live,
      tasks: this.tasks,
      lastTask: this.lastTask,
    };
  }

  start() {
    if (this.status === 'running') return 'Already running';
    this.status = 'running';
    this.startedAt = new Date();
    this._log('started');
    return 'OK: started';
    // note: delegation remains disabled (policy)
  }

  stop() {
    if (this.status !== 'running') {
      this.status = 'stopped';
      this._log('stopped (no-op)');
      return 'OK: stopped';
    }
    const delta = Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
    this.runtimeSec += delta;
    this.startedAt = null;
    this.status = 'stopped';
    this._log(`stopped (accumulated ${delta}s)`);
    return 'OK: stopped';
  }

  // Enforce delegation policy: always disabled
  setDelegation(_enabled) {
    if (this.delegation !== 'disabled') {
      this.delegation = 'disabled';
      this._log('delegation disabled (policy enforced)');
      return 'OK: delegation disabled (policy)';
    }
    this._log('delegation already disabled (policy)');
    return 'OK: delegation disabled (policy)';
  }

  // Simple correlation “task” (non-LLM) — groups by siteId and merges close-in-time events
  correlate(events = []) {
    const bySite = new Map();
    for (const e of events) {
      const key = e.siteId ?? 'unknown';
      if (!bySite.has(key)) bySite.set(key, []);
      bySite.get(key).push(e);
    }
    const incidents = [];
    for (const [site, list] of bySite.entries()) {
      list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      let cur = { siteId: site, start: null, end: null, count: 0, types: new Set(), events: [] };
      const PUSH = () => {
        incidents.push({
          siteId: cur.siteId,
          start: cur.start,
          end: cur.end,
          count: cur.count,
          types: [...cur.types],
          events: cur.events,
        });
      };
      const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
      for (const ev of list) {
        const t = new Date(ev.timestamp).getTime();
        if (!cur.start) {
          cur.start = ev.timestamp;
          cur.end = ev.timestamp;
          cur.count = 1;
          cur.types.add(ev.type);
          cur.events.push(ev);
          continue;
        }
        const last = new Date(cur.end).getTime();
        if (t - last <= WINDOW_MS) {
          cur.end = ev.timestamp;
          cur.count++;
          cur.types.add(ev.type);
          cur.events.push(ev);
        } else {
          PUSH();
          cur = { siteId: site, start: ev.timestamp, end: ev.timestamp, count: 1, types: new Set([ev.type]), events: [ev] };
        }
      }
      if (cur.count > 0) PUSH();
    }

    this.lastTask = `correlated ${events.length} events → ${incidents.length} incidents`;
    this.tasks += 1;
    this._log(this.lastTask);
    return { incidents };
  }
}

export const correlationAgent = new CorrelationAgent('Agent A'); // matches your card