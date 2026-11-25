import { applyModelConfig, getConfiguredSource } from './model-config.js';

export const KILO_BASE_URL = 'https://ai-gateway.kilo.ai/api/v1';
export const KILO_PROVIDER = 'dsh-free-model-kilo';

const REQUEST_TIMEOUT_MS = 10_000;
const FRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000;

export class KiloCatalogError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'KiloCatalogError';
    this.code = options.code;
    this.status = options.status;
    this.providerRetryAfterMs = options.providerRetryAfterMs;
  }
}

export function isCatalogConnectionError(error) {
  return error instanceof KiloCatalogError && (error.code === 'TRANSPORT' || error.code === 'TIMEOUT');
}

function isZero(price) {
  return price === 0 || (typeof price === 'string' && /^0+(?:\.0+)?(?:e[+-]?\d+)?$/i.test(price));
}

function isFreeTextModel(row, now) {
  if (!row || typeof row.id !== 'string' || !row.id.trim() || row.isFree !== true) return false;

  const pricing = row.pricing;
  if (!pricing || !isZero(pricing.prompt) || !isZero(pricing.completion)) return false;
  if (!Object.entries(pricing).every(([key, value]) => key === 'discount' || isZero(value))) return false;

  const { input_modalities: input = [], output_modalities: output = [] } = row.architecture ?? {};
  if (!Array.isArray(input) || !input.includes('text') || !Array.isArray(output) || !output.includes('text')) {
    return false;
  }
  return !row.expiration_date || Date.parse(row.expiration_date) > now;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function maxTokensParameter(supportedParameters) {
  if (supportedParameters.includes('max_tokens')) return 'max_tokens';
  if (supportedParameters.includes('max_completion_tokens')) return 'max_completion_tokens';
  return undefined;
}

function kiloReasoningChoices(opencode, supported) {
  if (!Array.isArray(opencode?.reasoning_options)) return [];
  const supportsReasoningObject = supported.includes('reasoning');
  if (!supportsReasoningObject && !supported.includes('reasoning_effort')) return [];

  const choices = new Map();
  function add(id, name, effort, enabled) {
    // Keep the upstream toggle separate from its wire value (e.g. thinking → high).
    const params = supportsReasoningObject
      ? { reasoning: { ...(typeof enabled === 'boolean' ? { enabled } : {}), effort } }
      : { reasoning_effort: effort };
    choices.set(id, { id, name, params });
  }

  for (const option of opencode.reasoning_options) {
    if (option?.type === 'effort' && Array.isArray(option.values)) {
      for (const id of option.values) {
        if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(id)) continue;
        const variant = opencode.variants?.[id]?.reasoning;
        const name = id === 'xhigh' ? 'Extra high' : id[0].toUpperCase() + id.slice(1);
        add(id, name, typeof variant?.effort === 'string' ? variant.effort : id, variant?.enabled);
      }
    } else if (option?.type === 'toggle' && supportsReasoningObject) {
      for (const [id, name] of [['instant', '关闭思考'], ['thinking', '开启思考']]) {
        const variant = opencode.variants?.[id]?.reasoning;
        if (variant?.enabled === (id === 'thinking')) {
          add(id, name, typeof variant.effort === 'string' ? variant.effort : undefined, variant.enabled);
        }
      }
    }
  }
  return [...choices.values()];
}

function modelInfo(row) {
  const contextWindow = positiveInteger(row.context_length) ?? positiveInteger(row.top_provider?.context_length);
  const maxCompletionTokens = positiveInteger(row.top_provider?.max_completion_tokens);
  const supportedParameters = Array.isArray(row.supported_parameters)
    ? row.supported_parameters.filter(parameter => typeof parameter === 'string')
    : [];
  const description = typeof row.description === 'string' ? row.description.trim() : '';

  return {
    provider: KILO_PROVIDER,
    id: row.id,
    name: (typeof row.name === 'string' ? row.name.trim() : '') || row.id,
    inputModalities: row.architecture.input_modalities.includes('image') ? ['text', 'image'] : ['text'],
    webSearch: supportedParameters.includes('tools'),
    ...(description ? { description } : {}),
    ...(contextWindow ? { context: { contextWindow } } : {}),
    ...(maxCompletionTokens ? { maxCompletionTokens } : {}),
    supportedParameters,
    reasoningChoices: kiloReasoningChoices(row.opencode, supportedParameters),
  };
}

