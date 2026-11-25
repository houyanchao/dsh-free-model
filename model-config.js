import catalog from '#openmodel-models' with { type: 'json' };

const fields = new Set(['id', 'name', 'inputModalities', 'reasoningEfforts', 'webSearch', 'contextWindow', 'maxCompletionTokens']);

function stringList(value, accepts) {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && accepts(item))
    && new Set(value).size === value.length;
}

function validateModels(rows, path) {
  if (!Array.isArray(rows)) throw new TypeError(`models.json: ${path} must be an array.`);
  const ids = new Set();
  for (const [index, row] of rows.entries()) {
    const invalid = field => { throw new TypeError(`models.json: invalid ${path}[${index}].${field}`); };
    if (typeof row?.id !== 'string' || !row.id.trim() || row.id.trim() !== row.id || ids.has(row.id)) invalid('id');
    for (const field of Object.keys(row)) if (!fields.has(field)) invalid(field);
    if (row.name !== undefined && (typeof row.name !== 'string' || !row.name.trim())) invalid('name');
    if (row.inputModalities !== undefined && (!stringList(row.inputModalities, mode => mode === 'text' || mode === 'image')
      || !row.inputModalities.includes('text'))) invalid('inputModalities');
    if (row.reasoningEfforts !== undefined && !stringList(row.reasoningEfforts, effort => /^[a-z][a-z0-9_-]*$/.test(effort))) invalid('reasoningEfforts');
    if (row.webSearch !== undefined && typeof row.webSearch !== 'boolean') invalid('webSearch');
    for (const field of ['contextWindow', 'maxCompletionTokens']) {
      if (row[field] !== undefined && (!Number.isSafeInteger(row[field]) || row[field] <= 0)) invalid(field);
    }
    ids.add(row.id);
  }
}

export function parseModelSources(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('models.json: expected an object keyed by source ID.');
  }
  const byId = new Map();
  for (const [id, value] of Object.entries(config)) {
    if (!id || id !== id.trim()) throw new TypeError('models.json: invalid source ID.');
    // Earlier configurations used a model array directly as the value.
    const source = Array.isArray(value) ? { models: value } : value;
    if (!source || typeof source !== 'object') {
      throw new TypeError(`models.json: ${id} must be a source object.`);
    }
    if (source.name !== undefined && (typeof source.name !== 'string' || !source.name.trim())) {
      throw new TypeError(`models.json: invalid ${id}.name`);
    }
    validateModels(source.models, `${id}.models`);
    byId.set(id, source);
  }
  return byId;
}

const sources = parseModelSources(catalog);

export function getConfiguredSource(id) {
  return sources.get(id);
}

/** Narrow the provider's verified capabilities for a configured, available model. */
export function applyModelConfig(model, row) {
  const result = { ...model };
  if (row.name) result.name = row.name;
  if (row.webSearch !== undefined) result.webSearch = row.webSearch && model.webSearch !== false;
  if (row.inputModalities) {
    result.inputModalities = row.inputModalities.filter(mode => model.inputModalities?.includes(mode));
  }
  if (row.reasoningEfforts) {
    const allowed = new Set(row.reasoningEfforts);
    if (model.reasoningChoices) result.reasoningChoices = model.reasoningChoices.filter(choice => allowed.has(choice.id));
    if (model.reasoning) {
      const efforts = model.reasoning.efforts.filter(choice => allowed.has(choice.id));
      if (efforts.length) result.reasoning = { ...model.reasoning, efforts };
      else delete result.reasoning;
    }
  }
  if (row.contextWindow !== undefined) {
    result.context = { ...model.context, contextWindow: Math.min(row.contextWindow, model.context?.contextWindow ?? Infinity) };
  }
  if (row.maxCompletionTokens !== undefined) {
    result.maxCompletionTokens = Math.min(row.maxCompletionTokens, model.maxCompletionTokens ?? Infinity);
  }
  return result;
}
