// server/llm/executor.js
import 'dotenv/config';
import OpenAI from 'openai';

/**
 * LLM Executor
 * - Centralizes all model calls (chat, streaming).
 * - Supports OpenAI-compatible tools (function calling) with an automatic tool loop.
 * - Retries with exponential backoff for transient failures.
 * - Optional strict JSON responses.
 *
 * Usage:
 *   import { llm, runChat, runChatStream, runWithTools, pickModel } from './llm/executor.js';
 *
 *   const text = await runChat({
 *     messages: [{ role: 'user', content: 'Hello' }],
 *     model: pickModel('chat'),               // optional
 *     temperature: 0.2,
 *   });
 *
 *   // Tools:
 *   const result = await runWithTools({
 *     messages,
 *     tools,                                  // OpenAI tool schema(s)
 *     toolHandlers: {                         // { [toolName]: async (args) => any }
 *       get_system_state: async () => getSystemState(),
 *     },
 *     model: pickModel('chat-tools'),
 *   });
 */

/* --------------------------------------------------------------------------------------
 * Client & Model helpers
 * ------------------------------------------------------------------------------------*/

export const llm = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Pick a model based on a simple semantic key.
 * You can override via env:
 *  - OPENAI_MODEL_CHAT
 *  - OPENAI_MODEL_CHAT_STREAM
 *  - OPENAI_MODEL_CHAT_TOOLS
 */
export function pickModel(kind = 'chat') {
  const byKind = {
    'chat': process.env.OPENAI_MODEL_CHAT || 'gpt-4o-mini',
    'chat-stream': process.env.OPENAI_MODEL_CHAT_STREAM || 'gpt-4o-mini',
    'chat-tools': process.env.OPENAI_MODEL_CHAT_TOOLS || 'gpt-4o-mini',
    'json': process.env.OPENAI_MODEL_JSON || 'gpt-4o-mini',
  };
  return byKind[kind] || process.env.OPENAI_MODEL_CHAT || 'gpt-4o-mini';
}

/* --------------------------------------------------------------------------------------
 * Utilities
 * ------------------------------------------------------------------------------------*/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(String(str));
  } catch {
    return fallback;
  }
}

function redactError(err) {
  const msg = err?.message || String(err) || 'error';
  return /api key|authorization/i.test(msg) ? 'API error' : msg;
}

/* --------------------------------------------------------------------------------------
 * Core: simple chat (single shot, non-stream)
 * ------------------------------------------------------------------------------------*/

export async function runChat({
  messages = [],
  model = pickModel('chat'),
  temperature = 0.2,
  max_tokens = undefined,
  response_format, // e.g., { type: 'json_object' }
  tools = undefined,
  tool_choice = undefined,    // 'auto' | 'none' | { type:'function', function:{ name } }
  retries = 2,
  timeoutMs = 30_000,
} = {}) {
  const attemptMax = clamp(retries, 0, 5);

  for (let attempt = 0; attempt <= attemptMax; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);

      const completion = await llm.chat.completions.create({
        model,
        temperature,
        max_tokens,
        response_format,
        tools,
        tool_choice,
        messages,
      }, { signal: ctrl.signal });

      clearTimeout(t);

      const msg = completion.choices?.[0]?.message;
      return {
        ok: true,
        content: msg?.content ?? '',
        message: msg,
        raw: completion,
      };
    } catch (e) {
      if (attempt === attemptMax) {
        return { ok: false, error: redactError(e) };
      }
      // transient backoff
      await sleep(300 * (attempt + 1));
    }
  }
  return { ok: false, error: 'unknown_error' };
}

/* --------------------------------------------------------------------------------------
 * Streaming chat
 * - Returns an async iterator that yields string chunks.
 * - Also returns the final assembled text after completion.
 * ------------------------------------------------------------------------------------*/

export async function runChatStream({
  messages = [],
  model = pickModel('chat-stream'),
  temperature = 0.2,
  max_tokens = undefined,
  tools = undefined,
  tool_choice = undefined,
  timeoutMs = 60_000,
} = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const stream = await llm.chat.completions.create({
    model,
    temperature,
    max_tokens,
    tools,
    tool_choice,
    stream: true,
    messages,
  }, { signal: ctrl.signal });

  let finalText = '';

  async function* iterator() {
    try {
      for await (const part of stream) {
        const delta = part?.choices?.[0]?.delta?.content || '';
        if (delta) {
          finalText += delta;
          yield delta;
        }
      }
    } finally {
      clearTimeout(t);
    }
  }

  return {
    ok: true,
    [Symbol.asyncIterator]: iterator,
    getText: () => finalText,
  };
}

