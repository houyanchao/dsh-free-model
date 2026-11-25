import { useId, useRef, useState } from 'react';
import { ChatGPTWorkspace } from './chatgpt/client/workspace.jsx';

const sources = ['kilo', 'chatgpt'];

export function ModelSources({ ctx, t, language, children }) {
  const id = useId();
  const tabs = useRef([]);
  const [selected, setSelected] = useState('kilo');
  const [visitedChatGPT, setVisitedChatGPT] = useState(false);

  function select(source) {
    if (source === 'chatgpt') setVisitedChatGPT(true);
    setSelected(source);
  }

  function navigate(event, index) {
    let target;
    switch (event.key) {
      case 'ArrowRight': target = (index + 1) % sources.length; break;
      case 'ArrowLeft': target = (index + sources.length - 1) % sources.length; break;
      case 'Home': target = 0; break;
      case 'End': target = sources.length - 1; break;
      default: return;
    }
    event.preventDefault();
    select(sources[target]);
    tabs.current[target].focus();
  }

  return <>
    <div className="dsh-model-sources" role="tablist" aria-label={t('sources')}>
      {sources.map((source, index) => <button key={source} type="button" role="tab" id={`${id}-${source}-tab`}
        aria-selected={source === selected} aria-controls={`${id}-${source}-panel`} tabIndex={source === selected ? 0 : -1}
        ref={button => { tabs.current[index] = button; }} onKeyDown={event => navigate(event, index)}
        onClick={() => select(source)}>{t(`${source}Tab`)}</button>)}
    </div>
    {sources.map(source => <div key={source} role="tabpanel" className="dsh-model-source-panel"
      id={`${id}-${source}-panel`} aria-labelledby={`${id}-${source}-tab`} hidden={source !== selected} tabIndex={0}>
      {source === 'kilo' ? children : visitedChatGPT && <ChatGPTWorkspace ctx={ctx} language={language} active={selected === source} />}
    </div>)}
  </>;
}
