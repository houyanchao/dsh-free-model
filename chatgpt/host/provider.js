import { createFileInputs, restoreFileInputs } from './files.js';
import { createImageInputs, requestImageTarget } from './images.js';
import { serializeToolCall, serializeToolResult, toResponsesTools, toToolCallBlock } from './tools.js';

import { providerId } from '../shared/identity.js';
import { applyModelConfig, getConfiguredSource } from '../../model-config.js';

export { providerId };
const catalogTtlMs = 60_000;

const effortNames = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };

export function planEnabled(session) {
  return session.status === 'connected' && session.sharing === true;
}

export function pluginError(code, message) {
  return Object.assign(new Error(message), { code });
}

// A cancelled caller can leave immediately while other chats keep using the same catalog fetch.
async function waitForRequest(read, signal) {
  if (!signal) return read();
  signal.throwIfAborted();
  const cancelled = Promise.withResolvers();
  const abort = () => cancelled.reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([cancelled.promise, read()]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function reasoningForTool(message, index, model, profileId) {
  const source = message.source;
  if (source?.kind !== 'model' || source.provider !== providerId || source.model !== model) return [];
  if (!profileId || source.replayState?.response?.profileId !== profileId) return [];
  const retained = source.replayState?.blocks?.[index];
  if (retained?.callId !== message.content[index].id || !Array.isArray(retained.reasoning)) return [];
  return retained.reasoning.filter(item => item?.type === 'reasoning'
    && typeof item.id === 'string' && typeof item.encrypted_content === 'string'
    && Array.isArray(item.summary));
}

async function responseInput(options, attachments, signal, profileId, modelDetails) {
  const canReadImages = modelDetails.inputModalities.includes('image');
  // Newer DSH versions put the result on a tool-role message. Feed it through
  // the same call pairing and attachment conversion as older result blocks.
  const messages = restoreFileInputs(options, canReadImages).map(message => {
    if (message.role !== 'tool') return message;
    const { toolCallId, content, isError } = message;
    return { role: 'user', content: [{ type: 'tool-result', toolCallId, content, isError }] };
  });
  const input = options.system ? [{ role: 'developer', content: options.system }] : [];
  const imageInput = createImageInputs(attachments, signal);
  const fileInput = createFileInputs(attachments, signal);
  const toolResults = new Set(messages.flatMap(message => message.content
    .filter(block => block.type === 'tool-result').map(block => block.toolCallId)));
  const pending = new Set();

  async function contentPart(block) {
    if (block.type === 'text') return { type: 'input_text', text: block.text };
    if (block.type === 'image') {
      if (block.offloaded) {
        const name = block.attachment?.name ?? block.attachment?.attachmentId;
        return { type: 'input_text', text: name ? `[图片已从模型上下文移出：${name}]` : '[图片已从模型上下文移出]' };
      }
      if (!canReadImages) throw pluginError('UNSUPPORTED_CONTENT', '该 ChatGPT 模型不支持图片输入。');
      return imageInput(block);
    }
    if (block.type === 'file') {
      if (!canReadImages && /\.pdf$/i.test(block.attachment?.name)) {
        throw pluginError('UNSUPPORTED_CONTENT', '该 ChatGPT 模型不支持 PDF 图片输入。');
      }
      return fileInput(block);
    }
  }

  for (const message of messages) {
    const role = message.role === 'system' ? 'developer' : message.role;
    const parts = [];
    function flush() {
      if (!parts.length) return;
      const content = parts.every(part => part.type === 'input_text')
        ? parts.map(part => part.text).join('\n')
        : [...parts];
      input.push({ role, content });
      parts.length = 0;
    }
    for (const [index, block] of message.content.entries()) {
      signal.throwIfAborted();
      if (block.type === 'tool-call' && toolResults.has(block.id)) {
        flush();
        input.push(...reasoningForTool(message, index, options.model, profileId), serializeToolCall(block));
        pending.add(block.id);
      } else if (block.type === 'tool-result' && pending.delete(block.toolCallId)) {
        flush();
        const output = [];
        for (const resultBlock of block.content) {
          const part = await contentPart(resultBlock);
          if (part) output.push(part);
        }
        const result = output.every(part => part.type === 'input_text') ? output.map(part => part.text).join('\n') : output;
        input.push(serializeToolResult(block, result));
      } else {
        const part = await contentPart(block);
        if (part) parts.push(part);
      }
    }
    flush();
  }
  return input;
}

function responseEvents(client, options) {
  const { signal } = options;
  let cancelled = false;
  return new ReadableStream({
    start(output) {
      const conclude = event => {
        if (cancelled) return;
        output.enqueue(event);
        output.close();
      };
      void Promise.resolve().then(() => client.streamResponse({
        ...options,
        onDelta: text => {
          if (text && !signal.aborted && !cancelled) output.enqueue({ type: 'text', delta: text });
        },
        onReasoningDelta: text => {
          if (text && !signal.aborted && !cancelled) output.enqueue({ type: 'reasoning', delta: text });
        },
      })).then(
        result => conclude({ done: true, result }),
        error => conclude({ error }),
      );
    },
    cancel() {
      cancelled = true;
    },
  });
}

function modelInfo(row, listing) {
  const reasoningEfforts = (listing?.reasoningEfforts ?? row.reasoningEfforts)?.filter(id => Object.hasOwn(effortNames, id));
  return applyModelConfig({
    provider: providerId,
    id: row.id,
    name: listing?.displayName ?? row.id,
    inputModalities: listing?.inputModalities ?? row.inputModalities ?? ['text'],
    ...(listing?.webSearch !== undefined ? { webSearch: listing.webSearch } : {}),
    ...(listing?.contextWindow !== undefined ? { context: { contextWindow: listing.contextWindow } } : {}),
    ...(listing?.maxCompletionTokens !== undefined ? { maxCompletionTokens: listing.maxCompletionTokens } : {}),
    ...(reasoningEfforts?.length ? { reasoning: { efforts: reasoningEfforts.map(id => ({ id, name: effortNames[id] ?? id })) } } : {}),
  }, row);
}

function tokenUsage(usage) {
  const { inputTokens, outputTokens, totalTokens, cachedInputTokens, cacheWriteTokens, reasoningTokens } = usage;
  return {
    inputTokens: inputTokens - (cachedInputTokens ?? 0) - (cacheWriteTokens ?? 0),
    outputTokens,
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cacheReadTokens: cachedInputTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}

function completedToolCalls(output, toolNames) {
  const calls = [];
  const ids = new Set();
  let reasoning = [];
  for (const item of output ?? []) {
    if (item?.type === 'reasoning' && typeof item.encrypted_content === 'string' && typeof item.id === 'string') {
      reasoning.push({ type: 'reasoning', id: item.id, summary: [], encrypted_content: item.encrypted_content });
    }
    if (item?.type !== 'function_call') continue;
    const block = toToolCallBlock(item, toolNames);
    if (ids.has(block.id)) throw pluginError('INVALID_TOOL_CALL', 'ChatGPT 返回了重复的工具调用。');
    ids.add(block.id);
    calls.push({ block, reasoning });
    reasoning = [];
  }
  return calls;
}

function sourceLinks(citations) {
  const urls = new Set();
  for (const citation of citations ?? []) {
    try {
      const url = new URL(citation.url);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
        urls.add(url.href.replace(/[<>]/g, character => encodeURIComponent(character)));
      }
    } catch {
      // Drop malformed or non-link annotation metadata.
    }
  }
  return urls.size ? `\n\n${[...urls].map((url, index) => `[${index + 1}](<${url}>)`).join(' · ')}` : '';
}

export function createProvider(client, getSession, lifetime, {
  configuredModels = getConfiguredSource('chatgpt')?.models ?? [],
  getAttachments = () => undefined,
  getPreferences = () => ({}),
  getWebSearchEnabled,
  getChatOwner,
  getHiddenModels = () => new Set(),
  onUsage,
} = {}) {
  const configuredIds = new Set(configuredModels.map(row => row.id));
  let catalog;

  async function fetchModels(signal, profileId) {
    if (!configuredModels.length) return [];
    const entries = await client.listModels({ signal, expectedProfileId: profileId });
    signal.throwIfAborted();
    const byId = new Map();
    for (const model of entries) {
      if (configuredIds.has(model.slug) && !byId.has(model.slug)) byId.set(model.slug, model);
    }
    return configuredModels
      .filter(row => byId.has(row.id))
      .map(row => modelInfo(row, byId.get(row.id)))
      .filter(model => model.inputModalities.includes('text'));
  }

  async function loadModels(session, force) {
    const { accountSignal, profileId } = session;
    if (!planEnabled(session)) {
      if (catalog?.accountSignal === accountSignal) catalog = undefined;
      return [];
    }
    const signal = accountSignal ? AbortSignal.any([lifetime, accountSignal]) : lifetime;
    signal.throwIfAborted();
    if (!profileId || !accountSignal) return fetchModels(signal, profileId);

    const sameAccount = catalog?.profileId === profileId && catalog.accountSignal === accountSignal;
    const refreshCached = force && Number.isFinite(catalog?.expiresAt);
    if (!sameAccount || refreshCached || catalog.expiresAt <= performance.now()) {
      const entry = { profileId, accountSignal, expiresAt: Infinity };
      entry.result = fetchModels(signal, profileId).then(models => {
        entry.expiresAt = performance.now() + catalogTtlMs;
        return models;
      }, error => {
        if (catalog === entry) catalog = undefined;
        throw error;
      });
      catalog = entry;
    }
    const models = await catalog.result;
    signal.throwIfAborted();
    return structuredClone(models);
  }

  async function resolveForSession(session, model, signal) {
    signal?.throwIfAborted();
    if (!configuredIds.has(model)) throw pluginError('NO_MODEL', '该模型未列入 OpenModel 配置。请重新选择模型。');
    const entries = await waitForRequest(() => loadModels(session, false), signal);
    signal?.throwIfAborted();
    const entry = entries.find(entry => entry.id === model);
    if (!entry) throw pluginError('NO_MODEL', '当前 ChatGPT 套餐没有此模型。请刷新并重新选择。');
    return entry;
  }

  async function listVisibleModels(session, quiet = false) {
    let models;
    try {
      models = await loadModels(session, false);
    } catch (error) {
      lifetime.throwIfAborted();
      session.accountSignal?.throwIfAborted();
      if (!quiet) throw error;
      return [];
    }
    session.accountSignal?.throwIfAborted();
    if (!session.profileId || models.length === 0) return models;
    const hidden = getHiddenModels(session.profileId);
    return models.filter(model => !hidden.has(model.id));
  }

  return {
    providerInfo: id => ({ id, name: getConfiguredSource('chatgpt')?.name ?? 'OpenModel (ChatGPT 套餐)' }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    imageRequestTarget: (_provider, _model, image) => ({
      ...requestImageTarget,
      width: Math.min(image.width, requestImageTarget.width),
      height: Math.min(image.height, requestImageTarget.height),
    }),
    async listModels() {
      return listVisibleModels(await getSession(), true);
    },
    async listSelectableModels() {
      return listVisibleModels(await getSession());
    },
    async listPlanModels(force = false) {
      return loadModels(await getSession(), force);
    },
    listConfiguredModels() {
      return configuredModels.map(row => modelInfo(row));
    },
    async resolveModel(_provider, model, signal) {
      const session = await waitForRequest(getSession, signal);
      return resolveForSession(session, model, signal);
    },
    async prepareCall(provider, model, signal) {
      return { model: await this.resolveModel(provider, model, signal), stream: options => this.stream(options) };
    },
    async *stream(options) {
      const request = new AbortController();
      let signal = AbortSignal.any([request.signal, lifetime, ...(options.signal ? [options.signal] : [])]);
      let accountSignal;
      const outputBlocks = new Map();
      try {
        signal.throwIfAborted();
        const session = await waitForRequest(getSession, signal);
        if (!planEnabled(session)) {
          throw pluginError('sharing_not_enabled', '请先在侧边栏的 ChatGPT 页面登录并授权使用套餐。');
        }
        accountSignal = session.accountSignal;
        if (accountSignal) signal = AbortSignal.any([signal, accountSignal]);
        if (options.sessionId?.startsWith('chatgpt-') && getChatOwner?.(options.sessionId) !== session.profileId) {
          throw pluginError('profile_changed', '请切换回创建此会话的 ChatGPT 账号。');
        }
        signal.throwIfAborted();
        const { model, reasoningEffort } = options;
        const modelDetails = await resolveForSession(session, model, signal);
        if (reasoningEffort !== undefined && !modelDetails.reasoning?.efforts.some(effort => effort.id === reasoningEffort)) {
          throw pluginError('UNSUPPORTED_REASONING_EFFORT', '该 ChatGPT 模型不支持所选推理等级。');
        }
        const webSearch = modelDetails.webSearch !== false && (getWebSearchEnabled
          ? await getWebSearchEnabled(options.sessionId, providerId, model, signal)
          : !options.purpose && (await getPreferences(options.sessionId, session.profileId)).webSearch);
        const offeredTools = options.tools ?? [];
        const localTools = (getWebSearchEnabled || modelDetails.webSearch === false) && !webSearch
          ? offeredTools.filter(tool => tool.name !== 'web_search') : offeredTools;
        const tools = toResponsesTools(localTools);
        if (webSearch && !options.purpose) tools.push({ type: 'web_search' });
        const reasoningSummary = !options.purpose && modelDetails.reasoning && reasoningEffort !== 'none'
          ? 'auto' : undefined;
        const input = await responseInput(options, getAttachments(), signal, session.profileId, modelDetails);
        signal.throwIfAborted();
        const maxOutputTokens = Math.min(options.maxTokens ?? Infinity, modelDetails.maxCompletionTokens ?? Infinity);
        const events = responseEvents(client, {
          input, model, reasoningEffort, reasoningSummary, tools: tools.length ? tools : undefined, signal,
          ...(Number.isFinite(maxOutputTokens) ? { maxOutputTokens } : {}),
          expectedProfileId: session.profileId,
        });
        for await (const event of events) {
          signal.throwIfAborted();
          if (event.error) throw event.error;
          if (event.delta) {
            if (!outputBlocks.has(event.type)) {
              const index = outputBlocks.size;
              outputBlocks.set(event.type, index);
              yield { type: 'block-start', index, blockType: event.type };
            }
            yield { type: `${event.type}-delta`, index: outputBlocks.get(event.type), text: event.delta };
          }
          if (event.done) {
            const { text, reasoningSummary: summary, usage, output, citations } = event.result;
            const calls = completedToolCalls(output, new Set(localTools.map(tool => tool.name)));
            const links = sourceLinks(citations);
            const completed = { text: text + links, reasoning: summary ?? '' };
            for (const [type, value] of Object.entries(completed)) {
              const index = outputBlocks.get(type);
              if (index === undefined && value) {
                const newIndex = outputBlocks.size;
                outputBlocks.set(type, newIndex);
                yield { type: 'block-start', index: newIndex, blockType: type };
                yield { type: `${type}-delta`, index: newIndex, text: value };
              } else if (type === 'text' && index !== undefined && links) {
                yield { type: 'text-delta', index, text: links };
              }
            }
            if (!completed.text && calls.length === 0) throw pluginError('EMPTY_RESPONSE', 'ChatGPT 没有返回可显示的内容。');
            const blocks = [];
            for (const [type, index] of outputBlocks) {
              yield { type: 'block-end', index, block: { type, text: completed[type] } };
              blocks.push(null);
            }
            for (const { block, reasoning } of calls) {
              const index = blocks.length;
              yield { type: 'block-start', index, blockType: 'tool-call' };
              yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
              yield { type: 'block-end', index, block };
              blocks.push(reasoning.length ? { callId: block.id, reasoning } : null);
            }
            if (usage) {
              const counts = tokenUsage(usage);
              try { onUsage?.(session.profileId, model, counts); } catch (error) {
                console.warn('dsh-open-model-chatgpt: could not save usage counters', error?.code ?? 'storage_error');
              }
              yield { type: 'usage', usage: counts };
            }
            yield {
              type: 'finish',
              reason: { kind: calls.length ? 'tool-calls' : 'stop' },
              ...(blocks.some(Boolean) && session.profileId ? { replayState: { response: { profileId: session.profileId }, blocks } } : {}),
            };
            return;
          }
        }
      } catch (error) {
        const aborted = signal.aborted;
        const cancelledMessage = lifetime.aborted ? 'DSH 已重新载入插件，本轮已停止。请重新发送。'
          : accountSignal?.aborted ? '账号连接已改变，本轮已停止。' : '已停止本轮 ChatGPT 请求。';
        const failure = aborted ? { code: 'ABORTED', message: cancelledMessage }
          : error?.code === 'cancelled' ? { code: 'stream_interrupted', message: 'ChatGPT 提前结束了连接，请重新发送。' } : {
          code: typeof error?.code === 'string' ? error.code : 'CHATGPT_REQUEST_FAILED',
          message: error?.code === 'network_error' ? '暂时连接不上 OpenAI，请检查网络后重试本轮。'
            : typeof error?.code === 'string' ? error.message : 'ChatGPT 请求失败，请重试。',
          ...(typeof error?.status === 'number' ? { status: error.status } : {}),
          ...(typeof error?.requestId === 'string' ? { requestId: error.requestId } : {}),
        };
        yield { type: 'finish', reason: { kind: aborted ? 'aborted' : 'error', failure } };
      } finally {
        request.abort();
      }
    },
  };
}
