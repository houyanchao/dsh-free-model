import assert from 'node:assert/strict';
import test from 'node:test';
import { KILO_PROVIDER } from '../catalog.js';
import { kiloSearchAvailable } from '../web-search-availability.js';

const model = { supportedParameters: ['tools'] };
const catalog = { getModel: async id => id === 'tool-model' ? model : { supportedParameters: [] } };
const snapshot = { header: { id: 'conversation', agentPreset: 'original' } };

function fixture() {
  const agent = {};
  const presetScope = {};
  const reads = [];
  const services = {
    agents: { get: () => agent },
    tools: {
      get(name, scope) {
        assert.equal(name, 'web_search');
        assert.ok(scope === agent || scope === presetScope);
        return {};
      },
    },
    sessionQuery: {
      async observeSession(id) {
        assert.equal(id, 'conversation');
        return {
          projections: { values: { agentPreset: 'changed' } },
          [Symbol.dispose]: () => reads.push('release observation'),
        };
      },
    },
    agentPresets: {
      async acquireScope(id) {
        reads.push(['preset', id]);
        return { key: presetScope, [Symbol.asyncDispose]: async () => { reads.push('release preset'); } };
      },
    },
    web: {
      listProviders: () => ({ search: [{ id: 'search-service' }] }),
      searchReady: async route => { reads.push(['ready', route]); return true; },
    },
  };
  const ctx = { get: name => services[name] };
  return {
    services, reads, agent, presetScope,
    check: (id = 'tool-model', session = snapshot, signal) => kiloSearchAvailable(ctx, 'conversation', id, catalog, session, signal),
  };
}

test('checks Kilo tool support, visibility in the exact live agent, and selected provider credentials', async () => {
  const { services, reads, agent, check } = fixture();
  assert.equal(await check('text-only'), false);
  assert.deepEqual(reads, []);
  assert.equal(await check(), true);
  assert.deepEqual(reads, [['ready', KILO_PROVIDER]]);
  services.tools.get = (_name, scope) => { assert.equal(scope, agent); };
  assert.equal(await check(), false);
  services.tools.get = () => ({});
  services.web.searchReady = async () => false;
  assert.equal(await check(), false);
  services.web.listProviders = () => ({ search: [] });
  services.web.searchReady = () => assert.fail('an empty provider list is unavailable');
  assert.equal(await check(), false);
});

test('cold history uses its latest projected preset, including changes after creation, and releases both leases', async () => {
  const { services, reads, presetScope, check } = fixture();
  services.agents.get = () => undefined;
  services.tools.get = (_name, scope) => { assert.equal(scope, presetScope); return undefined; };
  assert.equal(await check(), false);
  assert.deepEqual(reads, ['release observation', ['preset', 'changed'], 'release preset']);
  reads.length = 0;
  services.tools.get = () => { throw new Error('registry unavailable'); };
  await assert.rejects(check(), /registry unavailable/);
  assert.deepEqual(reads, ['release observation', ['preset', 'changed'], 'release preset']);
});

test('a retained Session can use its preset projection directly, while unknown cold history stays unavailable', async () => {
  const { services, reads, check } = fixture();
  services.agents.get = () => undefined;
  const session = { id: 'conversation', header: snapshot.header };
  services.agentPresets.presetForSession = observed => { assert.equal(observed, session); return null; };
  services.sessionQuery = undefined;
  assert.equal(await check('tool-model', session), true);
  assert.deepEqual(reads, [['preset', undefined], 'release preset', ['ready', KILO_PROVIDER]]);
  assert.equal(await check(), false);
});
