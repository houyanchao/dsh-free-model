import { apiError, ChatGPTError, fetchRemote, jsonResponse } from './errors.js';

const modelName = value => typeof value === 'string' && value.trim() && value.length <= 200;
const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

export async function listModels(accessToken, signal) {
  const response = await fetchRemote('https://api.openai.com/v1/models', {
    signal,
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  const body = await jsonResponse(response);
  if (!response.ok) throw apiError(body, response.status, response.headers.get('x-request-id'));
  const invalidListing = () => new ChatGPTError('invalid_model_catalog', 'OpenAI 返回的模型列表不完整，请刷新。', true);
  if (!Array.isArray(body?.models)) throw invalidListing();
  return body.models.filter(model => model?.visibility === 'list').map(model => {
    if (!modelName(model.slug) || !modelName(model.display_name)) throw invalidListing();
    const result = { slug: model.slug, displayName: model.display_name };
    if (typeof model.supports_web_search === 'boolean') result.webSearch = model.supports_web_search;
    if (Number.isSafeInteger(model.context_window) && model.context_window > 0) result.contextWindow = model.context_window;
    if (Number.isSafeInteger(model.max_output_tokens) && model.max_output_tokens > 0) result.maxCompletionTokens = model.max_output_tokens;
    if (Array.isArray(model.input_modalities)) {
      result.inputModalities = model.input_modalities.filter(kind => kind === 'text' || kind === 'image');
    }
    if (Array.isArray(model.supported_reasoning_levels)) {
      const levels = model.supported_reasoning_levels.map(level => typeof level === 'string' ? level : level?.effort);
      result.reasoningEfforts = [...new Set(levels.filter(effort => efforts.has(effort)))];
    }
    return result;
  });
}
