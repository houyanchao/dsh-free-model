import { apiBase } from '../shared/identity.js';
import { ModelList } from '../../model-list.jsx';
import { useEffect, useId, useRef, useState } from 'react';
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import { SourceHeading } from './SourceHeading.jsx';
import { PanelIcon } from './PanelIcon.jsx';
import styles from './model-catalog.css';

const copy = {
  zh: {
    inputs: '输入类型', effort: '推理等级', standard: '模型默认',
    toggle: name => `在模型选择器中显示 ${name}`, failed: '无法更改此模型的显示状态，请重试。',
    notListed: '当前套餐暂未提供此模型', unverified: '暂时无法确认可用性',
    modalities: { text: '文本', image: '图片' },
    levels: { none: '关闭', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最大' },
  },
  en: {
    inputs: 'Input types', effort: 'Reasoning effort', standard: 'Model default',
    toggle: name => `Show ${name} in the model picker`, failed: 'Could not change this model’s visibility. Try again.',
    notListed: 'Unavailable on the current plan', unverified: 'Availability could not be verified',
    modalities: { text: 'Text', image: 'Images' },
  },
};

function ModelRow({ model, words, joiner, disabled, unavailableLabel, status, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const enabled = model.available && model.enabled;
  const inputs = model.inputModalities?.map(key => words.modalities[key] ?? key).join(joiner);
  const levels = model.reasoning?.efforts?.map(level => words.levels?.[level.id] ?? level.name ?? level.id).join(joiner);
  return <li className="dsh-model-hub-row omgpt-model-row" aria-disabled={!model.available || undefined}>
    {model.available ? <button type="button" className="omgpt-model-disclosure" aria-expanded={expanded} aria-controls={detailsId}
      onClick={() => setExpanded(!expanded)}>
      <span className="dsh-model-hub-row-name">{model.name}<PanelIcon name="down" size={13} /></span>
      {model.id !== model.name && <code className="dsh-model-hub-row-id">{model.id}</code>}
    </button> : <div>
      <div className="dsh-model-hub-row-heading">
        <span className="dsh-model-hub-row-name">{model.name}</span>
        <span className="dsh-model-hub-unavailable">{unavailableLabel}</span>
      </div>
      {model.id !== model.name && <code className="dsh-model-hub-row-id">{model.id}</code>}
    </div>}
    <div className="omgpt-model-switch" aria-busy={status === 'saving'}>
      <Switch checked={enabled} label={words.toggle(model.name)} disabled={!model.available || disabled || status === 'saving'}
        onChange={value => onChange(model.id, value)} />
    </div>
    <dl id={detailsId} className="omgpt-model-facts" hidden={!model.available || !expanded}>
      {inputs && <div><dt>{words.inputs}</dt><dd>{inputs}</dd></div>}
      <div><dt>{words.effort}</dt><dd>{levels || words.standard}</dd></div>
    </dl>
    {status === 'error' && <p role="alert" className="omgpt-error">{words.failed}</p>}
  </li>;
}

export function ModelCatalog({ t, language, resource, profileId, hint, children }) {
  const heading = useId();
  const words = copy[language] ?? copy.zh;
  const { data: models, error, refresh, refreshing, update } = resource;
  const writes = useRef(new Map());
  const [status, setStatus] = useState(new Map());
  useEffect(() => {
    const active = writes.current;
    setStatus(new Map());
    return () => {
      for (const controller of active.values()) controller.abort();
      active.clear();
    };
  }, [profileId]);

  function setRowStatus(id, value) {
    setStatus(previous => {
      const next = new Map(previous);
      if (value) next.set(id, value);
      else next.delete(id);
      return next;
    });
  }

  async function changeVisibility(model, enabled) {
    if (!profileId || refreshing || writes.current.has(model) || !models?.some(row => row.id === model && row.available)) return;
    const controller = new AbortController();
    const { signal } = controller;
    writes.current.set(model, controller);
    setRowStatus(model, 'saving');
    try {
      const response = await fetch(`${apiBase}/model-visibility`, {
        method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, signal,
        body: JSON.stringify({ profileId, model, enabled }),
      });
      if (!response.ok) throw new Error();
      const saved = await response.json();
      if (saved.model !== model || saved.enabled !== enabled) throw new Error();
      if (signal.aborted) return;
      update(current => current?.map(row => row.id === model ? { ...row, enabled: saved.enabled } : row));
      setRowStatus(model, null);
    } catch {
      if (!signal.aborted) setRowStatus(model, 'error');
    } finally {
      if (writes.current.get(model) === controller) writes.current.delete(model);
    }
  }

  return <div className="omgpt-catalog">
    <style>{styles}</style>
    <SourceHeading id={heading} title={t('planModels')} hint={hint ?? t('planHint')}>
      <button type="button" className="omgpt-icon-button" onClick={refresh} disabled={refreshing || Array.from(status.values()).includes('saving')}
        aria-busy={refreshing} aria-label={t('refreshModels')} title={t('refreshModels')}>
        <PanelIcon name="refresh" size={16} />
      </button>
    </SourceHeading>
    {children}
    {error !== null && <p role="alert" className="omgpt-error">{error || t('modelsFailed')}</p>}
    {error === null && !models?.length && <p role="status">{t(models ? 'modelsEmpty' : 'modelsLoading')}</p>}
    {models?.length > 0 && <ModelList labelledBy={heading} language={language} models={models}
      renderRow={model => <ModelRow key={model.id} model={model} words={words} joiner={language === 'en' ? ', ' : '、'}
        unavailableLabel={!profileId ? t('noConsent') : error !== null ? words.unverified : words.notListed}
        disabled={!profileId || refreshing} status={status.get(model.id)} onChange={changeVisibility} />} />}
  </div>;
}
