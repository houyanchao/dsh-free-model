import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KILO_PROVIDER } from './catalog.js';
import { providerId as chatGPTProvider } from './chatgpt/shared/identity.js';

const validSessionId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(id);

export function createWebSearchSettings(profileDir) {
  const directory = join(profileDir, 'dsh-open-model', 'web-search');
  const pending = new Map();
  // Hashing also keeps case-sensitive session IDs distinct on macOS and Windows.
  const file = id => join(directory, createHash('sha256').update(id).digest('hex'));

  async function save(id, enabled) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const target = file(id);
    const temporary = target + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, String(enabled), { flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  return {
    async read(id) {
      if (!validSessionId(id)) return undefined;
      let value;
      try {
        value = await readFile(file(id), 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      }
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new Error('Invalid saved web search setting.');
    },
    async write(id, enabled) {
      if (!validSessionId(id) || typeof enabled !== 'boolean') throw new TypeError('Invalid web search setting.');
      const previous = pending.get(id);
      const write = previous ? previous.catch(() => {}).then(() => save(id, enabled)) : save(id, enabled);
      pending.set(id, write);
      try {
        await write;
      } finally {
        if (pending.get(id) === write) pending.delete(id);
      }
    },
  };
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function fail(message, status) {
  return json({ error: { message } }, status);
}

export function mountWebSearchSettings(ctx, { settings, getEnabled, isAvailable }) {
  ctx.connection.fetch.register({
    path: '/api/dsh-open-model/web-search',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const params = new URL(request.url).searchParams;
      const id = params.get('sessionId');
      const provider = params.get('provider');
      const model = params.get('model');
      if (!validSessionId(id) || (provider !== KILO_PROVIDER && provider !== chatGPTProvider) || !model?.trim()) {
        return fail('请提供有效的会话、模型来源和模型。', 400);
      }
      try {
        const session = ctx.get('sessions')?.get(id)
          ?? await ctx.get('sessionPersistence')?.stat(id, { signal: request.signal });
        if (!session || session.header?.origin === 'subagent') return fail('此会话无法设置网页搜索。', 403);

        const writing = request.method === 'POST';
        const input = writing ? await request.json().catch(() => null) : undefined;
        if (writing && (typeof input?.enabled !== 'boolean' || Object.keys(input).length !== 1)) {
          return fail('请提供有效的网页搜索开关状态。', 400);
        }
        request.signal.throwIfAborted();
        // Save an explicit opt-out before consulting a potentially offline provider.
        if (writing && !input.enabled) await settings.write(id, false);
        let available = false;
        try {
          available = Boolean(await isAvailable(id, provider, model, session, request.signal));
        } catch (error) {
          if (input?.enabled === true) throw error;
        }
        request.signal.throwIfAborted();
        if (!writing) return json({ enabled: Boolean(await getEnabled(id, provider)), available });
        if (input.enabled && !available) return fail('当前模型暂时无法使用网页搜索。', 409);
        if (input.enabled) await settings.write(id, true);
        return json({ enabled: input.enabled, available });
      } catch {
        return fail('暂时无法读取或保存对话的网页搜索设置。', 503);
      }
    },
  });
}