function retryAfterMs(header, now) {
  if (!header) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : NaN;
  const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isSafeInteger(duration) && duration > 0 ? duration : undefined;
}

async function requestCatalog(fetchImpl, now, configured) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetchImpl(`${KILO_BASE_URL}/models`, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: timeout,
    });
  } catch (cause) {
    throw new KiloCatalogError('无法连接 Kilo 模型目录，请稍后重试。', {
      code: timeout.aborted ? 'TIMEOUT' : 'TRANSPORT',
      cause,
    });
  }

  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => {});
    throw new KiloCatalogError(
      status === 429 ? 'Kilo 模型目录暂时限流，请稍后重试。' : `Kilo 模型目录请求失败（HTTP ${status}）。`,
      {
        code: status === 429 ? 'RATE_LIMIT' : 'KILO_CATALOG_HTTP',
        status,
        providerRetryAfterMs: retryAfterMs(response.headers.get('retry-after'), now()),
      },
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new KiloCatalogError('Kilo 模型目录响应无法读取。', {
      code: timeout.aborted ? 'TIMEOUT' : 'KILO_CATALOG_INVALID',
      cause,
    });
  }
  if (!Array.isArray(payload?.data)) {
    throw new KiloCatalogError('Kilo 返回的模型目录格式有误。', { code: 'KILO_CATALOG_INVALID' });
  }

  const models = new Map();
  const fetchedAt = now();
  for (const row of payload.data) {
    const config = configured.get(row?.id);
    if (!config || models.get(row.id)?.model || !isFreeTextModel(row, fetchedAt)) continue;
    const model = modelInfo(row);
    if (config.maxCompletionTokens !== undefined && !maxTokensParameter(model.supportedParameters)
      && (model.maxCompletionTokens ?? Infinity) > config.maxCompletionTokens) {
      models.set(row.id, { unavailableReason: 'output-limit-unenforceable' });
      continue;
    }
    models.set(row.id, {
      model: applyModelConfig(model, config),
      expiresAt: row.expiration_date ? Date.parse(row.expiration_date) : Infinity,
    });
  }
  return { models, fetchedAt };
}

function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort;
  const aborted = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', abort));
}

/** Refresh DSH's model catalog on demand, sharing one anonymous request between readers. */
export function createKiloCatalog({
  fetch: fetchImpl = globalThis.fetch, now = Date.now, configuredModels = getConfiguredSource('kilo')?.models ?? [],
} = {}) {
  const configured = new Map(configuredModels.map(row => [row.id, row]));
  let snapshot;
  let lastError;
  let nextRefresh = 0;
  let inFlight;

  async function load(signal, refresh = false) {
    signal?.throwIfAborted();
    const manualRefresh = refresh && (!lastError || isCatalogConnectionError(lastError));
    if (now() >= nextRefresh || manualRefresh || (!snapshot && !lastError)) {
      inFlight ??= requestCatalog(fetchImpl, now, configured).then(
        result => {
          snapshot = result;
          lastError = undefined;
          nextRefresh = result.fetchedAt + FRESH_MS;
        },
        error => {
          snapshot = undefined;
          lastError = error;
          nextRefresh = now() + Math.max(RETRY_MS, error.providerRetryAfterMs ?? 0);
        },
      ).finally(() => { inFlight = undefined; });
    }
    if (inFlight) await waitWithSignal(inFlight, signal);
    if (lastError) throw lastError;
    return snapshot.models;
  }

  async function listConfiguredModels(signal, { refresh = false } = {}) {
    signal?.throwIfAborted();
    if (!configured.size) return [];
    let entries;
    try {
      entries = await load(signal, refresh);
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof KiloCatalogError)) throw error;
    }
    return [...configured.values()].map(row => {
      const entry = entries?.get(row.id);
      if (entry?.expiresAt > now()) return { ...structuredClone(entry.model), available: true };
      return {
        id: row.id, name: row.name ?? row.id, provider: KILO_PROVIDER, available: false,
        unavailableReason: entry?.unavailableReason ?? (entries ? 'not-offered' : 'provider-unavailable'),
      };
    });
  }

  return {
    listConfiguredModels,
    async listModels(signal, options) {
      return (await listConfiguredModels(signal, options)).filter(model => model.available);
    },
    async getModel(id, signal) {
      signal?.throwIfAborted();
      if (!configured.has(id)) return undefined;
      const entry = (await load(signal)).get(id);
      return entry?.expiresAt > now() ? structuredClone(entry.model) : undefined;
    },
  };
}
