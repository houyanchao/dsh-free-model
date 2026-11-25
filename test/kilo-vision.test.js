import assert from 'node:assert/strict';
import test from 'node:test';
import { streamKilo } from '../stream.js';

const model = { id: 'fixture', inputModalities: ['text', 'image'], supportedParameters: ['tools'] };
const text = value => ({ type: 'text', text: value });
const image = { type: 'image', attachment: { attachmentId: 'a' } };
const pixels = { mediaType: 'image/png', data: Uint8Array.of(1, 2, 3) };
const wireImage = { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } };

async function send(messages, { route = model, options = {}, read = () => pixels, policy = {} } = {}) {
  const requests = [];
  const fetch = (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  const events = await Array.fromAsync(streamKilo({ ...options, messages }, route, fetch, {
    ...policy, getAttachments: () => ({ readImageRequest: read }),
  }));
  return { requests, finish: events.at(-1).reason };
}

test('Kilo sends image renditions in their original order and leaves offloaded references as text', async () => {
  const read = (attachment, target, signal) => {
    assert.deepEqual(attachment, image.attachment);
    assert.equal(target.maxBytes, 4 * 1024 * 1024);
    assert.equal(signal.aborted, false);
    return pixels;
  };
  const { requests, finish } = await send([
    { role: 'user', content: [text('first'), image, text('last')] },
    { role: 'user', content: [{ ...image, offloaded: true }] },
  ], { read });
  assert.equal(finish.kind, 'stop');
  assert.deepEqual(requests[0].messages, [
    { role: 'user', content: [text('first'), wireImage, text('last')] },
    { role: 'user', content: '[该图片已从模型上下文移出]' },
  ]);
});

test('Kilo groups images after all matching tool results and keeps their provenance', async () => {
  const calls = ['1', '2'].map(id => ({ type: 'tool-call', id, name: 'see', arguments: '{}' }));
  const { requests } = await send([
    { role: 'assistant', content: calls },
    { role: 'tool', toolCallId: '1', content: [text('result'), image] },
    { role: 'tool', toolCallId: '2', content: [text('more')] },
    { role: 'user', content: [text('continue')] },
  ]);
  assert.deepEqual(requests[0].messages.slice(1), [
    { role: 'tool', content: 'result', tool_call_id: '1' },
    { role: 'tool', content: 'more', tool_call_id: '2' },
    { role: 'user', content: [text('Image returned by tool call 1:'), wireImage] },
    { role: 'user', content: 'continue' },
  ]);
});

test('Kilo replays native DSH search results and tool images in the next request', async () => {
  const call = (id, name) => ({ type: 'tool-call', id, name, arguments: '{}' });
  const result = (id, content) => ({
    role: 'user', source: { kind: 'tool', callId: id },
    content: [{ type: 'tool-result', toolCallId: id, isError: false, content }],
  });
  const { requests, finish } = await send([
    { role: 'user', content: [text('Search for the photo')] },
    { role: 'assistant', content: [call('1', 'web_search'), call('2', 'photo')] },
    result('1', [text('search hit')]),
    { role: 'user', content: [
      ...result('2', [image]).content,
      ...result('unmatched', [text('ignore this result')]).content,
      text('Describe the photo'),
    ] },
  ]);
  assert.equal(finish.kind, 'stop');
  assert.deepEqual(requests[0].messages, [
    { role: 'user', content: 'Search for the photo' },
    { role: 'assistant', content: null, tool_calls: [
      { id: '1', type: 'function', function: { name: 'web_search', arguments: '{}' } },
      { id: '2', type: 'function', function: { name: 'photo', arguments: '{}' } },
    ] },
    { role: 'tool', tool_call_id: '1', content: 'search hit' },
    { role: 'tool', tool_call_id: '2', content: '' },
    { role: 'user', content: [text('Image returned by tool call 2:'), wireImage] },
    { role: 'user', content: 'Describe the photo' },
  ]);
});

test('Kilo enforces input modalities, image size and attachment cancellation before dispatch', async () => {
  const message = [{ role: 'user', content: [image] }];
  const textOnly = await send(message, {
    route: { ...model, inputModalities: ['text'] }, read: () => assert.fail('unexpected read'),
  });
  assert.equal(textOnly.finish.failure.code, 'UNSUPPORTED_CONTENT');
  assert.deepEqual(textOnly.requests, []);
  const tooLarge = await send(message, { read: () => ({ ...pixels, data: new Uint8Array(4 * 1024 * 1024 + 1) }) });
  assert.equal(tooLarge.finish.failure.code, 'ATTACHMENT_TOO_LARGE');
  assert.deepEqual(tooLarge.requests, []);
  const cancellation = new AbortController();
  const aborted = await send(message, { options: { signal: cancellation.signal }, read: () => { cancellation.abort(); return pixels; } });
  assert.equal(aborted.finish.kind, 'aborted');
  assert.deepEqual(aborted.requests, []);
});

test('model search configuration applies even if a caller explicitly offers web_search', async () => {
  const { requests } = await send([{ role: 'user', content: [text('hi')] }], {
    route: { ...model, webSearch: false },
    options: { tools: ['web_search', 'web_fetch'].map(name => ({ name })) },
    policy: { getWebSearchEnabled: () => assert.fail('configured off') },
  });
  assert.deepEqual(requests[0].tools.map(tool => tool.function.name), ['web_fetch']);
});
