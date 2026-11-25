import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AccountStore } from '../host/chatgpt/store.js';
import { apply } from '../host/index.js';
import { apiBase, providerId } from '../shared/identity.js';

test('a new Open Model installation leaves the standalone ChatGPT directory untouched', async t => {
  const home = await mkdtemp(join(tmpdir(), 'open-model-chatgpt-'));
  const standalone = join(home, 'dsh-use-chatgpt');
  await mkdir(standalone, { mode: 0o700 });
  const marker = 'standalone test fixture';
  const file = join(standalone, 'chatgpt-auth.json');
  await writeFile(file, marker, { mode: 0o600 });
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const cleanups = [];
  t.after(async () => {
    for (const dispose of cleanups.reverse()) dispose();
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const providers = [];
  const routes = new Map();
  const ctx = {
    inject(_, run) { run(this); },
    webServer: { host: '127.0.0.1' },
    effect(setup) { cleanups.push(setup()); },
    llm: { registerAdapter(ids) { providers.push(...ids); return { replace() {} }; } },
    connection: { fetch: { register(route) { routes.set(route.path, route); } } },
  };
  apply(ctx);
  assert.equal(providerId, 'dsh-open-model-chatgpt');
  assert.deepEqual(providers, ['darwin', 'win32'].includes(process.platform) ? [providerId] : []);
  assert.equal(apiBase, '/api/dsh-open-model/chatgpt');
  assert.ok([...routes.keys()].every(path => path.startsWith(apiBase + '/')));
  const status = routes.get(apiBase + '/status');
  const response = await status.fetch(new Request('http://localhost' + status.path));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.status, 'disconnected');
  assert.deepEqual(data.profiles, []);
  assert.equal(await readFile(file, 'utf8'), marker);
});

test('foreign encrypted records and legacy plaintext never invoke the system key store', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'open-model-foreign-record-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new AccountStore(dir, {
    id: 'test-open-model-credentials',
    isAvailable: () => assert.fail('unexpected key-store query'),
    encrypt: () => assert.fail('unexpected encryption'),
    decrypt: () => assert.fail('unexpected decryption'),
  });
  const file = join(dir, 'chatgpt-auth.json');
  for (const [record, code] of [
    [{ version: 3, provider: 'dsh-macos-keychain-aes256gcm-v1', ciphertext: 'AQ==' }, 'storage_provider_mismatch'],
    [{ version: 2, profiles: [], pendingRegistrations: [] }, 'storage_invalid'],
  ]) {
    const contents = JSON.stringify(record);
    await writeFile(file, contents, { mode: 0o600 });
    await assert.rejects(store.transaction(() => assert.fail('unexpected import')), { code });
    assert.equal(await readFile(file, 'utf8'), contents);
  }
});
