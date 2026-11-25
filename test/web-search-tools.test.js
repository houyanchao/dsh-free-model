import assert from 'node:assert/strict';
import test from 'node:test';
import { KILO_PROVIDER } from '../catalog.js';
import { providerId as chatGPTProvider } from '../chatgpt/shared/identity.js';
import { mountWebSearchPrompt, mountWebSearchTools } from '../web-search-tools.js';

function host(getEnabled) {
  let dispatch;
  const calls = [];
  mountWebSearchTools({
    on(event, handler, options) {
      assert.equal(event, 'tools/execute');
      assert.equal(options.global, true);
      dispatch = handler;
    },
  }, getEnabled);
  return {
    calls,
    execute(name, agent, fields = {}) {
      return dispatch({ name, agent, signal: new AbortController().signal, ...fields }, () => {
        calls.push(name);
        return name;
      });
    },
  };
}

function agent(id, lastProvider, nextProvider = lastProvider) {
  return {
    session: { id, requestHeader: () => lastProvider && { config: { provider: lastProvider } } },
    model: { current: () => ({ provider: nextProvider }) },
  };
}

test('native and nested PTC search use the latest preference for the calling route and session', async () => {
  const enabled = new Map([['b', true]]);
  const reads = [];
  const harness = host(async (id, provider) => {
    reads.push([id, provider]);
    return enabled.get(id) ?? false;
  });
  const kilo = agent('a', KILO_PROVIDER, 'other-provider');
  const chatGPT = agent('b', chatGPTProvider);
  const nested = { parent: Symbol('run_code') };
  const pending = await Promise.allSettled([
    harness.execute('web_search', kilo),
    harness.execute('web_search', chatGPT, nested),
  ]);
  assert.match(pending[0].reason.message, /turned off/);
  assert.equal(pending[1].value, 'web_search');
  enabled.set('a', true);
  enabled.set('b', false);
  assert.equal(await harness.execute('web_search', kilo), 'web_search');
  await assert.rejects(harness.execute('web_search', chatGPT, nested), /turned off/);
  assert.deepEqual(harness.calls, ['web_search', 'web_search']);
  assert.deepEqual(reads, [['a', KILO_PROVIDER], ['b', chatGPTProvider], ['a', KILO_PROVIDER], ['b', chatGPTProvider]]);
});

test('URL fetches, PTC transport, other providers and agentless calls keep their host behavior', async () => {
  const harness = host(() => assert.fail('unexpected preference read'));
  const managed = agent('a', KILO_PROVIDER);
  await harness.execute('web_fetch', managed);
  await harness.execute('run_code', managed);
  await harness.execute('web_search', agent('b', 'other-provider', chatGPTProvider));
  await harness.execute('web_search', undefined);
  await harness.execute('web_search', agent('c', undefined));
  assert.deepEqual(harness.calls, ['web_fetch', 'run_code', 'web_search', 'web_search', 'web_search']);
});

test('failure to read the preference or cancellation during the read cannot dispatch a search', async () => {
  const controller = new AbortController();
  const managed = agent('a', KILO_PROVIDER);
  const failed = host(async () => { throw new Error('preference read failed'); });
  await assert.rejects(failed.execute('web_search', managed), /preference read failed/);
  const cancelled = host(async () => { controller.abort(); return true; });
  await assert.rejects(cancelled.execute('web_search', managed, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(failed.calls, []);
  assert.deepEqual(cancelled.calls, []);
});

function promptHost(getEnabled) {
  return mountWebSearchPrompt({
    on(event, handler, options) {
      assert.equal(event, 'system-prompt/assemble');
      assert.equal(options.global, true);
      return handler;
    },
  }, getEnabled);
}

test('PTC instructions follow each model step and preserve sections returned by other listeners', async () => {
  const context = { session: { id: 'a' }, modelSelection: { provider: KILO_PROVIDER, model: 'free' }, signal: new AbortController().signal };
  const sdk = Object.freeze({ name: 'tools:sdk', order: 5000, text: 'SDK with {{literal}}', interpolate: false, replacement: 'New SDK:' });
  const other = Object.freeze({ name: 'custom', order: 10, text: 'Use {{variable}}.' });
  const presentation = Object.freeze({ sections: Object.freeze([other, sdk]), contexts: [], variables: { variable: 'custom' } });
  let enabled = false;
  const reads = [];
  const present = promptHost(async (...args) => { reads.push(args); return enabled; });
  const assemble = () => present({ sections: [] }, context, async () => presentation);

  const off = await assemble();
  assert.equal(off.sections[0], other);
  assert.equal(off.contexts, presentation.contexts);
  assert.equal(off.variables, presentation.variables);
  assert.deepEqual(off.sections[1], { ...sdk, text: off.sections[1].text });
  assert.ok(off.sections[1].text.startsWith(sdk.text + '\n\n'));
  assert.match(off.sections[1].text, /tools\.web_search is unavailable/);
  assert.match(off.sections[1].text, /tools\.web_fetch for a supplied URL if that tool is available/);
  assert.equal(await present({}, context, async () => off), off);
  enabled = true;
  assert.equal(await assemble(), presentation);
  enabled = false;
  context.modelSelection = { provider: chatGPTProvider, model: 'plan' };
  assert.deepEqual((await assemble()).sections, off.sections);
  context.modelSelection = { provider: 'other', model: 'other' };
  assert.equal(await assemble(), presentation);
  assert.deepEqual(reads, [
    ...Array(3).fill(['a', KILO_PROVIDER, 'free', context.signal]), ['a', chatGPTProvider, 'plan', context.signal],
  ]);
});

test('PTC guidance skips registry previews, empty or retired SDK sections and complete prompts', async () => {
  const present = promptHost(() => assert.fail('unexpected preference read'));
  const context = { session: { id: 'a' }, modelSelection: { provider: KILO_PROVIDER, model: 'free' } };
  const sdk = { name: 'tools:sdk', text: 'tools' };
  for (const sections of [[], [{ ...sdk, text: '  ' }], [{ ...sdk, retire: true }], [sdk, { name: 'custom', complete: true, text: 'only this' }]]) {
    const result = { sections };
    assert.equal(await present({}, context, async () => result), result);
  }
  const result = { sections: [sdk] };
  assert.equal(await present({}, { modelSelection: context.modelSelection }, async () => result), result);
  assert.equal(await present({}, { session: context.session }, async () => result), result);
});

test('PTC guidance propagates waterfall failures and observes cancellation after the settings read', async () => {
  const controller = new AbortController();
  const context = { session: { id: 'a' }, modelSelection: { provider: KILO_PROVIDER, model: 'free' }, signal: controller.signal };
  const present = promptHost(async () => { controller.abort(); return false; });
  await assert.rejects(present({}, context, async () => { throw new Error('upstream failure'); }), /upstream failure/);
  await assert.rejects(present({}, context, async () => ({ sections: [{ name: 'tools:sdk', text: 'SDK' }] })), { name: 'AbortError' });
});
