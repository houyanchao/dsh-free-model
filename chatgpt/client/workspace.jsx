import { useCallback, useEffect, useState } from 'react';
import { Button, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { providerId } from '../shared/identity.js';
import { isAccountDialogAction, request, useConnection } from './connection.js';
import { chatLanguage, dictionaries, translate } from './locales.js';
import { ModelCatalog } from './ModelCatalog.jsx';
import { PanelIcon } from './PanelIcon.jsx';
import { registerNativeChatOptions } from './NativeChatOptions.jsx';
import chatGPTMark from './assets/chatgpt-button-black-21.svg';
import styles from './workspace.css';
import searchStyles from './native-chat-options.css';

function profileName(profile) {
  return profile.identity?.email || profile.identity?.name || profile.label;
}

function LoginScreen({ t, state }) {
  const { connection, pending, error, refresh, run } = state;
  const waiting = connection?.status === 'connecting' || pending === 'sign-in' || pending === 'cancel';
  const profiles = connection?.profiles ?? [];
  const signedIn = profiles.filter(profile => !profile.pending && profile.status === 'connected');
  const choosing = connection?.available && !waiting && signedIn.length > 0;
  const current = profiles.find(profile => profile.id === connection?.profileId);
  const differentAccount = (error?.code || connection?.error?.code) === 'account_mismatch';
  const failure = error || connection?.error;
  const message = differentAccount ? t('differentAccount')
    : failure && failure.code !== 'cancelled' ? failure.message || t('requestFailed') : null;
  let title = t('connectTitle');
  let hint = t('subtitle');
  if (waiting) {
    title = t('browserTitle');
    hint = t('authorizeHint');
  } else if (!connection) {
    title = t(error ? 'connectionFailed' : 'planModels');
    hint = error ? null : t('loading');
  } else if (!connection.available) {
    title = t('desktopTitle');
    hint = t('unavailable');
  } else if (choosing) {
    title = t('chooseSignedIn');
    hint = t('planHint');
  }

  function signIn() {
    // The SDK binds existing registrations to an identity. Reuse a saved connection
    // for returning users and an unfinished registration when there is no bound one.
    const existing = !differentAccount && !current?.requiresNewRegistration && current;
    const target = existing || profiles.find(profile => profile.pending);
    void run('sign-in', target ? { profileId: target.id } : { newProfile: true });
  }

  return <div className="omgpt-login">
    <span className="omgpt-login-icon" aria-hidden="true"><PanelIcon name="account" size={24} /></span>
    <h2>{title}</h2>
    {hint && <p className="omgpt-login-hint" role={waiting || !connection ? 'status' : undefined}>{hint}</p>}
    {message && <p className="omgpt-error" role="alert">{message}</p>}
    <div className="omgpt-actions">
      {!connection && error && <Button variant="outline" size="sm" onClick={() => { void refresh(); }}>{t('retry')}</Button>}
      {waiting && <Button variant="outline" size="sm" disabled={pending === 'cancel'}
        onClick={() => { void run('cancel'); }}>{t('cancel')}</Button>}
      {choosing && signedIn.map(profile => <Button key={profile.id} variant="outline" size="sm" disabled={Boolean(pending)}
        onClick={() => { void run('select-profile', { profileId: profile.id }); }}>{profileName(profile)}</Button>)}
      {connection?.available && !waiting && !choosing && <Button className="omgpt-primary" variant="primary" size="sm"
        disabled={Boolean(pending)} onClick={signIn}><img className="omgpt-mark" src={chatGPTMark} width="16" height="16" alt="" />{t('signIn')}</Button>}
    </div>
  </div>;
}

function AccountRow({ profile, current, busy, t, run }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { id, identity, sharing } = profile;
  const connected = !profile.pending && profile.status === 'connected';
  const email = identity?.email;
  const display = identity?.name || email || profile.label || t('identityFallback');
  const secondaryEmail = email !== display ? email : undefined;
  const initials = identity?.name?.trim().split(/\s+/u).slice(0, 2).map(part => Array.from(part)[0]).join('');
  let status;
  if (profile.pending) status = 'pendingAccount';
  else if (profile.status === 'reauth_required') status = 'expiredAccount';
  else if (!connected) status = 'signedOut';
  else if (!sharing) status = 'noConsent';

  return <li className="omgpt-profile">
    <span className="omgpt-profile-avatar" aria-hidden="true">{initials || <PanelIcon name="account" size={19} />}</span>
    <div className="omgpt-profile-text">
      <div className="omgpt-profile-name">
        <strong>{display}</strong>
        {current && connected && <span className="omgpt-current-account">{t('activeAccount')}</span>}
      </div>
      {(secondaryEmail || status) && <div className="omgpt-profile-meta">
        {secondaryEmail && <span>{secondaryEmail}</span>}
        {status && <span>{t(status)}</span>}
      </div>}
    </div>
    <div className="omgpt-profile-actions">
      {connected ? <>
        {!current && <button type="button" className="omgpt-account-action" disabled={busy}
          aria-label={t('switchToAccount', { label: profileName(profile) })}
          onClick={() => { void run('select-profile', { profileId: id }); }}>{t('switchAccount')}</button>}
        <Menu open={menuOpen && !busy} align="end" portal autoFocus dense
          anchor={<button type="button" className="omgpt-account-more" disabled={busy}
            aria-label={t('accountOptions', { label: profileName(profile) || display })} aria-haspopup="menu"
            aria-expanded={menuOpen && !busy} onClick={() => setMenuOpen(open => !open)}><PanelIcon name="more" /></button>}
          items={[{ type: 'label', id: 'account', text: email || display },
            { id: 'sign-out', label: t('signOut'), icon: <PanelIcon name="signOut" size={16} /> }]}
          onClose={() => setMenuOpen(false)}
          onSelect={() => { setMenuOpen(false); void run('sign-out-profile', { profileId: id }); }} />
      </> : <button type="button" className="omgpt-account-action" disabled={busy} aria-haspopup="dialog"
        onClick={() => { void run('add-account', { profileId: id }); }}>
        {t(profile.pending ? 'resumeAccount' : 'reconnectAccount')}
      </button>}
    </div>
  </li>;
}

function Account({ t, state }) {
  const { connection, pending, error, run } = state;
  const { profileId, profiles = [] } = connection;
  const rows = profiles.filter(profile => profile.status === 'connected' || !profile.requiresNewRegistration);
  if (profileId && connection.status === 'connected' && !rows.some(profile => profile.id === profileId)) {
    rows.unshift({ id: profileId, label: connection.profileLabel, identity: connection.identity,
      status: connection.status, sharing: connection.sharing });
  }
  const waiting = connection.status === 'connecting' || pending === 'enable' || pending === 'cancel';
  const busy = waiting || (Boolean(pending) && !isAccountDialogAction(pending));
  const needsConsent = connection.status === 'connected' && !connection.sharing;
  const message = error ? !isAccountDialogAction(error.action) && (error.message || t('requestFailed')) : !waiting && connection.error?.message;

  return <div className="omgpt-account">
    <ul className="omgpt-profile-list">
      {rows.map(profile => <AccountRow key={profile.id} profile={profile} current={profile.id === profileId}
        busy={busy} t={t} run={run} />)}
    </ul>
    {message && <p className="omgpt-error" role="alert">{message}</p>}
    {waiting ? <div className="omgpt-account-flow">
      <p role="status">{t('connecting')}</p>
      <div className="omgpt-actions">
        <Button variant="outline" size="sm" disabled={pending === 'cancel'}
          onClick={() => { void run('cancel'); }}>{t('cancel')}</Button>
      </div>
    </div> : needsConsent && <div className="omgpt-account-flow">
      <div className="omgpt-actions">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => { void run('enable', { profileId }); }}>{t('enable')}</Button>
      </div>
    </div>}
    <button type="button" className="omgpt-account-add" disabled={busy} aria-haspopup="dialog"
      onClick={() => { void run('add-account', { newProfile: true }); }}>
      <PanelIcon name="plus" size={17} />{t('newAccount')}
    </button>
  </div>;
}

