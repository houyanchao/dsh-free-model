import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { listModels } from '../host/chatgpt/models.js';
import { createProvider, providerId } from '../host/provider.js';

test('ChatGPT applies configured and reported capabilities to the picker and outgoing requests', async t => {
  let upstream = [
    {
      slug: 'chat', display_name: 'Remote name', visibility: 'list',
      input_modalities: ['text'], supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
      supports_web_search: false, context_window: 2048, max_output_tokens: 512,
    },
    { slug: 'audio', display_name: 'Audio only', visibility: 'list', input_modalities: ['audio'] },
    { slug: 'extra', display_name: 'Extra', visibility: 'list' },
  ];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ models: upstream }));
  const sent = [];
  const session = { status: 'connected', sharing: true, profileId: 'alpha', accountSignal: new AbortController().signal };
  const adapter = createProvider({
    listModels: ({ signal }) => listModels('test-token', signal),
    streamResponse: async options => { sent.push(options); return { text: 'done' }; },
  }, async () => session, new AbortController().signal, {
    configuredModels: [
      { id: 'chat', name: 'Configured name', inputModalities: ['text', 'image'], reasoningEfforts: ['low', 'medium'],
        webSearch: true, contextWindow: 8192, maxCompletionTokens: 256 },
      { id: 'audio', inputModalities: ['text'] },
      { id: 'missing' },
    ],
    getWebSearchEnabled: () => true,
  });
  const models = await adapter.listModels();
  assert.deepEqual(models.map(model => model.id), ['chat']);
  assert.deepEqual(models[0], {
    provider: providerId, id: 'chat', name: 'Configured name', inputModalities: ['text'],
    reasoning: { efforts: [{ id: 'low', name: 'Low' }] }, webSearch: false,
    context: { contextWindow: 2048 }, maxCompletionTokens: 256,
  });
  const prepared = await adapter.prepareCall(providerId, 'chat');
  const run = async options => (await Array.fromAsync(prepared.stream({ model: 'chat', messages: [], ...options }))).at(-1).reason;
  assert.equal((await run({ reasoningEffort: 'high' })).failure.code, 'UNSUPPORTED_REASONING_EFFORT');
  assert.equal((await run({ messages: [{ role: 'user', content: [{ type: 'image' }] }] })).failure.code, 'UNSUPPORTED_CONTENT');
  assert.equal(sent.length, 0);
  assert.equal((await run({ maxTokens: 1024, reasoningEffort: 'low', tools: [{ name: 'web_search' }] })).kind, 'stop');
  assert.equal(sent[0].tools, undefined);
  assert.equal(sent[0].maxOutputTokens, 256);
  upstream = [];
  assert.deepEqual(await adapter.listPlanModels(true), []);
  assert.equal((await run({})).failure.code, 'NO_MODEL');
  assert.equal(sent.length, 1);
});

test('an empty ChatGPT config and requests for unconfigured models require no upstream catalog', async () => {
  let lookups = 0;
  const session = { status: 'connected', sharing: true, profileId: 'alpha' };
  const client = { listModels() { lookups++; return []; } };
  const create = configuredModels => createProvider(client, async () => session, new AbortController().signal, { configuredModels });
  assert.deepEqual(await create([]).listPlanModels(true), []);
  assert.deepEqual(await create([]).listModels(), []);
  await assert.rejects(create([{ id: 'known' }]).prepareCall(providerId, 'other'), { code: 'NO_MODEL' });
  assert.equal(lookups, 0);
});

test('cancelling prepareCall or stream stops that waiter and leaves a shared catalog lookup running', async () => {
  const reply = Promise.withResolvers();
  const session = { status: 'connected', sharing: true, profileId: 'alpha', accountSignal: new AbortController().signal };
  const lookupSignals = [];
  let sent = 0;
  const adapter = createProvider({
    listModels({ signal }) {
      lookupSignals.push(signal);
      return reply.promise;
    },
    streamResponse() { sent++; return { text: 'done' }; },
  }, async () => session, new AbortController().signal, { configuredModels: [{ id: 'chat' }] });

  const request = new AbortController();
  const prepared = adapter.prepareCall(providerId, 'chat', request.signal);
  const cancelledPrepare = assert.rejects(prepared, { name: 'AbortError' });
  const streaming = Array.fromAsync(adapter.stream({ model: 'chat', messages: [], signal: request.signal }));
  const surviving = adapter.prepareCall(providerId, 'chat');
  // Let all callers reach the outstanding catalog lookup before cancellation.
  await setImmediate();
  assert.equal(lookupSignals.length, 1);
  request.abort();
  try {
    const completed = Promise.all([cancelledPrepare, streaming]);
    const result = await Promise.race([completed, setImmediate('still waiting for the catalog')]);
    assert.ok(Array.isArray(result), 'cancelled waiters must finish before the catalog is released');
    const finish = result[1].at(-1);
    assert.equal(finish.reason.kind, 'aborted');
    assert.equal(finish.reason.failure.code, 'ABORTED');
    assert.equal(sent, 0);
    assert.equal(lookupSignals[0].aborted, false);
  } finally {
    reply.resolve([{ slug: 'chat', displayName: 'Chat' }]);
  }
  const call = await surviving;
  assert.equal((await Array.fromAsync(call.stream({ model: 'chat', messages: [] }))).at(-1).reason.kind, 'stop');
  assert.equal(sent, 1);
  assert.equal(lookupSignals.length, 1);
});
