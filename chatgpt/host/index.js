import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createChatGPT, isAddingAccount } from './chatgpt/client.js';
import { mountChatOptions } from './chat-options.js';
import { createUsageStore, mountActivity } from './activity.js';
import { createCredentialEncryption } from './credential-encryption.js';
import { mountFileInputs } from './files.js';
import { isDesktopHost, openBrowser } from './platform.js';
import { createPreferences } from './preferences.js';
import { createProvider, planEnabled, pluginError, providerId } from './provider.js';
import { apiBase } from '../shared/identity.js';

export const name = providerId;
export const inject = ['llm', 'connection'];

const disconnected = { status: 'disconnected', sharing: false };

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

function publicError(error) {
  if (typeof error?.code !== 'string' || typeof error.message !== 'string') {
    return { code: 'chatgpt_connection_failed', message: 'ChatGPT 连接失败，请重试。' };
  }
  return { code: error.code, message: error.message };
}

function publicIdentity(identity) {
  return identity && { name: identity.name, email: identity.email };
}

async function profileInput(request, { allowNew = false, requireId = false } = {}) {
  const input = request.body ? await request.json().catch(() => undefined) : {};
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => key !== 'profileId' && !(allowNew && key === 'newProfile'))
    || (input.profileId !== undefined && (typeof input.profileId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(input.profileId)))
    || (input.newProfile !== undefined && input.newProfile !== true)
    || (input.profileId && input.newProfile) || (requireId && !input.profileId)) {
    throw pluginError('invalid_profile', '请选择有效的 ChatGPT 账号操作。');
  }
  return input;
}

