import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { KiloCatalogError } from './catalog.js';

function harnessHome() {
  const home = process.env.DSH_HOME?.trim();
  if (!home) return join(homedir(), '.dsh');
  if (home === '~') return homedir();
  return /^~[/\\]/.test(home) ? resolve(homedir(), home.slice(2)) : resolve(home);
}

function modelKey(id) {
  return createHash('sha256').update(id).digest('hex');
}

export function createModelVisibility(profileDir = harnessHome()) {
  const directory = join(profileDir, 'dsh-free-model', 'disabled-models');
  return {
    async readDisabled() {
      const entries = await readdir(directory).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      const keys = new Set(entries);
      return id => keys.has(modelKey(id));
    },

    async setEnabled(id, enabled) {
      // A file per model lets concurrent saves update different switches independently.
      const marker = join(directory, modelKey(id));
      if (enabled) {
        await rm(marker, { force: true });
      } else {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(marker, '', { flag: 'wx', mode: 0o600 }).catch(error => {
          if (error.code !== 'EEXIST') throw error;
        });
      }
    },
  };
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export function registerModelManagement(ctx, { catalog, visibility, onChange }) {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(), 'dsh-free-model: management lifetime');
  ctx.connection.fetch.register({
    path: '/api/dsh-free-model/models',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const signal = AbortSignal.any([request.signal, lifetime.signal]);
      try {
        if (request.method === 'GET') {
          const [models, isDisabled] = await Promise.all([catalog.listModels(signal), visibility.readDisabled()]);
          return json({ models: models.map(({ id, name }) => ({ id, name, enabled: !isDisabled(id) })) });
        }

        const input = await request.json().catch(() => undefined);
        if (typeof input?.id !== 'string' || !input.id.trim() || typeof input.enabled !== 'boolean') {
          return json({ error: '请提供有效的模型和开关状态。' }, 400);
        }
        const { id, enabled } = input;
        if (!await catalog.getModel(id, signal)) {
          return json({ error: '模型已不在 Kilo 免费目录中，请刷新列表。' }, 404);
        }
        signal.throwIfAborted();
        await visibility.setEnabled(id, enabled);
        if (!lifetime.signal.aborted) onChange();
        return json({ id, enabled });
      } catch (error) {
        if (error instanceof KiloCatalogError) return json({ error: error.message }, 502);
        return json({ error: request.method === 'GET' ? '无法读取模型开关。' : '无法保存模型开关，请重试。' }, 500);
      }
    },
  });
}
