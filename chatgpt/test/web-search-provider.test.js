import assert from 'node:assert/strict';
import test from 'node:test';
import { createProvider, providerId } from '../host/provider.js';

test('a session’s search switch controls ChatGPT hosted and DSH search on every request', async () => {
  const settings = new Map([['session-a', false], ['session-b', true]]);
  const session = { status: 'connected', sharing: true, profileId: 'profile' };
  let lastRequest;
  let output = [];
  const client = {
    listModels: async () => [{ slug: 'test-model', displayName: 'Test model' }],
    async streamResponse(request) {
      lastRequest = request;
      return { text: 'ok', output };
    },
  };
  const adapter = createProvider(client, async () => session, new AbortController().signal, {
    configuredModels: [{ id: 'test-model' }],
    async getWebSearchEnabled(id, provider) {
      assert.equal(provider, providerId);
      return settings.get(id);
    },
    getPreferences: () => assert.fail('the shared policy owns this setting'),
  });
  const prepared = await adapter.prepareCall(providerId, 'test-model');
  const tools = ['web_search', 'web_fetch', 'other_tool'].map(name => ({
    name, description: name, parameters: { type: 'object' },
  }));
  const send = (sessionId, purpose) => Array.fromAsync(prepared.stream({
    provider: providerId, model: 'test-model', sessionId, purpose, messages: [], tools,
  }));
  const localNames = () => lastRequest.tools[0].tools.map(tool => tool.name);
  const hasHostedSearch = () => lastRequest.tools.some(tool => tool.type === 'web_search');

  assert.equal((await send('session-b')).at(-1).reason.kind, 'stop');
  assert.deepEqual(localNames(), ['web_search', 'web_fetch', 'other_tool']);
  assert.equal(hasHostedSearch(), true);
  await send('session-b', 'session-title');
  assert.equal(hasHostedSearch(), false);

  output = [{ type: 'function_call', name: 'web_search', call_id: 'call_1', arguments: '{}' }];
  const denied = await send('session-a');
  assert.deepEqual(localNames(), ['web_fetch', 'other_tool']);
  assert.equal(hasHostedSearch(), false);
  assert.equal(denied.at(-1).reason.failure.code, 'UNEXPECTED_TOOL_CALL');
  assert.ok(denied.every(chunk => chunk.type !== 'tool-call-delta'));

  output[0] = { ...output[0], name: 'web_fetch' };
  const fetch = await send('session-a');
  assert.equal(fetch.at(-1).reason.kind, 'tool-calls');
  assert.ok(fetch.some(chunk => chunk.type === 'tool-call-delta' && chunk.name === 'web_fetch'));

  settings.set('session-a', true);
  output[0] = { ...output[0], name: 'web_search' };
  assert.equal((await send('session-a')).at(-1).reason.kind, 'tool-calls');
  assert.equal(hasHostedSearch(), true);
});
