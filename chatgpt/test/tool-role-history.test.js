import assert from 'node:assert/strict';
import test from 'node:test';
import { createProvider, providerId } from '../host/provider.js';

test('ChatGPT replays current DSH tool-role results with their call IDs, errors and attachments', async () => {
  const model = 'fixture';
  let input;
  const client = {
    listModels: async () => [{ slug: model, displayName: 'Fixture' }],
    async streamResponse(request) {
      input = request.input;
      return { text: 'ok' };
    },
  };
  const adapter = createProvider(client, async () => ({
    status: 'connected', sharing: true, profileId: 'account',
  }), new AbortController().signal, {
    configuredModels: [{ id: model, inputModalities: ['text', 'image'] }],
    getAttachments: () => ({
      readImageRequest(ref) {
        assert.equal(ref.attachmentId, 'visible');
        return { mediaType: 'image/png', data: Uint8Array.of(1) };
      },
    }),
  });
  const call = (id, name) => ({ type: 'tool-call', id, name, arguments: '{}' });
  const text = value => ({ type: 'text', text: value });
  const result = (toolCallId, content, isError = false) => ({
    role: 'tool', source: { kind: 'tool', callId: toolCallId }, toolCallId, content, isError,
  });
  const events = await Array.fromAsync(adapter.stream({
    provider: providerId, model, messages: [
      { role: 'assistant', content: [call('search1', 'web_search'), call('plot2', 'plot')] },
      result('search1', [text('No results')], true),
      result('orphan', [text('ignore this')]),
      result('plot2', [
        { type: 'image', attachment: { attachmentId: 'old' }, offloaded: true },
        { type: 'image', attachment: { attachmentId: 'visible' } },
      ]),
      { role: 'user', content: [text('Explain the chart')] },
    ],
  }));
  assert.equal(events.at(-1).reason.kind, 'stop');
  assert.deepEqual(input, [
    { type: 'function_call', call_id: 'search1', name: 'web_search', namespace: 'dsh', arguments: '{}' },
    { type: 'function_call', call_id: 'plot2', name: 'plot', namespace: 'dsh', arguments: '{}' },
    { type: 'function_call_output', call_id: 'search1', output: 'Tool execution failed.\nNo results' },
    { type: 'function_call_output', call_id: 'plot2', output: [
      { type: 'input_text', text: '[图片已从模型上下文移出：old]' },
      { type: 'input_image', image_url: 'data:image/png;base64,AQ==', detail: 'auto' },
    ] },
    { role: 'user', content: 'Explain the chart' },
  ]);
});
