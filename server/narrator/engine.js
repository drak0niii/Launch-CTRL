// server/narrator/engine.js
import { sendNarrationToConsole } from '../routes/console.js'; // we'll add this export
import crypto from 'node:crypto';

function buildEventContext(event) {
  const { source, type, payload = {} } = event;

  // Keep this small but expressive – this is what you feed to the LLM.
  return {
    source,
    type,
    siteId: payload.siteId || payload.site || null,
    severity: payload.severity || null,
    alarm: payload.alarm || payload.alarmName || null,
    incidentId: payload.incidentId || null,
    agentName: payload.agentName || null,
    sweep: payload.sweep || null,
    attempt: payload.attempt || null,
    totalAttempts: payload.totalAttempts || null,
    status: payload.status || null,
    result: payload.result || null,
    resolution: payload.resolution || null,   // e.g. 'fixed', 'unresolved', 'dispatch'
    reason: payload.reason || null,
    powerState: payload.powerState || null,
    batteryLevel: payload.batteryLevel || null,
    raw: payload, // keep original for context if needed
  };
}

// This is called from Supervisor + Agents + Bus
export async function narrateEvent(event) {
  try {
    const context = buildEventContext(event);

    // Build a short system prompt for the LLM inside the console assistant.
    const prompt = [
      `You are the embedded narrator for a telecom operations agentic system.`,
      `Explain, in 1–2 short conversational sentences, what is happening right now.`,
      `Be clear and helpful; speak as if to a human NOC engineer watching the dashboard.`,
      `Do NOT mention that you are an AI or that this is an event; just describe it.`,
      `Focus on: who is acting (Supervisor/Agent A/Agent B/Agent C), which site is affected,`,
      `what step is being taken, and whether this is progress, failure, or resolution.`,
      ``,
      `Event summary:`,
      JSON.stringify(context, null, 2),
    ].join('\n');

    // Reuse the console assistant pipeline – we just send a "system-driven" message.
    await sendNarrationToConsole({
      id: crypto.randomUUID(),
      role: 'assistant',      // looks like assistant in console
      kind: 'narrator',       // internal tag – optional, for future styling/logic
      prompt,                 // LLM input
      context,                // extra metadata if you log it
    });
  } catch (err) {
    console.error('[Narrator] Failed to narrate event:', err);
  }
}