function useModelCatalog(profileId) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => { setRevision(value => value + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setRefreshing(true);
    void (async () => {
      try {
        const result = await readModels(profileId, signal, revision > 0);
        if (!signal.aborted) {
          // Account status and catalog are separate requests. An account may have
          // connected in between, before this view has its profile ID.
          setData(profileId ? result.models : result.models.map(model => ({ ...model, available: false, enabled: false })));
          setError(result.catalogError ?? null);
        }
      } catch (failure) {
        if (!signal.aborted) {
          setError(failure?.message ?? '');
          setData(current => current?.map(model => ({ ...model, available: false })) ?? null);
        }
      } finally {
        if (!signal.aborted) setRefreshing(false);
      }
    })();
    return () => { controller.abort(); };
  }, [profileId, revision]);

  return { data, error, refresh, refreshing, update: setData };
}

async function readModels(profileId, signal, force) {
  const query = new URLSearchParams();
  if (profileId) query.set('profileId', profileId);
  if (force) query.set('refresh', '1');
  const data = await request(query.size ? 'models?' + query : 'models', signal);
  if (!Array.isArray(data?.models) || !data.models.every(model =>
    typeof model?.id === 'string' && typeof model.name === 'string'
    && typeof model.available === 'boolean' && typeof model.enabled === 'boolean')) throw new Error();
  return data;
}

