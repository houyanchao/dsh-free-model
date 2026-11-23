import manifest from './package.json' with { type: 'json' };
import { createKiloCatalog, KiloCatalogError, KILO_PROVIDER } from './catalog.js';
import { createModelVisibility, registerModelManagement } from './model-management.js';
import { DEFAULT_MAX_TOKENS, maxTokensParameter, streamKilo } from './stream.js';

export const name = KILO_PROVIDER;
export const inject = ['llm'];

function requestKilo(url, options) {
  const headers = new Headers(options.headers);
  headers.set('user-agent', `dsh-free-model/${manifest.version} (+https://github.com/deepseek-ai/deepseek-harness)`);
  return fetch(url, { ...options, headers });
}

function resolvedInfo(model) {
  const { provider, id, name, description, inputModalities, context, maxCompletionTokens, supportedParameters } = model;
  return {
    provider, id, name, description, inputModalities, context,
    ...(maxTokensParameter(supportedParameters)
      ? { defaultMaxTokens: Math.min(DEFAULT_MAX_TOKENS, maxCompletionTokens ?? DEFAULT_MAX_TOKENS) }
      : {}),
  };
}

export function createKiloAdapter({
  fetch: fetchImpl = requestKilo,
  catalog = createKiloCatalog({ fetch: fetchImpl }),
  visibility,
} = {}) {
  async function requireModel(id, signal) {
    const model = await catalog.getModel(id, signal);
    if (model) return model;
    throw new KiloCatalogError('该模型当前不在 Kilo 免费目录中。请在模型选择器里重新选择。', {
      code: 'NO_MODEL',
    });
  }

  return {
    providerInfo(provider) {
      return { id: provider, name: 'Kilo 免费模型' };
    },

    providerRetryPolicy() {
      return undefined;
    },

    imageRequestPricing() {
      return undefined;
    },

    imageRequestTarget(_provider, _model, image) {
      return { width: image.width, height: image.height, maxBytes: image.bytes };
    },

    async listModels() {
      const [models, isDisabled] = await Promise.all([catalog.listModels(), visibility?.readDisabled()]);
      return models.filter(model => !isDisabled?.(model.id)).map(resolvedInfo);
    },

    async resolveModel(_provider, id, signal) {
      return resolvedInfo(await requireModel(id, signal));
    },

    async prepareCall(_provider, id, signal) {
      const model = await requireModel(id, signal);
      return {
        model: resolvedInfo(model),
        stream: options => streamKilo(options, model, fetchImpl),
      };
    },

    async *stream(options) {
      const model = await requireModel(options.model, options.signal);
      yield* streamKilo(options, model, fetchImpl);
    },
  };
}

export function apply(ctx) {
  const catalog = createKiloCatalog({ fetch: requestKilo });
  const visibility = createModelVisibility(ctx.get('profileContext')?.dir);
  const adapter = createKiloAdapter({ catalog, visibility });
  const registration = ctx.llm.registerAdapter([KILO_PROVIDER], adapter);
  ctx.inject(['connection'], scope => {
    registerModelManagement(scope, { catalog, visibility, onChange: () => registration.replace([KILO_PROVIDER]) });
  });
}
