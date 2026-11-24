import { maxTokensParameter } from './stream.js';

const CONCURRENCY = 3;
const PROBE_TIMEOUT_MS = 18_000;
const BATCH_COOLDOWN_MS = 45_000;
const PROBE_MAX_TOKENS = 512;

async function probeModel(stream, model, lifetime) {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const signal = AbortSignal.any([lifetime, timeout]);
  try {
    const options = {
      provider: model.provider,
      model: model.id,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply only with OK.' }] }],
      signal,
      ...(maxTokensParameter(model.supportedParameters) ? { maxTokens: PROBE_MAX_TOKENS } : {}),
    };
    let hasText = false;
    for await (const chunk of stream(options, model)) {
      if (chunk.type === 'text-delta' && chunk.text.trim()) hasText = true;
      if (chunk.type !== 'finish') continue;
      const { kind, failure } = chunk.reason;
      if (timeout.aborted) return { status: 'unavailable', reason: 'TIMEOUT' };
      if (hasText && (kind === 'stop' || kind === 'max-tokens')) return { status: 'available' };
      return { status: 'unavailable', reason: failure?.code ?? 'EMPTY_RESPONSE', retryAfterMs: failure?.providerRetryAfterMs };
    }
  } catch {
    // An exception before a finish is equivalent to a broken stream for the probe.
  }
  return { status: 'unavailable', reason: timeout.aborted ? 'TIMEOUT' : 'TRANSPORT' };
}

export function createModelAvailability({ stream, signal, now = Date.now }) {
  let results = new Map();
  let checking = false;
  let retryAt = 0;

  function snapshot() {
    return {
      checking,
      ...(retryAt > now() ? { retryAt } : {}),
      models: [...results.values()].map(({ blockedUntil, ...result }) => result),
    };
  }

  async function run(queue) {
    let next = 0;
    async function worker() {
      while (next < queue.length && !signal.aborted) {
        const model = queue[next++];
        const startedAt = performance.now();
        const { retryAfterMs, ...result } = await probeModel(stream, model, signal);
        const elapsedMs = Math.round(performance.now() - startedAt);
        const checkedAt = now();
        if (signal.aborted) return;
        const blockedUntil = result.reason === 'RATE_LIMIT' && retryAfterMs > 0 ? checkedAt + retryAfterMs : 0;
        results.set(model.id, { id: model.id, ...result, elapsedMs, checkedAt, blockedUntil });
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    } finally {
      checking = false;
      retryAt = now() + BATCH_COOLDOWN_MS;
      if (signal.aborted) results.clear();
    }
  }

  function start(models) {
    const startedAt = now();
    if (checking || retryAt > startedAt || signal.aborted) return snapshot();

    const nextResults = new Map();
    const queue = [];
    for (const model of models) {
      if (nextResults.has(model.id)) continue;
      const previous = results.get(model.id);
      if (previous?.blockedUntil > startedAt) {
        nextResults.set(model.id, previous);
      } else {
        nextResults.set(model.id, { id: model.id, status: 'checking' });
        queue.push(model);
      }
    }
    results = nextResults;
    if (!queue.length) {
      retryAt = results.size ? Math.min(...[...results.values()].map(result => result.blockedUntil)) : 0;
      return snapshot();
    }

    checking = true;
    void run(queue);
    return snapshot();
  }

  return { snapshot, start };
}
