import { Fragment, useId, useRef, useState } from 'react';
import styles from './model-list.css';

const copy = {
  zh: {
    search: '按名称或模型 ID 搜索', clear: '清除搜索', filter: '按模型显示状态筛选',
    all: '全部模型', enabled: '已开启', hidden: '已隐藏', unavailable: '不可用', name: '模型名称',
    count: (enabled, total) => `已开启 ${enabled} / ${total}`,
    matches: count => `${count} 个结果`, noMatch: '没有找到匹配的模型',
    noneEnabled: '没有已开启的模型', noneHidden: '没有已隐藏的模型', noneUnavailable: '没有不可用的模型', empty: '暂无模型',
    showAll: '查看全部模型', reset: '清除搜索和筛选',
  },
  en: {
    search: 'Search by name or model ID', clear: 'Clear search', filter: 'Filter by model visibility',
    all: 'All models', enabled: 'Enabled', hidden: 'Hidden', unavailable: 'Unavailable', name: 'Model name',
    count: (enabled, total) => `${enabled} of ${total} enabled`,
    matches: count => `${count} ${count === 1 ? 'result' : 'results'}`, noMatch: 'No matching models',
    noneEnabled: 'No enabled models', noneHidden: 'No hidden models', noneUnavailable: 'No unavailable models', empty: 'No models available',
    showAll: 'Show all models', reset: 'Clear search and filter',
  },
};

function normalize(text) {
  return text.normalize('NFKC').trim().toLowerCase();
}

export function ModelList({ label, labelledBy, language, models, renderRow, headerActions, children }) {
  const words = copy[language] ?? copy.zh;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const searchRef = useRef(null);
  const filterRef = useRef(null);
  const resultsId = useId();
  const term = normalize(query);
  const filtered = term.length > 0 || filter !== 'all';
  const visible = models.filter(model => {
    const status = !model.available ? 'unavailable' : model.enabled ? 'enabled' : 'hidden';
    if (filter !== 'all' && status !== filter) return false;
    return !term || normalize(model.name).includes(term) || normalize(model.id).includes(term);
  });
  const summary = [
    filtered && models.length > 0 && words.matches(visible.length),
    !headerActions && words.count(models.filter(model => model.available && model.enabled).length, models.length),
  ].filter(Boolean).join(' · ');

  function clearSearch() {
    setQuery('');
    searchRef.current?.focus();
  }

  function reset() {
    setFilter('all');
    if (term) clearSearch();
    else filterRef.current?.focus();
  }

  const noResults = term ? words.noMatch : {
    hidden: words.noneHidden, enabled: words.noneEnabled, unavailable: words.noneUnavailable, all: words.empty,
  }[filter];
  const resetLabel = !term ? words.showAll : filter === 'all' ? words.clear : words.reset;

  return <div className="dsh-model-hub-models">
    <style>{styles}</style>
    {models.length > 0 && <div className="dsh-model-hub-toolbar">
      <div className="dsh-model-hub-search">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" />
        </svg>
        <input ref={searchRef} type="search" value={query} placeholder={words.search} aria-label={words.search}
          aria-controls={resultsId} onChange={event => setQuery(event.target.value)} />
        {query && <button type="button" className="dsh-model-hub-clear" aria-label={words.clear} title={words.clear} onClick={clearSearch}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="m4.5 4.5 7 7m0-7-7 7" />
          </svg>
        </button>}
      </div>
      <div className="dsh-model-hub-filter">
        <select ref={filterRef} value={filter} aria-label={words.filter} aria-controls={resultsId}
          onChange={event => setFilter(event.target.value)}>
          <option value="all">{words.all}</option>
          <option value="enabled">{words.enabled}</option>
          <option value="hidden">{words.hidden}</option>
          <option value="unavailable">{words.unavailable}</option>
        </select>
      </div>
    </div>}
    <div id={resultsId}>
      <div className="dsh-model-hub-columns">
        <span>{words.name}</span>
        <span role="status">{summary}</span>
        {headerActions}
      </div>
      {children}
      {visible.length > 0 ? <ul className="dsh-model-hub-list" aria-label={label} aria-labelledby={labelledBy}>
        {visible.map(model => <Fragment key={model.id}>{renderRow(model)}</Fragment>)}
      </ul> : models.length > 0 && <div className="dsh-model-hub-empty">
        <p>{noResults}</p>
        {filtered && <button type="button" onClick={reset}>{resetLabel}</button>}
      </div>}
    </div>
  </div>;
}
