import { KILO_BASE_URL, KILO_PROVIDER, maxTokensParameter } from './catalog.js';
import { createImageInputs } from './chatgpt/host/images.js';

const GENERATION_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_TOKENS = 8_192;
const MAX_EVENT_CHARS = 1024 * 1024;
const MAX_RESPONSE_CHARS = 4 * 1024 * 1024;

class StreamFailure extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.failure = { code, message, ...details };
  }
}

function retryAfterMs(value) {
  if (!value) return undefined;
  const delay = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isSafeInteger(delay) && delay > 0 ? delay : undefined;
}

function upstreamFailure(code, retryAfter) {
  const status = /^\d{3}$/.test(String(code)) ? Number(code) : undefined;
  const detail = status === undefined ? {} : { status };

  switch (status) {
    case 401:
    case 403:
      return new StreamFailure('AUTH', '这个模型当前不接受 Kilo 匿名访问。', detail);
    case 402:
      return new StreamFailure('QUOTA', 'Kilo 当前没有可用于此请求的免费额度。', detail);
    case 404:
      return new StreamFailure('MODEL_UNAVAILABLE', 'Kilo 当前无法提供这个模型。', detail);
    case 408:
    case 504:
      return new StreamFailure('TIMEOUT', 'Kilo 响应超时，请稍后再试。', detail);
    case 429: {
      const delay = retryAfterMs(retryAfter);
      return new StreamFailure('RATE_LIMIT', 'Kilo 免费模型暂时限流，请稍后再试。', {
        ...detail,
        ...(delay === undefined ? {} : { providerRetryAfterMs: delay }),
      });
    }
    default:
      if (status >= 400 && status < 500) {
        return new StreamFailure('INVALID_REQUEST', 'Kilo 拒绝了这次请求。', detail);
      }
      if (code === 'context_length_exceeded') {
        return new StreamFailure('CONTEXT_WINDOW_EXCEEDED', '这次对话内容超过了模型的上下文限制。');
      }
      return new StreamFailure('SERVER', 'Kilo 当前无法完成这次请求。', detail);
  }
}

async function messageContent(message, model, readImage, toolImages) {
  const parts = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'image') {
      if (block.offloaded) {
        parts.push({ type: 'text', text: '[该图片已从模型上下文移出]' });
        continue;
      }
      if (!model.inputModalities?.includes('image')) {
        throw new StreamFailure('UNSUPPORTED_CONTENT', '这个 Kilo 免费模型当前只接收文本。');
      }
      if (message.role !== 'user' && message.role !== 'tool') {
        throw new StreamFailure('UNSUPPORTED_CONTENT', 'Kilo 当前只接收用户或工具提供的图片。');
      }
      const image = await readImage(block);
      if (message.role === 'tool') {
        toolImages.push({ type: 'text', text: `Image returned by tool call ${message.toolCallId}:` }, image);
      } else {
        parts.push(image);
      }
    } else if (block.type === 'file') {
      throw new StreamFailure('UNSUPPORTED_CONTENT', 'Kilo 当前无法接收此文件附件。');
    }
  }
  return parts.every(part => part.type === 'text') ? parts.map(part => part.text).join('\n') : parts;
}

