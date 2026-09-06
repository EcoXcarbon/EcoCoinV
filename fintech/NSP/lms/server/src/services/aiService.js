import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import env from '../config/env.js';
import AICache from '../models/AICache.js';
import AIUsage from '../models/AIUsage.js';

let client = null;
if (env.ANTHROPIC_API_KEY) {
  client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

// Relay provider: routes prompts through the VPS Claude-Code relay agent
// (POST <AI_RELAY_URL>/v1/run, Bearer AI_RELAY_SECRET → { ok, output, meta }).
// Subscription-billed, so no token accounting is returned.
const relayReady = env.AI_PROVIDER === 'relay' && !!env.AI_RELAY_URL && !!env.AI_RELAY_SECRET;

async function callRelay(promptText, systemPrompt, timeoutMs = 120000, model) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.AI_RELAY_URL.replace(/\/$/, '')}/v1/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AI_RELAY_SECRET}` },
      body: JSON.stringify({ prompt: promptText, system: systemPrompt || undefined, model: model || undefined, timeout_ms: Math.max(0, timeoutMs - 10000), thinking: false }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `relay ${res.status}`);
    }
    const data = await res.json();
    return {
      text: data.output || '',
      inputTokens: data.meta?.inputTokens || 0,
      outputTokens: data.meta?.outputTokens || 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a prompt to Claude and return the response.
 * Includes caching, daily rate limiting per user, and graceful degradation.
 *
 * @param {string} promptText - The user/system prompt to send
 * @param {string} userId - MongoDB user _id for rate limiting
 * @param {object} [options]
 * @param {string} [options.systemPrompt] - Optional system prompt
 * @param {number} [options.maxTokens=2048] - Max response tokens
 * @param {boolean} [options.skipCache=false] - Bypass cache
 * @returns {{ text: string, inputTokens: number, outputTokens: number, cached: boolean, available: boolean }}
 */
export async function sendPrompt(promptText, userId, options = {}) {
  if (!client && !relayReady) {
    return { text: '', error: 'AI not configured', available: false };
  }

  const { systemPrompt, maxTokens = 2048, skipCache = false, timeoutMs = 120000, model } = options;

  try {
    // Rate limit check
    const today = new Date().toISOString().split('T')[0];
    let usage = await AIUsage.findOne({ user: userId, date: today });
    if (usage && usage.requests >= env.AI_DAILY_LIMIT) {
      return { text: '', error: 'Daily AI limit reached. Try again tomorrow.', available: true };
    }

    // Cache check
    const cacheKey = crypto.createHash('sha256')
      .update(`${env.AI_MODEL}:${systemPrompt || ''}:${promptText}`)
      .digest('hex');

    if (!skipCache) {
      const cached = await AICache.findOne({ key: cacheKey });
      if (cached) {
        return { text: cached.response, inputTokens: 0, outputTokens: 0, cached: true, available: true };
      }
    }

    // Call the configured provider (relay preferred when enabled).
    let text, inputTokens, outputTokens;
    if (relayReady) {
      const r = await callRelay(promptText, systemPrompt, timeoutMs, model);
      text = r.text; inputTokens = r.inputTokens; outputTokens = r.outputTokens;
    } else {
      const messages = [{ role: 'user', content: promptText }];
      const params = { model: env.AI_MODEL, max_tokens: maxTokens, messages };
      if (systemPrompt) params.system = systemPrompt;
      const response = await client.messages.create(params);
      text = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
      inputTokens = response.usage?.input_tokens || 0;
      outputTokens = response.usage?.output_tokens || 0;
    }

    // Cache the response
    await AICache.findOneAndUpdate(
      { key: cacheKey },
      { response: text, model: env.AI_MODEL, inputTokens, outputTokens, createdAt: new Date() },
      { upsert: true },
    ).catch(() => {});

    // Update usage
    if (!usage) {
      usage = await AIUsage.create({ user: userId, date: today, requests: 1, inputTokens, outputTokens });
    } else {
      usage.requests += 1;
      usage.inputTokens += inputTokens;
      usage.outputTokens += outputTokens;
      await usage.save();
    }

    return { text, inputTokens, outputTokens, cached: false, available: true };
  } catch (err) {
    console.error('[AI Service Error]', err.message);
    return { text: '', error: 'AI service temporarily unavailable', available: true };
  }
}

/**
 * Parse a JSON response from Claude, stripping markdown fences if present.
 */
export function parseAIJson(text) {
  let cleaned = text.trim();
  // Strip ```json ... ``` fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  return JSON.parse(cleaned);
}