function WorkspaceBody({ t, language, state, profileId }) {
  const { connection, pending, run } = state;
  const models = useModelCatalog(profileId);
  if (!profileId) return <ModelCatalog t={t} language={language} resource={models} hint={t('needsConsent')}>
    <Account t={t} state={state} />
  </ModelCatalog>;
  const activeProfile = connection.profiles?.find(profile => profile.id === profileId);
  const activeName = (activeProfile && profileName(activeProfile)) || connection.identity?.email
    || connection.identity?.name || connection.profileLabel || t('identityFallback');
  return <>
    <ModelCatalog t={t} language={language} resource={models} profileId={profileId}>
      <details className="omgpt-details omgpt-account-details">
        <summary>
          <PanelIcon name="account" size={18} />
          <span className="omgpt-account-identity"><span>{t('activeAccount')}</span> {activeName}</span>
          <span className="omgpt-manage-label">{t('manageAccounts')}</span><PanelIcon name="down" size={15} />
        </summary>
        <Account t={t} state={state} />
      </details>
    </ModelCatalog>
    {connection.features?.webSearch &&
      <details className="omgpt-details omgpt-legacy-defaults">
        <summary>{t('legacyDefaults')}<PanelIcon name="down" size={15} /></summary><p>{t('legacyHint')}</p>
        <Button variant="outline" size="sm" disabled={Boolean(pending)} onClick={() => {
          void run('features', { ...connection.features, webSearch: false });
        }}>{t('resetDefaults')}</Button>
      </details>}
  </>;
}

export function ChatGPTWorkspace({ ctx, language, active = true }) {
  const selectedLanguage = chatLanguage(language, ctx);
  const t = translate(selectedLanguage);
  const state = useConnection();
  const { connection, pending, error, run, dismissError } = state;
  const authorizing = connection?.addingAccount || isAccountDialogAction(pending);
  const dialogError = isAccountDialogAction(error?.action) ? error : null;
  const dialogOpen = active && Boolean(authorizing || dialogError);
  function closeDialog() {
    if (authorizing) {
      if (pending !== 'cancel-add') void run('cancel-add');
    } else dismissError();
  }
  const connectedProfile = connection?.profiles?.some(profile => profile.id === connection.profileId && profile.status === 'connected' && !profile.pending);
  const signedIn = connection?.available && (connection.status === 'connected' || (connection.status === 'connecting' && connectedProfile));
  const profileId = signedIn && connection.status === 'connected' && connection.sharing ? connection.profileId : undefined;
  let body = <LoginScreen t={t} state={state} />;
  if (signedIn) {
    body = connection.status === 'connecting' ? <Account t={t} state={state} />
      : <WorkspaceBody key={profileId ?? ''} t={t} language={selectedLanguage} state={state} profileId={profileId} />;
  }
  return <section className="omgpt-workspace" aria-label="ChatGPT">
    <div inert={dialogOpen ? '' : undefined}>{body}</div>
    <Modal open={dialogOpen} title={t(dialogError ? 'authorizationFailed' : 'browserTitle')}
      description={dialogError ? dialogError.message || t('requestFailed') : t('authorizeHint')}
      closeLabel={t(authorizing ? 'cancel' : 'close')} onClose={closeDialog}
      footer={<Button variant="outline" autoFocus disabled={pending === 'cancel-add'} onClick={closeDialog}>
        {t(authorizing ? 'cancel' : 'close')}
      </Button>} />
  </section>;
}

export function registerChatGPTClient(ctx) {
  ctx.effect(() => ctx.locale.register(providerId, dictionaries), 'Model Center ChatGPT translations');
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = providerId;
    style.textContent = [styles, searchStyles].join('\n');
    document.head.append(style);
    return () => style.remove();
  }, 'Model Center ChatGPT styles');
  registerNativeChatOptions(ctx, useConnection);
}
