// The profile is supplied by the requesting workspace and independently checked against the active grant.
import { apiBase } from '../shared/identity.js';
import { mergeChatOptions } from '../shared/chat-options.js';
import { planEnabled } from './provider.js';

export function mountChatOptions(ctx, { getSession, usageStore, preferences, webSearchSettings }) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
  const fail = (message, status) => json({ error: { message } }, status);
  ctx.connection.fetch.register({
    path: `${apiBase}/chat-options`,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const session = await getSession();
        if (!planEnabled(session) || !session.profileId) return fail('请先连接 ChatGPT 并授权使用套餐。', 403);
        const params = new URL(request.url).searchParams;
        const id = params.get('sessionId');
        const profile = params.get('profileId');
        if (!id || !/^[a-zA-Z0-9_-]{1,256}$/.test(id) || profile !== session.profileId) return fail('当前账号无法访问此会话。', 403);
        const legacy = id.startsWith('chatgpt-');
        if (legacy) {
          if (usageStore.owner(id) !== profile) return fail('当前账号无法访问此会话。', 403);
        } else {
          // Opening saved history in DSH does not activate an agent until the next turn.
          const native = ctx.get?.('sessions')?.get(id)
            ?? await ctx.get?.('sessionPersistence')?.stat(id, { signal: request.signal });
          if (!native || native.header?.origin === 'subagent') return fail('当前账号无法访问此会话。', 403);
        }
        const patch = request.method === 'POST' ? await request.json().catch(() => null) : undefined;
        const fallback = await preferences.get();
        const savedSearch = await webSearchSettings?.read(id);
        const current = await getSession();
        request.signal.throwIfAborted();
        session.accountSignal?.throwIfAborted();
        if (!planEnabled(current) || current.profileId !== profile || current.accountSignal !== session.accountSignal) {
          return fail('账号或授权已更改，请重新打开会话。', 403);
        }
        if (legacy && usageStore.owner(id) !== profile) return fail('当前账号无法访问此会话。', 403);
        if (webSearchSettings && patch && Object.hasOwn(patch, 'webSearch')) {
          const features = mergeChatOptions(usageStore.chatOptions(id, profile) ?? fallback, patch);
          if (Object.hasOwn(patch, 'jsonSchema')) {
            usageStore.patchChatOptions(id, profile, fallback, { jsonSchema: features.jsonSchema });
          }
          await webSearchSettings.write(id, features.webSearch);
          return json({ features });
        }
        const features = request.method === 'POST'
          ? usageStore.patchChatOptions(id, profile, fallback, patch)
          : usageStore.chatOptions(id, profile) ?? fallback;
        return json({ features: { ...features, webSearch: savedSearch ?? features.webSearch } });
      } catch (error) {
        if (error?.code === 'invalid_features') return fail(error.message, 400);
        return fail('读取或保存对话选项失败，请重试。', 503);
      }
    },
  });
}
