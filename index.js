import manifest from './package.json' with { type: 'json' };
import { getConfiguredSource } from './model-config.js';
import { createKiloCatalog, KiloCatalogError, KILO_PROVIDER, maxTokensParameter } from './catalog.js';
import { createModelVisibility, harnessHome, registerModelManagement } from './model-management.js';
import { DEFAULT_MAX_TOKENS, streamKilo } from './stream.js';
import { mountUpdates } from './updates.js';
import { apply as registerChatGPT } from './chatgpt/host/index.js';
import { requestImageTarget } from './chatgpt/host/images.js';
import { createWebSearchSettings, mountWebSearchSettings } from './web-search-settings.js';
import { mountWebSearchPrompt, mountWebSearchTools } from './web-search-tools.js';
import { kiloSearchAvailable } from './web-search-availability.js';

export const name = KILO_PROVIDER;
export const inject = ['llm'];

function requestKilo(url, options) {
  const headers = new Headers(options.headers);
  headers.set('user-agent', `dsh-open-model/${manifest.version} (+https://github.com/deepseek-ai/deepseek-harness)`);
  return fetch(url, { ...options, headers });
}

function resolvedInfo(model) {
  const { provider, id, name, description, inputModalities, context, maxCompletionTokens, supportedParameters, reasoningChoices } = model;
  return {
    provider, id, name, description, inputModalities, context,
    ...(reasoningChoices?.length
      ? { reasoning: { efforts: reasoningChoices.map(({ id, name }) => ({ id, name })) } }
      : {}),
    ...(maxTokensParameter(supportedParameters)
      ? { defaultMaxTokens: Math.min(DEFAULT_MAX_TOKENS, maxCompletionTokens ?? DEFAULT_MAX_TOKENS) }
      : {}),
  };
}

export function createKiloAdapter({
  fetch: fetchImpl = requestKilo,
  catalog = createKiloCatalog({ fetch: fetchImpl }),
  visibility,
  getWebSearchEnabled,
  getAttachments,
} = {}) {
  async function requireModel(id, signal) {
    const model = await catalog.getModel(id, signal);
    if (model) return model;
    throw new KiloCatalogError('该模型当前不可用，请在模型选择器里重新选择。', {
      code: 'NO_MODEL',
    });
  }

  async function* streamModel(id, options) {
    const model = await requireModel(id, options.signal);
    yield* streamKilo(options, model, fetchImpl, { getWebSearchEnabled, getAttachments });
  }

  return {
    providerInfo(provider) {
      return { id: provider, name: getConfiguredSource('kilo')?.name ?? 'OpenModel (免费模型)' };
    },

    providerRetryPolicy() {
      return undefined;
    },

    imageRequestPricing() {
      return undefined;
    },

    imageRequestTarget() {
      return requestImageTarget;
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
        stream: options => streamModel(id, options),
      };
    },

    stream: options => streamModel(options.model, options),
  };
}

export function apply(ctx) {
  const catalog = createKiloCatalog({ fetch: requestKilo });
  const profileDir = ctx.get('profileContext')?.dir ?? harnessHome();
  const visibility = createModelVisibility(profileDir);
  const webSearchSettings = createWebSearchSettings(profileDir);
  let chatGPTSearch;

  async function readWebSearch(id) {
    const saved = await webSearchSettings.read(id);
    return saved ?? await chatGPTSearch?.legacyEnabled(id) ?? false;
  }
  // If local preferences cannot be read, a normal chat can still run without search.
  async function getWebSearchEnabled(id, provider, model, signal) {
    try {
      if (!await readWebSearch(id)) return false;
      if (provider !== KILO_PROVIDER) return await chatGPTSearch?.available(id, model, signal) ?? false;
      return await kiloSearchAvailable(ctx, id, model, catalog, ctx.get('sessions')?.get(id), signal);
    } catch {
      return false;
    }
  }
  const adapter = createKiloAdapter({ catalog, visibility, getWebSearchEnabled, getAttachments: () => ctx.get('attachments') });
  const registration = ctx.llm.registerAdapter([KILO_PROVIDER], adapter);
  mountWebSearchTools(ctx, getWebSearchEnabled);
  mountWebSearchPrompt(ctx, getWebSearchEnabled);
  // DSH displays third-party groups in registration order. Keep free models after the plan.
  const refreshFreeModels = () => registration.replace([KILO_PROVIDER]);
  ctx.inject(['connection'], scope => {
    registerModelManagement(scope, {
      catalog, visibility, fetch: requestKilo,
      onChange: refreshFreeModels,
    });
    mountUpdates(scope);
    mountWebSearchSettings(scope, {
      settings: webSearchSettings,
      getEnabled: readWebSearch,
      isAvailable: (id, provider, model, session, signal) => provider === KILO_PROVIDER
        ? kiloSearchAvailable(scope, id, model, catalog, session, signal)
        : chatGPTSearch?.available(id, model, signal) ?? false,
    });
    registerChatGPT(scope, {
      onProviderRegistered: refreshFreeModels, webSearchSettings, getWebSearchEnabled,
      registerChatGPTSearch(search) {
        chatGPTSearch = search;
        return () => { if (chatGPTSearch === search) chatGPTSearch = undefined; };
      },
    });
  });
}
