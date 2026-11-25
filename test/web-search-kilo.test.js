import assert from 'node:assert/strict';
import test from 'node:test';
import { KILO_PROVIDER } from '../catalog.js';
import { createKiloAdapter } from '../index.js';

const options = {
  model: 'free', sessionId: 'chat', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  tools: ['web_search', 'web_fetch', 'read_file'].map(name => ({
    name, description: name, parameters: { type: 'object', properties: {} },
  })),
};

function setup() {
  const preferences = new Map();
  const bodies = [];
  let toolName = 'web_fetch';
  const adapter = createKiloAdapter({
    catalog: { getModel: async id => ({ id, supportedParameters: id === 'no-tools' ? [] : ['tools'] }) },
    async getWebSearchEnabled(sessionId, provider) {
      assert.equal(provider, KILO_PROVIDER);
      return preferences.get(sessionId) ?? false;
    },
    async fetch(_url, init) {
      bodies.push(JSON.parse(init.body));
      const choice = toolName
        ? { delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: toolName, arguments: '{}' } }] }, finish_reason: 'tool_calls' }
        : { delta: { content: 'hello' }, finish_reason: 'stop' };
      return new Response('data: ' + JSON.stringify({ choices: [choice] }) + '\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  return { adapter, preferences, bodies, replyWith: name => { toolName = name; } };
}

test('Kilo checks the current conversation setting at send time in both adapter entry points', async () => {
  const { adapter, preferences, bodies, replyWith } = setup();
  const prepared = await adapter.prepareCall(KILO_PROVIDER, options.model);
  for (const stream of [prepared.stream, adapter.stream]) {
    for (const enabled of [false, true]) {
      preferences.set(options.sessionId, enabled);
      const expected = enabled ? ['web_search', 'web_fetch', 'read_file'] : ['web_fetch', 'read_file'];
      replyWith(expected[0]);
      const chunks = await Array.fromAsync(stream(options));
      assert.deepEqual(bodies.at(-1).tools.map(tool => tool.function.name), expected);
      assert.equal(chunks.find(chunk => chunk.type === 'block-end')?.block.name, expected[0]);
      assert.equal(chunks.at(-1).reason.kind, 'tool-calls');
    }
  }
  replyWith(undefined);
  await Array.fromAsync(adapter.stream({ ...options, sessionId: 'other', tools: [options.tools[0]] }));
  assert.equal(bodies.at(-1).tools, undefined);
});

test('Kilo never completes or emits the name of a search call the request did not offer', async () => {
  const { adapter, preferences, bodies, replyWith } = setup();
  replyWith('web_search');
  for (const enabled of [false, true]) {
    preferences.set(options.sessionId, enabled);
    const tools = enabled ? [options.tools[1]] : options.tools;
    const chunks = await Array.fromAsync(adapter.stream({ ...options, tools }));
    assert.ok(!bodies.at(-1).tools.some(tool => tool.function.name === 'web_search'));
    assert.ok(!chunks.some(chunk => chunk.name === 'web_search' || chunk.type === 'block-end'));
    assert.equal(chunks.at(-1).reason.failure.code, 'MALFORMED_RESPONSE');
  }
});

test('Kilo can still send text on a model without tool support when the session enables search', async () => {
  const { adapter, preferences, bodies, replyWith } = setup();
  preferences.set(options.sessionId, true);
  replyWith(undefined);
  const chunks = await Array.fromAsync(adapter.stream({ ...options, model: 'no-tools', tools: [options.tools[0]] }));
  assert.equal(bodies.at(-1).tools, undefined);
  assert.equal(chunks.at(-1).reason.kind, 'stop');
});
