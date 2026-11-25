import assert from 'node:assert/strict';
import test from 'node:test';
import { createUsageStore } from '../host/activity.js';
import { mountChatOptions } from '../host/chat-options.js';
import { defaultChatOptions } from '../shared/chat-options.js';

test('the authorized legacy route uses the shared search preference and keeps schema options profile-scoped', async t => {
  const id = 'chatgpt-old-session';
  const profile = 'profile-a';
  const session = { profileId: profile, status: 'connected', sharing: true };
  const schema = '{"type":"object","properties":{},"additionalProperties":false,"required":[]}';
  const usageStore = createUsageStore();
  t.after(() => usageStore.close());
  usageStore.associate(id, profile, { webSearch: true, jsonSchema: '' });
  const settings = new Map();
  let fetch;
  const webSearchSettings = { read: key => settings.get(key), write: (key, value) => settings.set(key, value) };
  mountChatOptions({ connection: { fetch: { register(route) { fetch = route.fetch; } } } }, {
    getSession: () => ({ ...session }), usageStore, preferences: { get: () => defaultChatOptions }, webSearchSettings,
  });
  const request = (body, owner = profile) => fetch(new Request(
    'http://localhost/api/dsh-open-model/chatgpt/chat-options?sessionId=' + id + '&profileId=' + owner,
    body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) },
  ));

  assert.deepEqual((await (await request()).json()).features, { webSearch: true, jsonSchema: '' });
  settings.set(id, false);
  assert.deepEqual((await (await request({ jsonSchema: schema })).json()).features, { webSearch: false, jsonSchema: schema });
  assert.deepEqual((await (await request()).json()).features, { webSearch: false, jsonSchema: schema });
  assert.equal((await request({ webSearch: true, jsonSchema: 'invalid' })).status, 400);
  assert.equal((await request({ webSearch: true }, 'other-profile')).status, 403);
  assert.equal(settings.get(id), false);

  assert.equal((await request({ webSearch: true })).status, 200);
  assert.equal(settings.get(id), true);
  assert.deepEqual(usageStore.chatOptions(id, profile), { webSearch: true, jsonSchema: schema });
  const started = Promise.withResolvers();
  const resume = Promise.withResolvers();
  webSearchSettings.read = async key => {
    started.resolve();
    await resume.promise;
    return settings.get(key);
  };
  const pending = request({ webSearch: false, jsonSchema: '' });
  await started.promise;
  session.sharing = false;
  resume.resolve();
  assert.equal((await pending).status, 403);
  assert.equal(settings.get(id), true);
  assert.equal(usageStore.chatOptions(id, profile).jsonSchema, schema);
});
