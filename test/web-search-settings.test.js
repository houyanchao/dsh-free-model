import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { KILO_PROVIDER } from '../catalog.js';
import { providerId as chatGPTProvider } from '../chatgpt/shared/identity.js';
import { createWebSearchSettings, mountWebSearchSettings } from '../web-search-settings.js';

async function profileDirectory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-search-options-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('per-profile search preferences distinguish unset and off and survive concurrent writes', async t => {
  const directory = await profileDirectory(t);
  const settings = createWebSearchSettings(directory);
  assert.equal(await settings.read('Session'), undefined);
  await Promise.all([
    settings.write('Session', false),
    settings.write('session', true),
    settings.write('Session', true),
    settings.write('Session', false),
  ]);
  const reopened = createWebSearchSettings(directory);
  assert.equal(await reopened.read('Session'), false);
  assert.equal(await reopened.read('session'), true);
  assert.equal(await createWebSearchSettings(join(directory, 'second-profile')).read('session'), undefined);
});

async function workspace(t) {
  const settings = createWebSearchSettings(await profileDirectory(t));
  const active = { header: {} };
  const child = { header: { origin: 'subagent' } };
  const history = { header: { agentPreset: 'saved-preset' } };
  const stat = t.mock.fn(async id => new Map([['history', history], ['history-child', child]]).get(id));
  const services = {
    sessions: new Map([['live', active], ['child', child]]),
    sessionPersistence: { stat },
  };
  let route;
  const capabilities = new Map([[KILO_PROVIDER, 'free/model'], [chatGPTProvider, 'plan-model']]);
  const isAvailable = t.mock.fn(async (_id, provider, model) => {
    if (capabilities.get(provider) === 'offline') throw new Error('offline');
    return capabilities.get(provider) === model;
  });
  mountWebSearchSettings({
    get(name) { return services[name]; },
    connection: { fetch: { register(value) { route = value; } } },
  }, {
    settings,
    async getEnabled(id, provider) { return await settings.read(id) ?? provider === chatGPTProvider; },
    isAvailable,
  });
  async function call(params = {}, body) {
    const url = new URL('/api/dsh-open-model/web-search', 'http://localhost');
    assert.equal(url.pathname, route.path);
    url.search = new URLSearchParams({ sessionId: 'live', provider: KILO_PROVIDER, model: 'free/model', ...params });
    const request = new Request(url, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
    const result = await route.fetch(request);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    return { status: result.status, body: await result.json() };
  }
  return { settings, capabilities, call, stat, isAvailable, active, history };
}

test('a native session carries its explicit search choice between providers, including saved history', async t => {
  const { call, stat, isAvailable, active, history } = await workspace(t);
  const plan = { provider: chatGPTProvider, model: 'plan-model' };
  assert.deepEqual((await call(plan)).body, { enabled: true, available: true });
  assert.equal(isAvailable.mock.calls.at(-1).arguments[3], active);
  assert.deepEqual((await call()).body, { enabled: false, available: true });
  assert.deepEqual((await call({}, { enabled: true })).body, { enabled: true, available: true });
  assert.deepEqual((await call(plan, { enabled: false })).body, { enabled: false, available: true });
  assert.deepEqual((await call(plan)).body, { enabled: false, available: true });
  assert.deepEqual((await call()).body, { enabled: false, available: true });
  assert.deepEqual((await call({ ...plan, sessionId: 'history' })).body, { enabled: true, available: true });
  assert.equal((await call({ sessionId: 'history' }, { enabled: true })).status, 200);
  const [, , , checkedSession, signal] = isAvailable.mock.calls.at(-1).arguments;
  assert.equal(checkedSession, history);
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal, stat.mock.calls.at(-1).arguments[1].signal);
});

test('missing sessions, subagents and invalid inputs cannot create search preferences', async t => {
  const { call, settings } = await workspace(t);
  for (const id of ['missing', 'child', 'history-child']) {
    assert.equal((await call({ sessionId: id })).status, 403);
    assert.equal((await call({ sessionId: id }, { enabled: true })).status, 403);
    assert.equal(await settings.read(id), undefined);
  }
  for (const params of [{ sessionId: '../invalid' }, { provider: 'other' }, { model: ' ' }]) {
    assert.equal((await call(params, { enabled: true })).status, 400);
  }
  for (const invalid of [null, {}, { enabled: 'false' }, { enabled: false, sessionId: 'child' }]) {
    assert.equal((await call({}, invalid)).status, 400);
  }
  assert.equal(await settings.read('live'), undefined);
});

test('unsupported models cannot enable search and an offline provider permits explicit opt-out', async t => {
  const { call, settings, capabilities } = await workspace(t);
  const plan = { provider: chatGPTProvider, model: 'plan-model' };
  assert.equal((await call({ model: 'other' }, { enabled: true })).status, 409);
  assert.equal(await settings.read('live'), undefined);
  capabilities.set(chatGPTProvider, 'offline');
  assert.deepEqual((await call(plan)).body, { enabled: true, available: false });
  assert.deepEqual(await call(plan, { enabled: false }), { status: 200, body: { enabled: false, available: false } });
  assert.equal(await settings.read('live'), false);
  assert.equal((await call(plan, { enabled: true })).status, 503);
  assert.equal(await settings.read('live'), false);
});
