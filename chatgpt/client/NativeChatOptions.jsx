import { useSyncExternalStore } from 'react';
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import { KILO_PROVIDER } from '../../catalog.js';
import { providerId } from '../shared/identity.js';
import { useChatOptions } from './use-chat-options.js';

function SearchRetry({ t, message, retry }) {
  return <button type="button" className="omgpt-search-retry" title={message} onClick={retry}>
    {t('searchRetry')}<span className="omgpt-search-sr" role="alert">{message}</span>
  </button>;
}

function SessionSearch({ id, provider, model, catalogGroups, preset, t }) {
  const { settings, saving, save, error, retry } = useChatOptions(id, provider, model, catalogGroups, preset);
  if (!settings) {
    return error ? <SearchRetry t={t} message={error.message || t('searchLoadFailed')} retry={retry} /> : null;
  }
  const { enabled, available } = settings;
  const help = t(available ? 'searchHelp' : 'searchUnavailable');
  return <div className="omgpt-search-tool" aria-busy={Boolean(saving)}>
    <label title={help} className="omgpt-search-label" data-unavailable={!available || undefined}>
      <span>{t('webSearch')}</span>
      <Switch disabled={saving || !available} checked={enabled && available} label={t('webSearch')} title={help}
        onChange={value => { void save(value); }} />
    </label>
    {!available && <>
      <span role="status" className="omgpt-search-note">{help}</span>
      <button type="button" className="omgpt-search-retry" onClick={retry}>{t('searchRecheck')}</button>
    </>}
    {error && <span role="alert" className="omgpt-search-note" title={error.message || undefined}>{t('saveFailed')}</span>}
  </div>;
}

function ConnectedSearch({ useConnection, ...props }) {
  const { id, model, t } = props;
  const { connection, error, refresh } = useConnection();
  if (error) return <SearchRetry t={t} message={t('requestFailed')} retry={() => { void refresh(); }} />;
  if (connection?.status !== 'connected' || !connection.sharing || !connection.profileId) return null;
  return <SessionSearch key={JSON.stringify([id, model, connection.profileId])} {...props} />;
}

function ModelSearch({ directory, agentPreset, id, t, useConnection }) {
  const preset = useSyncExternalStore(agentPreset.subscribe, agentPreset.getSnapshot);
  const { current, routable, groups } = useSyncExternalStore(directory.subscribe, directory.getSnapshot);
  if (!current?.model || routable === false) return null;
  const { provider, model } = current;
  const props = { id, provider, model, catalogGroups: groups, preset, t };
  if (provider === KILO_PROVIDER) return <SessionSearch key={JSON.stringify([id, model])} {...props} />;
  if (provider === providerId) return <ConnectedSearch {...props} useConnection={useConnection} />;
  return null;
}

export function registerNativeChatOptions(ctx, useConnection) {
  ctx.inject(['slots', 'sessions', 'modelDirectories'], scope => {
    scope.slots.inject('conversation.input.left', () => scope.slots.register({
      name: 'conversation.input.left', id: providerId, order: 0, locale: providerId,
      inject: id => {
        if (scope.sessions.subagentAddress(id) !== undefined) return {};
        const binding = scope.sessions.binding(id);
        if (!binding) return {};
        return { id, directory: scope.modelDirectories.directoryFor(id).store,
          agentPreset: binding.session.projections.faceOf('agentPreset') };
      },
    }, function NativeSearch({ id, directory, agentPreset, t }) {
      return directory ? <ModelSearch id={id} directory={directory} agentPreset={agentPreset} t={t} useConnection={useConnection} /> : null;
    }));
  });
}