export function mountChatGPT(ctx, {
  client, available, credentialEncryption, preferences = createPreferences(), usageStore = createUsageStore(),
  onProviderRegistered, getWebSearchEnabled, webSearchSettings, registerChatGPTSearch, configuredModels,
}) {
  const lifetime = new AbortController();
  const signedOutProfiles = new Set();
  let session = disconnected;
  let account = new AbortController();
  let transition;
  let signingOutProfile;
  let signedOutUnknownProfile = false;
  let disposed = false;

  function locallySignedOut(profileId) {
    return signedOutUnknownProfile || signedOutProfiles.has(profileId);
  }

  function accountBlocked() {
    return transition && !transition.preparing && !transition.addingAccount;
  }

  function invalidateAccount() {
    account.abort();
    account = new AbortController();
  }

  function visibleSession(current) {
    if (!available || disposed) return disconnected;
    if (transition?.kind === 'disconnect') return { ...current, ...disconnected };
    if (accountBlocked()) return { ...current, status: 'connecting', sharing: false, error: undefined };
    if (locallySignedOut(current.profileId)) return { ...current, ...disconnected };
    return current;
  }

  async function getSession() {
    const { signal: accountSignal } = account;
    if (available && !disposed && !accountBlocked()) {
      const current = await client.getSession();
      if (accountSignal.aborted) return { ...disconnected, accountSignal };
      session = current;
    }
    return { ...visibleSession(session), accountSignal };
  }

  if (available && typeof ctx.llm.fileRequestText === 'function') mountFileInputs(ctx, providerId);
  const getPreferences = (id, profile) => (id && profile ? usageStore.chatOptions(id, profile) : undefined) ?? preferences.get();
  const adapter = createProvider(client, getSession, lifetime.signal, {
    getAttachments: () => ctx.get?.('attachments'),
    getPreferences, getWebSearchEnabled, configuredModels,
    getChatOwner: sessionId => usageStore.owner(sessionId),
    getHiddenModels: profileId => usageStore.hiddenModels(profileId),
    onUsage: (profileId, model, usage) => usageStore.record(profileId, model, usage),
  });
  const registration = available ? ctx.llm.registerAdapter([providerId], adapter) : undefined;
  if (registration) onProviderRegistered?.();
  function updateProvider(visible) {
    if (disposed || !registration) return;
    registration.replace(visible ? [providerId] : []);
    if (visible) onProviderRegistered?.();
  }
  mountActivity(ctx, { adapter, getSession, usageStore, onCatalogChange: () => updateProvider(true) });
  mountChatOptions(ctx, { getSession, usageStore, preferences, webSearchSettings });
  let catalog = providerId;
  function refreshCatalog(session) {
    if (disposed || !registration) return;
    const visible = visibleSession(session);
    const next = planEnabled(visible) ? visible.profileId ?? providerId : undefined;
    if (catalog === next) return;
    catalog = next;
    updateProvider(next !== undefined);
  }
  // Refreshing or revoking a grant also updates the native model catalog.
  const unsubscribe = client.subscribe(current => {
    if (transition?.addingAccount && session.profileId !== current.profileId) {
      invalidateAccount();
    }
    session = current;
    refreshCatalog(current);
  });
  ctx.effect(() => () => {
    disposed = true;
    lifetime.abort();
    account.abort();
    unsubscribe();
  }, `${name}: account lifecycle`);
  void getSession().catch(() => undefined);
  if (registerChatGPTSearch && available) {
    function canUsePlan(current, id) {
      return planEnabled(current) && Boolean(current.profileId)
        && (!id?.startsWith('chatgpt-') || usageStore.owner(id) === current.profileId);
    }
    ctx.effect(() => registerChatGPTSearch({
      async available(id, model, signal) {
        const current = await getSession();
        if (!canUsePlan(current, id)) return false;
        const entry = await adapter.resolveModel(providerId, model, signal);
        return !current.accountSignal?.aborted && entry.webSearch !== false;
      },
      async legacyEnabled(id) {
        // Free models can start immediately, even if the local account store is still opening.
        const current = visibleSession(session);
        if (!canUsePlan(current, id)) return false;
        const { signal } = account;
        const features = await getPreferences(id, current.profileId);
        const latest = visibleSession(session);
        return !signal.aborted && latest.profileId === current.profileId && planEnabled(latest) && features.webSearch;
      },
    }), `${name}: native web search`);
  }

  function beginTransition(kind) {
    lifetime.signal.throwIfAborted();
    const previous = transition;
    if (signingOutProfile || (previous && !(kind === 'disconnect' && previous.kind === 'sign-in'))) {
      throw pluginError('connection_busy', '请先完成或取消当前账号操作。');
    }
    transition = { kind, preparing: kind === 'sign-in' };
    if (accountBlocked()) invalidateAccount();
    refreshCatalog(session);
    return { current: transition, previous };
  }

  function finishTransition(current) {
    if (transition !== current) return;
    transition = undefined;
    refreshCatalog(session);
  }

  async function signIn(request, reconsent) {
    request.signal.throwIfAborted();
    const { current: attempt } = beginTransition('sign-in');
    const controller = new AbortController();
    attempt.controller = controller;
    attempt.promise = (async () => {
      const options = await profileInput(request, { allowNew: !reconsent });
      controller.signal.throwIfAborted();
      const source = !reconsent && (options.newProfile || options.profileId) ? await getSession() : undefined;
      controller.signal.throwIfAborted();
      if (source?.accountSignal.aborted) throw pluginError('connection_busy', '账号已变更，请重试。');
      attempt.addingAccount = isAddingAccount(source, options);
      attempt.preparing = false;
      if (!attempt.addingAccount) {
        invalidateAccount();
        refreshCatalog(session);
      }
      // Adding an account belongs to the host so a reopened settings page can resume or cancel it.
      const signals = [controller.signal, lifetime.signal];
      if (!attempt.addingAccount) signals.push(request.signal);
      const signal = AbortSignal.any(signals);
      signal.throwIfAborted();
      if (!await credentialEncryption.isAvailable()) {
        throw pluginError('storage_encryption_unavailable', '无法访问系统凭据存储，请检查当前系统账号后重试。');
      }
      signal.throwIfAborted();
      session = await client.signIn({ ...options, signal, reconsent });
      signedOutUnknownProfile = false;
      signedOutProfiles.delete(session.profileId);
    })();
    try {
      await attempt.promise;
    } finally {
      finishTransition(attempt);
    }
  }

  async function cancel() {
    const attempt = transition;
    if (attempt?.kind === 'sign-in') {
      attempt.controller.abort(pluginError('cancelled', '操作已取消。'));
      await attempt.promise.catch(() => undefined);
    }
  }

  async function selectProfile(request) {
    const { profileId } = await profileInput(request, { requireId: true });
    request.signal.throwIfAborted();
    const { current } = beginTransition('select-profile');
    try {
      session = await client.selectProfile(profileId);
    } finally {
      finishTransition(current);
    }
  }

  async function disconnect(request) {
    const input = await profileInput(request);
    const profileId = input.profileId ?? session.profileId;
    const { current, previous } = beginTransition('disconnect');
    try {
      if (previous) {
        previous.controller.abort(pluginError('cancelled', '操作已取消。'));
        await previous.promise.catch(() => undefined);
      }
      await client.disconnect({ expectedProfileId: profileId });
      signedOutUnknownProfile = false;
      signedOutProfiles.delete(profileId);
    } catch (error) {
      if (error?.code === 'connection_changed') throw error;
      if (profileId) signedOutProfiles.add(profileId);
      else signedOutUnknownProfile = true;
      throw error;
    } finally {
      finishTransition(current);
    }
  }

  async function signOutProfile(request) {
    const { profileId } = await profileInput(request, { requireId: true });
    request.signal.throwIfAborted();
    lifetime.signal.throwIfAborted();
    if (transition || signingOutProfile) throw pluginError('connection_busy', '请先完成或取消当前账号操作。');
    signingOutProfile = profileId;
    // Hide this grant immediately. Other profiles keep their catalog and streams.
    const alreadySignedOut = signedOutProfiles.has(profileId);
    signedOutProfiles.add(profileId);
    if (session.profileId === profileId) {
      invalidateAccount();
      refreshCatalog(session);
    }
    try {
      await client.signOutProfile(profileId);
      signedOutProfiles.delete(profileId);
    } catch (error) {
      if (!alreadySignedOut && (error?.code === 'connection_busy' || error?.code === 'profile_not_found')) {
        signedOutProfiles.delete(profileId);
      }
      throw error;
    } finally {
      signingOutProfile = undefined;
      refreshCatalog(session);
    }
  }

  async function saveFeatures(request) {
    const current = await getSession();
    if (!planEnabled(current)) throw pluginError('sharing_not_enabled', '请先授权使用 ChatGPT 套餐。');
    const value = await request.json().catch(() => undefined);
    current.accountSignal.throwIfAborted();
    await preferences.save(value);
  }

  async function publicStatus() {
    const features = await preferences.get();
    for (;;) {
      const pending = transition;
      const current = await getSession();
      const saved = available && !disposed ? await client.listProfiles().catch(() => []) : [];
      if (!disposed && (current.accountSignal.aborted || pending !== transition)) continue;
      const { status, sharing, error, identity, profileId, profileLabel } = current;
      const profiles = saved.map(profile => {
        const signedOut = locallySignedOut(profile.id);
        return {
          id: profile.id,
          label: profile.label,
          status: signedOut ? 'disconnected' : profile.status,
          sharing: !signedOut && profile.sharing === true,
          identity: publicIdentity(profile.identity),
          pending: profile.pending,
          requiresNewRegistration: profile.requiresNewRegistration,
        };
      });
      return { status, sharing, available, addingAccount: Boolean(pending?.addingAccount), identity: publicIdentity(identity), profileId, profileLabel, profiles, features, error: error ? publicError(error) : undefined };
    }
  }

  const actions = {
    status: () => undefined,
    'sign-in': request => signIn(request, false),
    enable: request => signIn(request, true),
    'select-profile': selectProfile,
    'sign-out-profile': signOutProfile,
    cancel,
    disconnect,
    features: saveFeatures,
  };
  for (const [action, run] of Object.entries(actions)) {
    ctx.connection.fetch.register({
      path: `${apiBase}/${action}`,
      methods: [action === 'status' ? 'GET' : 'POST'],
      requestBody: 'buffered',
      async fetch(request) {
        if (!available && action !== 'status') {
          return json({ error: { code: 'unavailable', message: 'ChatGPT 套餐需要在本机运行的 macOS 或 Windows 版 DeepSeek Harness。' } }, 403);
        }
        try {
          await run(request);
          return json(await publicStatus());
        } catch (error) {
          const failure = publicError(error);
          return json({ error: failure }, failure.code === 'connection_busy' ? 409 : 400);
        }
      },
    });
  }
}

