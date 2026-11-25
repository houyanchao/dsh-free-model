import assert from 'node:assert/strict';
import test from 'node:test';
import { KILO_PROVIDER } from '../catalog.js';
import { createProvider, providerId } from '../chatgpt/host/provider.js';
import { createKiloAdapter } from '../index.js';
import { parseModelSources } from '../model-config.js';
import sources from '../models.json' with { type: 'json' };

test('each model source keeps its title, model order and independent model IDs', () => {
  const config = {
    chatgpt: { name: 'My plan', models: [{ id: 'z' }, { id: 'a', name: 'On my plan' }] },
    kilo: { name: 'Free models', models: [{ id: 'a', name: 'Free edition' }] },
  };
  const parsed = parseModelSources(config);
  assert.deepEqual([...parsed.keys()], ['chatgpt', 'kilo']);
  assert.deepEqual(parsed.get('chatgpt'), config.chatgpt);
  assert.deepEqual(parsed.get('kilo'), config.kilo);
});

test('legacy model arrays keyed by source still load', () => {
  const models = [{ id: 'classic', webSearch: false }];
  const parsed = parseModelSources({ kilo: models, chatgpt: [] });
  assert.deepEqual(parsed.get('kilo'), { models });
  assert.deepEqual(parsed.get('chatgpt'), { models: [] });
});

test('duplicate model IDs and incomplete or invalid model configuration fail validation', () => {
  const source = { name: 'Free models', models: [] };
  assert.throws(() => parseModelSources({ kilo: { name: source.name } }), TypeError);
  assert.throws(() => parseModelSources({ kilo: { ...source, models: [{ id: 'a' }, { id: 'a' }] } }), TypeError);
  for (const capability of [
    { inputModalities: ['audio'] }, { reasoningEfforts: ['high', 'high'] },
    { webSearch: 'false' }, { contextWindow: 0 }, { maxCompletionTokens: -1 },
  ]) {
    const models = [{ id: 'example', ...capability }];
    assert.throws(() => parseModelSources({ kilo: { ...source, models } }), TypeError);
    assert.throws(() => parseModelSources({ kilo: models }), TypeError);
  }
});

test('both adapters expose the configured source title under their stable DSH provider IDs', () => {
  const kilo = createKiloAdapter();
  const chatgpt = createProvider({}, async () => ({}), new AbortController().signal);
  for (const [source, id, adapter] of [['kilo', KILO_PROVIDER, kilo], ['chatgpt', providerId, chatgpt]]) {
    const configured = sources[source];
    assert.equal(typeof configured?.name, 'string');
    assert.deepEqual(adapter.providerInfo(id), { id, name: configured.name });
  }
});
