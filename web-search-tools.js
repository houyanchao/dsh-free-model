import { KILO_PROVIDER } from './catalog.js';
import { providerId as chatGPTProvider } from './chatgpt/shared/identity.js';

const searchUnavailable = 'tools.web_search is unavailable for this conversation. You may use tools.web_fetch for a supplied URL if that tool is available.';

function isOpenModelProvider(provider) {
  return provider === KILO_PROVIDER || provider === chatGPTProvider;
}

/** Annotate DSH's programmatic tool catalog for the current model step. */
export function mountWebSearchPrompt(ctx, getEnabled) {
  return ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const presentation = await next();
    const { session, modelSelection, signal } = context;
    if (!session?.id || !isOpenModelProvider(modelSelection?.provider)) return presentation;
    if (presentation.sections.some(section => section.complete)) return presentation;
    const sdk = presentation.sections.find(section => section.name === 'tools:sdk' && !section.retire && section.text.trim());
    if (!sdk) return presentation;

    signal?.throwIfAborted();
    const enabled = await getEnabled(session.id, modelSelection.provider, modelSelection.model, signal);
    signal?.throwIfAborted();
    if (enabled === true || sdk.text.endsWith(searchUnavailable)) return presentation;
    return {
      ...presentation,
      sections: presentation.sections.map(section =>
        section === sdk ? { ...sdk, text: sdk.text + '\n\n' + searchUnavailable } : section),
    };
  }, { global: true });
}

/**
 * Enforce the conversation's search preference on native and nested PTC dispatch.
 * Recheck the effective setting when a tool is about to execute.
 */
export function mountWebSearchTools(ctx, getEnabled) {
  return ctx.on('tools/execute', async ({ name, agent, signal }, next) => {
    if (name !== 'web_search' || !agent?.session?.id) return next();

    // A model selection queued during streaming belongs to the next step. The
    // committed request header identifies the model that actually called the tool.
    const selection = agent.session.requestHeader()?.config;
    const provider = selection?.provider;
    if (!isOpenModelProvider(provider)) return next();

    // DSH runs this hook after approval and scheduling, immediately around dispatch.
    signal.throwIfAborted();
    const enabled = await getEnabled(agent.session.id, provider, selection.model, signal);
    signal.throwIfAborted();
    if (enabled !== true) throw new Error('Web search is turned off or unavailable for this conversation.');
    return next();
  }, { global: true });
}
