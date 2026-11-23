export const KILO_BASE_URL = 'https://ai-gateway.kilo.ai/api/v1';
export const KILO_PROVIDER = 'dsh-free-model-kilo';

const REQUEST_TIMEOUT_MS = 10_000;
const FRESH_MS = 5 * 60_000;
const MAX_STALE_MS = 20 * 60_000;
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
    inputModalities: ['text'],
    ...(description ? { description } : {}),
    ...(contextWindow ? { context: { contextWindow } } : {}),
    ...(maxCompletionTokens ? { maxCompletionTokens } : {}),
    supportedParameters,
  };
}

function retryAfterMs(header, now) {
  if (!header) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : NaN;
  const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isSafeInteger(duration) && duration > 0 ? duration : undefined;
}

async function requestCatalog(fetchImpl, now) {
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
    if (isFreeTextModel(row, fetchedAt) && !models.has(row.id)) {
      models.set(row.id, { model: modelInfo(row), expiresAt: row.expiration_date ? Date.parse(row.expiration_date) : Infinity });
    }
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
export function createKiloCatalog({ fetch: fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let snapshot;
  let lastError;
  let nextRefresh = 0;
  let inFlight;

  function currentSnapshot() {
    if (snapshot && now() - snapshot.fetchedAt < MAX_STALE_MS) return snapshot.models;
    throw lastError;
  }

  async function load(signal) {
    signal?.throwIfAborted();
    if (now() >= nextRefresh || (!snapshot && !lastError)) {
      inFlight ??= requestCatalog(fetchImpl, now).then(
        result => {
          snapshot = result;
          lastError = undefined;
          nextRefresh = result.fetchedAt + FRESH_MS;
        },
        error => {
          lastError = error;
          nextRefresh = now() + Math.max(RETRY_MS, error.providerRetryAfterMs ?? 0);
        },
      ).finally(() => { inFlight = undefined; });
      await waitWithSignal(inFlight, signal);
    }
    return currentSnapshot();
  }

  return {
    async listModels(signal) {
      const entries = await load(signal);
      return [...entries.values()]
        .filter(entry => entry.expiresAt > now())
        .map(entry => structuredClone(entry.model));
    },

    async getModel(id, signal) {
      const entry = (await load(signal)).get(id);
      return entry?.expiresAt > now() ? structuredClone(entry.model) : undefined;
    },
  };
}