/* --------------------------------------------------------------------------------------
 * Tool Calling Loop
 * - Give it OpenAI tool schemas and a toolHandlers map.
 * - It will automatically call tools as the model requests,
 *   append tool outputs, and re-ask the model until completion.
 * ------------------------------------------------------------------------------------*/

export async function runWithTools({
  messages = [],
  tools = [],
  toolHandlers = {},       // { [toolName]: async (argsObject) => any }
  tool_choice = 'auto',
  model = pickModel('chat-tools'),
  temperature = 0.2,
  maxRounds = 6,
  max_tokens,
  timeoutMs = 60_000,
  retries = 2,
} = {}) {
  const convo = [...messages];
  const attemptMax = clamp(retries, 0, 5);

  for (let attempt = 0; attempt <= attemptMax; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);

      // First ask
      let response = await llm.chat.completions.create({
        model,
        temperature,
        max_tokens,
        tools,
        tool_choice,
        messages: convo,
      }, { signal: ctrl.signal });

      clearTimeout(t);

      let msg = response.choices?.[0]?.message;
      let rounds = 0;

      while (rounds < maxRounds) {
        const calls = msg?.tool_calls || [];
        if (!calls.length) {
          // done, we have a normal assistant message
          return { ok: true, content: msg?.content ?? '', message: msg, raw: response };
        }

        // Handle each tool call sequentially (simple + predictable)
        for (const call of calls) {
          const toolName = call.function?.name;
          const rawArgs = call.function?.arguments || '{}';
          const handler = toolHandlers[toolName];
          let toolResult;

          if (!handler) {
            toolResult = { error: `No handler for tool "${toolName}"` };
          } else {
            const parsed = safeJsonParse(rawArgs, {});
            try {
              toolResult = await handler(parsed);
            } catch (e) {
              toolResult = { error: redactError(e) };
            }
          }

          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(toolResult ?? {}),
          });
        }

        // Ask again with the tool outputs
        const ctrl2 = new AbortController();
        const t2 = setTimeout(() => ctrl2.abort(), timeoutMs);

        response = await llm.chat.completions.create({
          model,
          temperature,
          max_tokens,
          tools,
          tool_choice,
          messages: convo,
        }, { signal: ctrl2.signal });

        clearTimeout(t2);

        msg = response.choices?.[0]?.message;
        rounds += 1;
      }

      // Max rounds reached
      return {
        ok: true,
        content: msg?.content ?? '',
        message: msg,
        raw: response,
        warning: 'max_rounds_reached',
      };
    } catch (e) {
      if (attempt === attemptMax) {
        return { ok: false, error: redactError(e) };
      }
      await sleep(300 * (attempt + 1));
    }
  }

  return { ok: false, error: 'unknown_error' };
}

/* --------------------------------------------------------------------------------------
 * Strict JSON helper
 * - Ensures the model returns a valid JSON object (with response_format).
 * - Optionally provide a zod-like schema validator (fn) for extra safety.
 * ------------------------------------------------------------------------------------*/

export async function runJson({
  messages = [],
  model = pickModel('json'),
  temperature = 0,
  schemaValidate = null, // optional: fn(obj) -> throws or returns obj
  retries = 2,
  timeoutMs = 30_000,
  max_tokens,
} = {}) {
  const out = await runChat({
    messages,
    model,
    temperature,
    max_tokens,
    response_format: { type: 'json_object' },
    retries,
    timeoutMs,
  });

  if (!out.ok) return out;

  const text = out.content?.trim() || '{}';
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const obj = safeJsonParse(cleaned, null);
  if (!obj || typeof obj !== 'object') {
    return { ok: false, error: 'json_parse_error', raw: text };
  }

  if (typeof schemaValidate === 'function') {
    try {
      const validated = await schemaValidate(obj);
      return { ok: true, json: validated };
    } catch (e) {
      return { ok: false, error: `schema_validation_error: ${redactError(e)}`, raw: obj };
    }
  }

  return { ok: true, json: obj };
}