function mountLocal(ctx, local, options) {
  const available = local && (process.platform === 'darwin' || process.platform === 'win32');
  const configuredHome = process.env.DSH_HOME;
  const home = configuredHome?.trim() ? configuredHome : resolve(homedir(), '.dsh');
  const useHome = home.startsWith('~/') || (process.platform === 'win32' && home.startsWith('~\\'));
  const base = home === '~' ? homedir() : useHome ? resolve(homedir(), home.slice(2)) : home;
  const storageDir = resolve(base, 'dsh-open-model', 'chatgpt');
  const credentialEncryption = createCredentialEncryption({ storageDir });
  const client = createChatGPT({
    appName: 'DeepSeek Harness (dsh-open-model)',
    appId: name,
    redirectPort: 0,
    storageDir,
    credentialEncryption,
    openBrowser,
    sendHostId: true,
  });
  mountChatGPT(ctx, { ...options, client, available, credentialEncryption,
    preferences: createPreferences(storageDir), usageStore: createUsageStore(storageDir) });
}

export function apply(ctx, options = {}) {
  // Some Desktop releases carry Connection over IPC without a Web server.
  if (typeof process.send === 'function' && isDesktopHost(process.argv[1])) {
    mountLocal(ctx, true, options);
  } else {
    ctx.inject(['webServer'], web => { mountLocal(web, web.webServer.host === '127.0.0.1', options); });
  }
}
