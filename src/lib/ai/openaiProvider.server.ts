/** Optional server-only OpenAI Responses connector. It never enables live demo calls. */
import { createHttpJsonAIProvider, type AIProviderRequest } from './providerAdapter.server.ts';

type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  required?: readonly string[];
  items?: Schema;
  [key: string]: unknown;
};
export interface OpenAIProviderOptions {
  /** Institution-selected model/snapshot with Responses and structured-output support. */
  model: string;
  getApiKey: (signal: AbortSignal) => Promise<string>;
  maxOutputTokens: number;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  fetchImpl?: typeof fetch;
}

const gradingEntries: Schema = {
  type: 'array', maxItems: 100,
  items: {
    type: 'object', additionalProperties: false, required: ['category', 'weight'],
    properties: {
      category: { type: 'string', minLength: 1, maxLength: 120 },
      weight: { type: 'number', minimum: 0, maximum: 100 },
    },
  },
};

/** Adapt optional fields without weakening the application's independent validators. */
function strictSchema(schema: Schema): Schema {
  const result = { ...schema };
  delete result.$schema;
  if (schema.type === 'object') {
    if (!schema.properties || schema.additionalProperties !== false) throw new Error('Unsupported OpenAI output schema.');
    result.required = Object.keys(schema.properties);
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, property]) => {
      const child = strictSchema(property);
      // Citations need a location in every vendor path, even though legacy UI types allow omission.
      return [key, schema.required?.includes(key) || key === 'sourceLocation' ? child : { anyOf: [child, { type: 'null' }] }];
    }));
  }
  if (schema.items) result.items = strictSchema(schema.items);
  return result;
}

function wireSchema(request: AIProviderRequest): Schema {
  const schema = request.responseSchema as Schema;
  return strictSchema({ ...schema, properties: {
    ...schema.properties,
    ...(request.task === 'syllabus'
      ? { gradingWeights: gradingEntries }
      : { cards: { ...schema.properties?.cards, maxItems: request.requestedCardCount } }),
  } });
}

function encode(request: AIProviderRequest, config: OpenAIProviderOptions) {
  return {
    model: config.model,
    store: false,
    max_output_tokens: config.maxOutputTokens,
    ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
    instructions: `${request.systemPrompt}\n\nProvider format: use null for unsupported optional fields instead of omitting them. Always supply sourceLocation using an exact location from the source segments.${request.task === 'syllabus' ? ' gradingWeights is an ordered array of {category, weight} entries, or null when ambiguous. Its evidence paths remain gradingWeights[0], gradingWeights[1], and so on. Keep category labels in source order.' : ''}`,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({
      task: request.task, locale: request.locale, requestedCardCount: request.requestedCardCount,
      courseTitle: request.courseTitle, source: request.source,
    }) }] }],
    text: { format: { type: 'json_schema', name: `lms_${request.task}`, strict: true, schema: wireSchema(request) } },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Remove only known optional nulls. Unknown fields survive for strict app rejection. */
function restoreOptionalFields(value: unknown, schema: Schema): unknown {
  if (Array.isArray(value) && schema.items) return value.map(item => restoreOptionalFields(item, schema.items!));
  if (!record(value) || !schema.properties) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const property = Object.hasOwn(schema.properties!, key) ? schema.properties![key] : undefined;
    if (property && child === null && !schema.required?.includes(key) && key !== 'sourceLocation') return [];
    return [[key, property ? restoreOptionalFields(child, property) : child]];
  }));
}