async function convertMessages(options, model, getAttachments, signal) {
  const messages = options.system ? [{ role: 'system', content: options.system }] : [];
  // DSH wraps tool results in user-role messages. Emit the results before
  // any follow-up user content so a Chat Completions call batch stays intact.
  const history = options.messages.flatMap(message => {
    if (message.role !== 'user') return [message];
    const results = message.content.filter(block => block.type === 'tool-result');
    if (!results.length) return [message];
    const entries = results.map(({ toolCallId, content }) => ({ role: 'tool', toolCallId, content }));
    const regular = message.content.filter(block => block.type !== 'tool-result');
    if (regular.length) entries.push({ role: 'user', content: regular });
    return entries;
  });
  const answered = new Set(history.filter(message => message.role === 'tool')
    .map(message => message.toolCallId));
  const sent = new Set();
  const toolImages = [];
  let imageInput;
  async function readImage(block) {
    imageInput ??= createImageInputs(getAttachments?.(), signal);
    try {
      const image = await imageInput(block);
      return { type: 'image_url', image_url: { url: image.image_url } };
    } catch (error) {
      signal.throwIfAborted();
      throw new StreamFailure(error.code ?? 'ATTACHMENT_READ_FAILED', error.message);
    }
  }
  function flushToolImages() {
    // Chat Completions only accepts image parts in the user role. All tool
    // results in a parallel batch must precede this follow-up message.
    if (toolImages.length) messages.push({ role: 'user', content: toolImages.splice(0) });
  }

  for (const message of history) {
    if (message.role !== 'tool') flushToolImages();
    if (message.role === 'tool' && !sent.delete(message.toolCallId)) continue;
    const content = await messageContent(message, model, readImage, toolImages);
    if (message.role === 'assistant') {
      const calls = message.content.filter(block => block.type === 'tool-call' && answered.has(block.id));
      const tool_calls = calls.map(block => {
        sent.add(block.id);
        return { id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments } };
      });
      if (content || tool_calls.length) {
        messages.push({ role: 'assistant', content: content || null, ...(tool_calls.length ? { tool_calls } : {}) });
      }
    } else if (message.role === 'tool') {
      messages.push({ role: 'tool', content, tool_call_id: message.toolCallId });
    } else if (content) {
      messages.push({ role: message.role === 'developer' ? 'system' : message.role, content });
    }
  }
  flushToolImages();
  return messages;
}

async function requestBody(options, model, tools, getAttachments, signal) {
  const supported = model.supportedParameters;
  if (tools.length && !supported.includes('tools')) {
    throw new StreamFailure('INVALID_REQUEST', '这个 Kilo 免费模型不支持工具调用。');
  }
  if (options.temperature !== undefined && !supported.includes('temperature')) {
    throw new StreamFailure('INVALID_REQUEST', '这个 Kilo 免费模型不支持自定义采样温度。');
  }
  if (options.stop?.length && !supported.includes('stop')) {
    throw new StreamFailure('INVALID_REQUEST', '这个 Kilo 免费模型不支持自定义停止词。');
  }

  const messages = await convertMessages(options, model, getAttachments, signal);
  if (!messages.length) throw new StreamFailure('INVALID_REQUEST', '请先输入一条消息。');
  const body = { model: model.id, messages, stream: true };
  const tokenParameter = maxTokensParameter(supported);
  if (tokenParameter) {
    body[tokenParameter] = Math.min(options.maxTokens ?? DEFAULT_MAX_TOKENS, model.maxCompletionTokens ?? Infinity);
  } else if (options.maxTokens !== undefined) {
    throw new StreamFailure('INVALID_REQUEST', '这个 Kilo 免费模型不支持设置最大输出长度。');
  }
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.stop?.length) body.stop = options.stop;
  if (tools.length) {
    body.tools = tools.map(({ name, description, parameters }) => ({
      type: 'function', function: { name, description, parameters },
    }));
  }
  if (options.reasoningEffort !== undefined) {
    const choice = model.reasoningChoices?.find(({ id }) => id === options.reasoningEffort);
    if (!choice) throw new StreamFailure('UNSUPPORTED_REASONING_EFFORT', '该模型不支持所选推理等级。');
    Object.assign(body, choice.params);
  }
  return body;
}

/** Parse incremental SSE data records, including records split across network reads. */
async function* eventData(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  let data = [];
  let eventChars = 0;
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line === '') {
        if (data.length) yield data.join('\n');
        data = [];
        eventChars = 0;
      } else if (line.startsWith('data:')) {
        const value = line.slice(line[5] === ' ' ? 6 : 5);
        eventChars += value.length + 1;
        if (eventChars > MAX_EVENT_CHARS) {
          throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 返回的数据帧过大。');
        }
        data.push(value);
      }
    }
    if (buffer.length > MAX_EVENT_CHARS) {
      throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 返回的数据帧过大。');
    }
  }
}

