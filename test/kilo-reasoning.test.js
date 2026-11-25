import assert from 'node:assert/strict';
import test from 'node:test';
import { createKiloCatalog, KILO_BASE_URL, KILO_PROVIDER } from '../catalog.js';
import { createKiloAdapter } from '../index.js';

const off = { enabled: false, effort: 'none' };
const medium = { enabled: true, effort: 'medium' };
const high = { enabled: true, effort: 'high' };

function freeModel(id, opencode, supportedParameters = ['reasoning']) {
  return {
    id, isFree: true, pricing: { prompt: 0, completion: 0 },
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    supported_parameters: supportedParameters, opencode,
  };
}

function setup() {
  const models = [
    freeModel('levels', {
      reasoning_options: [{ type: 'effort', values: ['none', 'medium', 'high'] }],
      variants: { none: { reasoning: off }, medium: { reasoning: medium }, high: { reasoning: high } },
    }),
    freeModel('toggle', {
      reasoning_options: [{ type: 'toggle' }],
      variants: { instant: { reasoning: off }, thinking: { reasoning: high } },
    }),
    freeModel('high-only', {
      reasoning_options: [{ type: 'effort', values: ['high'] }],
      variants: { high: { reasoning: high } },
    }),
    freeModel('flat', { reasoning_options: [{ type: 'effort', values: ['low'] }] }, ['reasoning_effort']),
    freeModel('fixed', { reasoning_options: [], variants: { thinking: { reasoning: high } } }),
    freeModel('auto', {}),
  ];
  const requests = [];
  async function fetch(url, options) {
    if (url === KILO_BASE_URL + '/models') return Response.json({ data: models });
    assert.equal(url, KILO_BASE_URL + '/chat/completions');
    requests.push(JSON.parse(options.body));
    return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  }
  const catalog = createKiloCatalog({ fetch, configuredModels: models.map(({ id }) => ({ id })) });
  const adapter = createKiloAdapter({ fetch, catalog });
  return { adapter, requests };
}

async function finish(stream, model, reasoningEffort) {
  const chunks = await Array.fromAsync(stream({
    provider: KILO_PROVIDER, model, reasoningEffort,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
  }));
  assert.equal(chunks.at(-1)?.type, 'finish');
  return chunks.at(-1).reason;
}

test('Kilo exposes only advertised choices consistently in the picker and prepared calls', async () => {
  const { adapter } = setup();
  const expected = new Map([
    ['levels', ['none', 'medium', 'high']], ['toggle', ['instant', 'thinking']],
    ['high-only', ['high']], ['flat', ['low']], ['fixed', undefined], ['auto', undefined],
  ]);
  const models = await adapter.listModels();
  assert.equal(models.length, expected.size);
  for (const model of models) {
    assert.ok(expected.has(model.id));
    assert.deepEqual(model.reasoning?.efforts.map(effort => effort.id), expected.get(model.id), model.id);
    assert.equal(model.reasoning?.defaultEffort, undefined, model.id);
    for (const effort of model.reasoning?.efforts ?? []) assert.ok(effort.name.trim());
    const resolved = await adapter.resolveModel(KILO_PROVIDER, model.id);
    const prepared = await adapter.prepareCall(KILO_PROVIDER, model.id);
    assert.deepEqual(resolved.reasoning, model.reasoning);
    assert.deepEqual(prepared.model.reasoning, model.reasoning);
  }
});

test('Kilo sends the selected variant and preserves the gateway default when no choice is made', async () => {
  const { adapter, requests } = setup();
  const { stream } = await adapter.prepareCall(KILO_PROVIDER, 'levels');
  for (const [id, payload] of [['medium', medium], ['none', off], ['high', high]]) {
    assert.equal((await finish(stream, 'levels', id)).kind, 'stop');
    assert.deepEqual(requests.at(-1).reasoning, payload);
  }
  for (const [id, payload] of [['instant', off], ['thinking', high]]) {
    assert.equal((await finish(adapter.stream, 'toggle', id)).kind, 'stop');
    assert.deepEqual(requests.at(-1).reasoning, payload);
  }
  assert.equal((await finish(adapter.stream, 'flat', 'low')).kind, 'stop');
  assert.equal(requests.at(-1).reasoning_effort, 'low');
  assert.ok(!Object.hasOwn(requests.at(-1), 'reasoning'));
  for (const id of ['levels', 'toggle', 'flat', 'fixed', 'auto']) {
    assert.equal((await finish(adapter.stream, id)).kind, 'stop');
    assert.ok(!Object.hasOwn(requests.at(-1), 'reasoning'), id);
    assert.ok(!Object.hasOwn(requests.at(-1), 'reasoning_effort'), id);
  }
});

test('Kilo rejects an unsupported selection without sending a completion request', async () => {
  const { adapter, requests } = setup();
  for (const [model, effort] of [['levels', 'low'], ['toggle', 'high'], ['fixed', 'thinking'], ['auto', 'high']]) {
    const reason = await finish(adapter.stream, model, effort);
    assert.equal(reason.kind, 'error', model);
    assert.equal(requests.length, 0, model);
  }
});
