import assert from 'node:assert/strict';
import test from 'node:test';
import manifest from '../package.json' with { type: 'json' };
import { createUpdateChecker } from '../updates.js';

const dayMs = 24 * 60 * 60 * 1000;
const publishedAt = Date.parse('2026-11-20T12:00:00Z');
const latestVersion = '1.10.0';
const latest = { name: manifest.name, version: latestVersion };
const history = {
  name: manifest.name,
  'dist-tags': { latest: latestVersion },
  time: { created: '2025-01-01T00:00:00Z', [latestVersion]: new Date(publishedAt).toISOString() },
};

test('a newer npm version stays pending until 24 hours after that version was published', async () => {
  let now = publishedAt + dayMs - 1;
  const paths = [];
  const check = createUpdateChecker({
    currentVersion: '1.9.9',
    now: () => now,
    async fetch(url, options) {
      const target = new URL(url);
      assert.equal(target.origin, 'https://registry.npmjs.org');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      paths.push(decodeURIComponent(target.pathname));
      return Response.json(target.pathname.endsWith('/latest') ? latest : history);
    },
  });

  const results = await Promise.all([check(), check()]);
  assert.deepEqual(results.map(result => result.status), ['release_pending', 'release_pending']);
  assert.equal(results[0].latestVersion, latestVersion);
  assert.deepEqual(paths, [`/${manifest.name}/latest`, `/${manifest.name}`]);
  assert.equal((await check()).status, 'release_pending');
  assert.equal(paths.length, 2);

  now += 1;
  assert.equal((await check()).status, 'update_available');
  assert.equal(paths.length, 4);
});

test('an equal or older latest version does not require publication history', async () => {
  for (const version of ['1.10.0', '1.10.1']) {
    let requests = 0;
    const check = createUpdateChecker({
      currentVersion: version,
      async fetch() {
        requests += 1;
        return Response.json(latest);
      },
    });
    assert.equal((await check()).status, 'up_to_date');
    assert.equal(requests, 1);
  }
});

test('missing or mismatched publication data never reports an available update', async () => {
  for (const payload of [
    { ...history, time: { created: history.time.created } },
    { ...history, 'dist-tags': { latest: '2.0.0' } },
    { ...history, name: 'another-package' },
  ]) {
    const check = createUpdateChecker({
      now: () => publishedAt + 2 * dayMs,
      async fetch(url) {
        return Response.json(String(url).endsWith('/latest') ? latest : payload);
      },
    });
    assert.equal((await check()).status, 'unreachable');
  }
});

test('unpublished packages and registry outages do not report an available update', async () => {
  const unpublished = createUpdateChecker({ fetch: async () => new Response(null, { status: 404 }) });
  assert.equal((await unpublished()).status, 'unpublished');

  const offline = createUpdateChecker({
    async fetch() { throw new TypeError('offline'); },
  });
  assert.equal((await offline()).status, 'unreachable');
});