function decodeTask(text: string, request: AIProviderRequest): unknown {
  let payload: unknown;
  try { payload = JSON.parse(text); }
  catch { throw new Error('OpenAI returned invalid task JSON.'); }
  if (request.task === 'syllabus' && record(payload) && payload.gradingWeights !== null && payload.gradingWeights !== undefined) {
    const entries = payload.gradingWeights;
    if (!Array.isArray(entries) || !entries.length || entries.length > 100) throw new Error('OpenAI returned invalid grading entries.');
    const labels = new Set<string>();
    const pairs: [string, number][] = [];
    for (const entry of entries) {
      if (!record(entry) || Object.keys(entry).some(key => key !== 'category' && key !== 'weight') || typeof entry.category !== 'string' || !entry.category.trim() || entry.category.length > 120 || typeof entry.weight !== 'number' || !Number.isFinite(entry.weight) || entry.weight < 0 || entry.weight > 100) throw new Error('OpenAI returned invalid grading entries.');
      const category = entry.category.trim();
      // Numeric object keys reorder on conversion and would break indexed evidence.
      if (/^(0|[1-9]\d*)$/.test(category) || ['__proto__', 'constructor', 'prototype'].includes(category.toLowerCase()) || labels.has(category.toLocaleLowerCase())) throw new Error('OpenAI returned duplicate or unsupported grading categories.');
      labels.add(category.toLocaleLowerCase());
      pairs.push([category, entry.weight]);
    }
    payload = { ...payload, gradingWeights: Object.fromEntries(pairs) };
  }
  return restoreOptionalFields(payload, request.responseSchema as Schema);
}

/** Uses the existing vendor boundary; no SDK, model fallback, retries or client secrets. */
export function createOpenAIResponsesProvider(options: OpenAIProviderOptions) {
  if (typeof options.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(options.model)) throw new Error('Configure an OpenAI model identifier.');
  if (typeof options.getApiKey !== 'function') throw new Error('Configure a server-side OpenAI credential reader.');
  if (!Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens < 1 || options.maxOutputTokens > 200_000) throw new Error('Configure an OpenAI output limit from 1 to 200000 tokens.');
  if (options.reasoningEffort !== undefined && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(options.reasoningEffort)) throw new Error('Invalid OpenAI reasoning effort.');
  const config = { ...options };
  return createHttpJsonAIProvider({
    id: `openai/${config.model}`,
    endpoint: 'https://api.openai.com/v1/responses',
    fetchImpl: config.fetchImpl,
    headers: async signal => {
      const key = await config.getApiKey(signal);
      if (typeof key !== 'string' || !key || key.length > 4096 || /\s/.test(key)) throw new Error('OpenAI API credentials are unavailable.');
      return { authorization: `Bearer ${key}` };
    },
    encode: request => encode(request, config),
    decode: (raw, request, headers, requestSha256) => {
      if (!record(raw) || raw.status !== 'completed' || raw.error != null || raw.incomplete_details != null || !Array.isArray(raw.output)) throw new Error('OpenAI did not complete generation. No draft was accepted.');
      const texts: string[] = [];
      let messages = 0;
      for (const item of raw.output) {
        if (!record(item)) throw new Error('OpenAI returned an invalid response item.');
        if (item.type === 'reasoning') continue;
        if (item.type !== 'message' || item.role !== 'assistant' || item.status !== 'completed' || !Array.isArray(item.content)) throw new Error('OpenAI returned an unexpected response item.');
        messages += 1;
        for (const part of item.content) {
          if (!record(part)) throw new Error('OpenAI returned invalid response content.');
          if (part.type === 'refusal') throw new Error('OpenAI declined generation. No draft was accepted.');
          if (part.type !== 'output_text' || typeof part.text !== 'string') throw new Error('OpenAI returned unexpected response content.');
          texts.push(part.text);
        }
      }
      if (messages !== 1 || texts.length !== 1 || !texts[0].trim()) throw new Error('OpenAI must return one complete JSON result.');
      if (typeof raw.model !== 'string' || typeof raw.id !== 'string') throw new Error('OpenAI omitted response attribution.');
      const payload = decodeTask(texts[0], request);
      const usage = record(raw.usage) ? raw.usage : undefined;
      if (usage && (typeof usage.input_tokens !== 'number' || typeof usage.output_tokens !== 'number')) throw new Error('OpenAI returned invalid token usage.');
      request.reportMetadata?.({
        model: raw.model, responseId: raw.id, httpRequestId: headers.get('x-request-id') ?? undefined,
        reasoningEffort: config.reasoningEffort,
        requestSha256,
        inputTokens: usage?.input_tokens as number | undefined,
        outputTokens: usage?.output_tokens as number | undefined,
      });
      return payload;
    },
  });
}