function parseEvent(data) {
  try {
    const event = JSON.parse(data);
    if (event && typeof event === 'object' && !Array.isArray(event)) return event;
  } catch {
    // Never include upstream data in error messages.
  }
  throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 返回了无法识别的数据帧。');
}

function isTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function mapUsage(raw) {
  const { prompt_tokens: prompt, completion_tokens: completion } = raw ?? {};
  if (!isTokenCount(prompt) || !isTokenCount(completion)) return undefined;

  const cached = raw.prompt_tokens_details?.cached_tokens;
  const reasoning = raw.completion_tokens_details?.reasoning_tokens;
  const total = prompt + completion;
  const cacheRead = isTokenCount(cached) && cached <= prompt ? cached : 0;
  return {
    inputTokens: prompt - cacheRead,
    outputTokens: completion,
    ...(Number.isSafeInteger(total) ? { totalTokens: total } : {}),
    ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
    ...(isTokenCount(reasoning) && reasoning <= completion ? { reasoningTokens: reasoning } : {}),
  };
}

function toolBlock(block, toolNames) {
  if (!block.id || !block.name) {
    throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 返回了身份不完整的工具调用。');
  }
  if (!toolNames.has(block.name)) {
    throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 返回了本次请求未提供的工具。');
  }
  try {
    const parsed = JSON.parse(block.arguments);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments };
    }
  } catch {
    // Incomplete and invalid JSON tool calls must never be completed synthetically.
  }
  throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 返回了不完整的工具参数。');
}

function mapFinishReason(reason, blocks, usage, contextWindow) {
  switch (reason) {
    case 'stop':
      if (!blocks.length) throw new StreamFailure('EMPTY_RESPONSE', 'Kilo 没有返回文本。');
      return { kind: 'stop' };
    case 'length':
      if (contextWindow && usage?.totalTokens >= contextWindow && usage.outputTokens === 0) {
        throw new StreamFailure('CONTEXT_WINDOW_EXCEEDED', '这次对话内容超过了模型的上下文限制。');
      }
      return { kind: 'max-tokens' };
    case 'tool_calls':
      if (!blocks.some(block => block.type === 'tool-call')) {
        throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 没有返回完整的工具调用。');
      }
      return { kind: 'tool-calls' };
    case 'content_filter':
      throw new StreamFailure('INVALID_REQUEST', 'Kilo 的内容过滤终止了这次回复。');
    default:
      if (reason) throw new StreamFailure('SERVER', 'Kilo 提前终止了这次回复。');
      throw new StreamFailure('TRANSPORT', 'Kilo 的连接在回复完成前断开。');
  }
}

