import assert from 'node:assert/strict';
import test from 'node:test';
import { createKiloCatalog } from '../catalog.js';
import { registerModelManagement } from '../model-management.js';

function upstream(id, patch = {}) {
  return {
    id, name: id.toUpperCase(), isFree: true, pricing: { prompt: '0', completion: '0' },
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    supported_parameters: ['tools', 'max_tokens'], top_provider: { max_completion_tokens: 2048 },
    ...patch,
  };
}

test('Kilo keeps config order, disables absent, expired and paid rows, and never adds upstream rows', async () => {
  let rows = [upstream('extra'), upstream('first'), upstream('paid', { pricing: { prompt: 1, completion: 0 } }),
    upstream('second'), upstream('expired', { expiration_date: '2020-01-01' })];
  const configuredModels = [
    { id: 'second', name: 'Featured', inputModalities: ['text'], maxCompletionTokens: 128 },
    { id: 'missing' }, { id: 'first' }, { id: 'paid' }, { id: 'expired' },
  ];
  const fetch = async () => Response.json({ data: rows });
  const catalog = createKiloCatalog({ fetch, configuredModels });
  const directory = await catalog.listConfiguredModels();
  assert.deepEqual(directory.map(row => [row.id, row.available]), [
    ['second', true], ['missing', false], ['first', true], ['paid', false], ['expired', false],
  ]);
  assert.equal(directory[1].unavailableReason, 'not-offered');
  const [second] = await catalog.listModels();
  assert.equal(second.name, 'Featured');
  assert.deepEqual(second.inputModalities, ['text']);
  assert.equal(second.maxCompletionTokens, 128);
  assert.deepEqual((await catalog.listModels()).map(row => row.id), ['second', 'first']);
  assert.equal(await catalog.getModel('extra'), undefined);
  assert.equal(await catalog.getModel('paid'), undefined);
  rows = [upstream('second'), upstream('missing')];
  assert.deepEqual((await catalog.listModels(undefined, { refresh: true })).map(row => row.id), ['second', 'missing']);
  assert.equal(await catalog.getModel('first'), undefined);
});

test('Kilo lists capped models only when the request or provider can enforce the limit', async () => {
  const rows = [
    upstream('adjustable', { supported_parameters: ['max_completion_tokens'] }),
    upstream('bounded', { supported_parameters: [], top_provider: { max_completion_tokens: 16 } }),
    upstream('exact', { supported_parameters: [], top_provider: { max_completion_tokens: 32 } }),
    upstream('too-large', { supported_parameters: [] }),
    upstream('unknown', { supported_parameters: [], top_provider: {} }),
    upstream('uncapped', { supported_parameters: [], top_provider: {} }),
  ];
  const catalog = createKiloCatalog({
    configuredModels: rows.map(({ id }) => id === 'uncapped' ? { id } : { id, maxCompletionTokens: 32 }),
    fetch: async () => Response.json({ data: rows }),
  });
  const directory = await catalog.listConfiguredModels();
  const rejected = directory.filter(row => !row.available);
  assert.deepEqual(rejected.map(row => [row.id, row.unavailableReason]), [
    ['too-large', 'output-limit-unenforceable'], ['unknown', 'output-limit-unenforceable'],
  ]);
  assert.equal(await catalog.getModel('too-large'), undefined);
  assert.equal(await catalog.getModel('unknown'), undefined);
  assert.deepEqual((await catalog.listModels()).map(row => [row.id, row.maxCompletionTokens]), [
    ['adjustable', 32], ['bounded', 16], ['exact', 32], ['uncapped', undefined],
  ]);
});

test('failed checks disable configured models until recovery and cannot be bypassed by a cached request', async () => {
  let response = () => Response.json({ data: [upstream('first')] });
  const catalog = createKiloCatalog({ configuredModels: [{ id: 'first' }], fetch: () => response() });
  assert.equal((await catalog.getModel('first')).id, 'first');
  const pending = Promise.withResolvers();
  response = () => pending.promise;
  const refresh = catalog.listConfiguredModels(undefined, { refresh: true });
  const checkedDuringRefresh = catalog.getModel('first');
  pending.reject(new Error('offline'));
  assert.equal((await refresh)[0].unavailableReason, 'provider-unavailable');
  await assert.rejects(checkedDuringRefresh, { code: 'TRANSPORT' });
  assert.deepEqual(await catalog.listModels(), []);
  response = () => Response.json({ data: [upstream('first')] });
  assert.equal((await catalog.listConfiguredModels(undefined, { refresh: true }))[0].available, true);
});

test('an empty Kilo config and unconfigured direct calls do not look up other models', async () => {
  const fetch = () => assert.fail('Kilo was queried for an unconfigured model');
  const empty = createKiloCatalog({ configuredModels: [], fetch });
  assert.deepEqual(await empty.listConfiguredModels(), []);
  assert.deepEqual(await empty.listModels(), []);
  const catalog = createKiloCatalog({ configuredModels: [{ id: 'configured' }], fetch });
  assert.equal(await catalog.getModel('extra'), undefined);
});

test('management disables unavailable rows and restores their saved visibility after recovery', async () => {
  const configuredModels = [{ id: 'first', maxCompletionTokens: 32 }, { id: 'second' }];
  let rows = [];
  const catalog = createKiloCatalog({ configuredModels, fetch: async () => Response.json({ data: rows }) });
  const routes = new Map();
  registerModelManagement({
    effect() {},
    connection: { fetch: { register(route) { routes.set(route.path, route); } } },
  }, {
    catalog,
    visibility: { readDisabled: async () => id => id === 'second' },
    onChange() {},
  });
  const path = '/api/dsh-free-model/models';
  const request = new Request('http://localhost' + path + '?refresh=1');
  async function states() {
    const response = await routes.get(path).fetch(request);
    assert.equal(response.status, 200);
    return (await response.json()).models.map(({ id, available, enabled }) => [id, available, enabled]);
  }
  assert.deepEqual(await states(), [['first', false, false], ['second', false, false]]);
  rows = [upstream('second'), upstream('first')];
  assert.deepEqual(await states(), [['first', true, true], ['second', true, false]]);
  rows[1].supported_parameters = [];
  const { models } = await (await routes.get(path).fetch(request)).json();
  assert.equal(models[0].unavailableReason, 'output-limit-unenforceable');
  assert.equal(models[0].enabled, false);
});
