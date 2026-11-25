import { KILO_PROVIDER } from './catalog.js';

// The persistence header only records the initial preset. A blank conversation
// can select a different preset before its first turn.
async function recordedPreset(ctx, sessionId, session, presets, signal) {
  if (session.id === sessionId) return presets.presetForSession(session);
  const observation = await ctx.get('sessionQuery')?.observeSession(sessionId, { signal });
  if (!observation) return undefined;
  try {
    return observation.projections?.values.agentPreset;
  } finally {
    observation[Symbol.dispose]();
  }
}

async function hasSearchTool(ctx, sessionId, session, signal) {
  const tools = ctx.get('tools');
  if (!tools) return false;
  const agents = ctx.get('agents');
  const agent = agents?.get(sessionId);
  if (agent) return Boolean(tools.get('web_search', agent));
  if (!session) return false;
  const presets = ctx.get('agentPresets');
  if (!presets) return Boolean(tools.get('web_search'));

  const preset = await recordedPreset(ctx, sessionId, session, presets, signal);
  // The projection returns null for the default preset. Undefined means no
  // projection was available to tell us which scope the conversation will use.
  if (preset === undefined) return false;
  signal?.throwIfAborted();
  const lease = await presets.acquireScope(preset ?? undefined);
  try {
    signal?.throwIfAborted();
    return Boolean(tools.get('web_search', agents?.get(sessionId) ?? lease.key));
  } finally {
    await lease[Symbol.asyncDispose]();
  }
}

/** Check Kilo tool support and DSH's session-scoped search readiness without issuing a search. */
export async function kiloSearchAvailable(ctx, sessionId, modelId, catalog, session, signal) {
  signal?.throwIfAborted();
  const web = ctx.get('web');
  // DSH's searchReady also returns true on provider selection errors, including
  // an empty registry. listProviders reports installed providers, independently of credentials.
  if (!web?.listProviders().search.length) return false;
  const model = await catalog.getModel(modelId, signal);
  if (!model?.supportedParameters.includes('tools') || model.webSearch === false) return false;
  if (!await hasSearchTool(ctx, sessionId, session, signal)) return false;
  const ready = await web.searchReady(KILO_PROVIDER);
  signal?.throwIfAborted();
  return ready;
}