async function* translate(body, model, signal, retryAfter, toolNames) {
  const blocks = [];
  const tools = new Map();
  let text;
  let reasoning;
  let responseChars = 0;
  let usage;
  let finishReason;

  function open(content) {
    const block = { ...content, index: blocks.length };
    blocks.push(block);
    return block;
  }

  function count(value) {
    responseChars += value.length;
    if (responseChars > MAX_RESPONSE_CHARS) {
      throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 返回的内容过大。');
    }
  }

  for await (const data of eventData(body)) {
    signal.throwIfAborted();
    if (data.trim() === '[DONE]') break;
    if (!data.trim()) continue;

    const event = parseEvent(data);
    if (event.error) throw upstreamFailure(event.error.code, retryAfter);
    if (event.usage) usage = mapUsage(event.usage) ?? usage;
    const choice = event.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};

    const thought = delta.reasoning ?? delta.reasoning_content;
    if (typeof thought === 'string' && thought) {
      if (!reasoning) {
        reasoning = open({ type: 'reasoning', text: '' });
        yield { type: 'block-start', index: reasoning.index, blockType: 'reasoning' };
      }
      count(thought);
      reasoning.text += thought;
      yield { type: 'reasoning-delta', index: reasoning.index, text: thought };
    }
    if (typeof delta.content === 'string' && delta.content) {
      if (!text) {
        text = open({ type: 'text', text: '' });
        yield { type: 'block-start', index: text.index, blockType: 'text' };
      }
      count(delta.content);
      text.text += delta.content;
      yield { type: 'text-delta', index: text.index, text: delta.content };
    }

    const toolCalls = delta.tool_calls ?? [];
    if (!Array.isArray(toolCalls)) {
      throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 返回了无效的工具调用。');
    }
    for (const call of toolCalls) {
      if (!Number.isSafeInteger(call?.index) || call.index < 0 || call.index > 128) {
        throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 返回了无效的工具调用。');
      }
      let block = tools.get(call.index);
      if (!block) {
        block = open({ type: 'tool-call', id: '', name: '', arguments: '' });
        tools.set(call.index, block);
        yield { type: 'block-start', index: block.index, blockType: 'tool-call' };
      }
      if (typeof call.id === 'string' && call.id) block.id ||= call.id;
      const name = call.function?.name;
      if (typeof name === 'string' && name && name !== block.name) {
        count(name);
        block.name += name;
      }
      const fragment = call.function?.arguments ?? '';
      if (typeof fragment !== 'string') {
        throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 返回了无效的工具参数。');
      }
      count(fragment);
      block.arguments += fragment;
      yield {
        type: 'tool-call-delta',
        index: block.index,
        id: block.id,
        ...(toolNames.has(block.name) ? { name: block.name } : {}),
        argumentsDelta: fragment,
      };
    }
    if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
  }

  signal.throwIfAborted();
  const reason = mapFinishReason(finishReason, blocks, usage, model.context?.contextWindow);
  if (tools.size && reason.kind === 'stop') {
    throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 未确认工具调用已完成。');
  }
  const completed = blocks.flatMap(block => {
    // On length truncation, leave unconfirmed tool calls open so the host can drop them.
    if (block.type === 'tool-call' && reason.kind !== 'tool-calls') return [];
    const content = block.type === 'tool-call' ? toolBlock(block, toolNames) : { type: block.type, text: block.text };
    return [{ type: 'block-end', index: block.index, block: content }];
  });
  yield* completed;
  if (usage) yield { type: 'usage', usage };
  yield { type: 'finish', reason };
}

/** Translate one authenticated-free Kilo streaming request into DeepSeek Harness chunks. */
export async function* streamKilo(options, model, fetchImpl = fetch, { 'user-agent': userAgent, getWebSearchEnabled, getAttachments } = {}) {
  const timeout = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    signal.throwIfAborted();
    let tools = options.tools ?? [];
    if (tools.some(tool => tool.name === 'web_search')) {
      if (model.webSearch === false || !model.supportedParameters.includes('tools')
        || (getWebSearchEnabled && !await getWebSearchEnabled(options.sessionId, KILO_PROVIDER, model.id, signal))) {
        tools = tools.filter(tool => tool.name !== 'web_search');
      }
    }
    const body = await requestBody(options, model, tools, getAttachments, signal);
    signal.throwIfAborted();
    const response = await fetchImpl(`${KILO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'user-agent': userAgent ?? 'dsh-open-model',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal,
    });
    const retryAfter = response.headers.get('retry-after');
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw upstreamFailure(response.status, retryAfter);
    }
    if (!response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
      await response.body?.cancel().catch(() => {});
      throw new StreamFailure('MALFORMED_RESPONSE', 'Kilo 没有返回预期的流式回复。');
    }
    yield* translate(response.body, model, signal, retryAfter, new Set(tools.map(tool => tool.name)));
  } catch (error) {
    if (options.signal?.aborted) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: '已取消 Kilo 请求。' } } };
      return;
    }
    const failure = error instanceof StreamFailure ? error.failure : timeout.aborted
      ? { code: 'TIMEOUT', message: 'Kilo 响应超时，请稍后再试。' }
      : { code: 'TRANSPORT', message: '暂时无法连接 Kilo，请检查网络后重试。' };
    yield { type: 'finish', reason: { kind: 'error', failure } };
  }
}
