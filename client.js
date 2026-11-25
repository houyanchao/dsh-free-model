import { createElement as h, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Switch, Tooltip, IconSparkleRegular, IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { registerChatGPTClient } from './chatgpt/client/workspace.jsx';
import { ModelList } from './model-list.jsx';
import { ModelSources } from './model-sources.jsx';
import { PanelIcon } from './chatgpt/client/PanelIcon.jsx';
import styles from './model-page.css';

const panelId = 'dsh-free-model';
const apiPath = '/api/dsh-free-model/models';
const availabilityPath = `${apiPath}/availability`;
const updatePath = '/api/dsh-free-model/update';
const updateCheckInterval = 5 * 60 * 1000;
const packageName = 'dsh-open-model';
const repositoryUrl = 'https://github.com/houyanchao/dsh-open-model';
const npmRegistry = 'https://registry.npmjs.org/';
const publishedVersion = /^\d+\.\d+\.\d+(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;
const recommendedPlugins = [
  { name: 'dsh-timeline', description: 'timelineDescription' },
  { name: 'dsh-use-chatgpt', description: 'chatgptDescription' },
  { name: 'timeline', description: 'browserDescription', stores: [
    { label: 'chrome', href: 'https://chromewebstore.google.com/detail/fgebdnlceacaiaeikopldglhffljjlhh' },
    { label: 'edge', href: 'https://microsoftedge.microsoft.com/addons/detail/ekednjjojnhlajfobalaaihkibbdcbab' },
  ] },
];
const resultStatuses = new Set(['checking', 'available', 'unavailable']);
const emptyAvailability = { checking: false, models: [] };
const catalogReasonKeys = new Map([
  ['output-limit-unenforceable', 'outputLimitUnavailable'],
  ['provider-unavailable', 'unverified'],
  ['not-offered', 'notListed'],
]);
const reasonKeys = new Map(Object.entries({
  AUTH: 'reasonAuth', QUOTA: 'reasonQuota', RATE_LIMIT: 'reasonRateLimit', TIMEOUT: 'reasonTimeout',
  MODEL_UNAVAILABLE: 'reasonRoute', TRANSPORT: 'reasonNetwork', INVALID_REQUEST: 'reasonRequest',
  MALFORMED_RESPONSE: 'reasonFormat', EMPTY_RESPONSE: 'reasonEmpty', SERVER: 'reasonServer',
}));

const messages = {
  zh: {
    title: 'OpenModel',
    introduction: '为 DSH 提供免费模型，让 DSH 直接使用你的 ChatGPT 套餐额度。',
    sources: '模型来源', kiloTab: '免费模型', chatgptTab: 'ChatGPT',
    about: '关于 Open Model', project: 'GitHub 仓库',
    checkProgress: '测速中 {done}/{total}',
    refresh: '刷新列表',
    loading: '正在读取 Kilo 模型列表…',
    empty: '尚未配置免费模型。',
    notListed: 'Kilo 暂未提供此免费模型', unverified: '暂时无法确认可用性',
    outputLimitUnavailable: 'Kilo 无法保证配置的输出上限',
    loadError: '无法读取模型列表，请重试。',
    saveError: '无法保存此模型的显示设置，请重试。',
    toggle: '在模型选择器中显示 {name}',
    checkAvailability: '测速',
    checkingAvailability: '测速中…',
    checkCooldown: '请稍后再测',
    checkError: '测速失败，请重试。',
    checkProgressError: '无法更新测速进度，请刷新列表。',
    checking: '测速中',
    available: '可用',
    unavailable: '不可用',
    checkedAt: '检测时间 {time}',
    reasonAuth: '匿名访问被拒绝',
    reasonQuota: '免费额度不足',
    reasonRateLimit: '暂时限流',
    reasonTimeout: '超时',
    reasonRoute: '上游暂未提供模型',
    reasonNetwork: '无法连接 Kilo',
    reasonRequest: '请求被拒绝',
    reasonFormat: '响应格式异常',
    reasonEmpty: '未收到文本回复',
    reasonServer: '上游服务异常',
    reasonUnknown: '本次检测失败',
    updateBadge: '更新',
    updateTitle: '有新版本',
    updateDetails: '查看更新',
    otherPlugins: '作者的其他插件',
    timelineDescription: '为 DSH 对话添加提问时间轴、收藏夹、提示词库和多格式导出。',
    chatgptDescription: '让 DSH 直接使用你的 ChatGPT 套餐额度。',
    browserDescription: '为 ChatGPT、Gemini、DeepSeek 等网页添加对话时间轴、收藏夹和提示词库。',
    install: '安装',
    installed: '已安装',
    installing: '安装中…',
    checkInstall: '检测中…',
    retryInventory: '重新检测',
    installUnavailable: '安装不可用',
    installAction: '{name} · {action}',
    inventoryError: '无法读取已安装插件，请重新检测。',
    installError: '安装失败，请重试。',
    chrome: 'Chrome 版',
    edge: 'Edge 版',
    storeLabel: '{name} · {store}',
  },
  en: {
    title: 'OpenModel',
    introduction: 'Use free models in DSH and connect your ChatGPT account to use your plan’s allowance.',
    sources: 'Model sources', kiloTab: 'Free models', chatgptTab: 'ChatGPT',
    about: 'About Open Model', project: 'GitHub repository',
    checkProgress: 'Testing speed {done}/{total}',
    refresh: 'Refresh list',
    loading: 'Loading the Kilo model list…',
    empty: 'No free models are configured.',
    notListed: 'Currently unavailable from Kilo for free', unverified: 'Availability could not be verified',
    outputLimitUnavailable: 'Kilo cannot enforce the configured output limit',
    loadError: 'Could not load the model list. Try again.',
    saveError: 'Could not save visibility for this model. Try again.',
    toggle: 'Show {name} in the model picker',
    checkAvailability: 'Speed test',
    checkingAvailability: 'Testing speed…',
    checkCooldown: 'Check again shortly',
    checkError: 'Could not start the speed test. Try again.',
    checkProgressError: 'Could not update speed test progress. Refresh the list.',
    checking: 'Testing speed',
    available: 'Available',
    unavailable: 'Unavailable',
    checkedAt: 'Checked at {time}',
    reasonAuth: 'Anonymous access denied',
    reasonQuota: 'Free quota exhausted',
    reasonRateLimit: 'Temporarily rate limited',
    reasonTimeout: 'Request timed out',
    reasonRoute: 'Model unavailable upstream',
    reasonNetwork: 'Could not connect to Kilo',
    reasonRequest: 'Request rejected',
    reasonFormat: 'Unexpected response format',
    reasonEmpty: 'No text reply received',
    reasonServer: 'Upstream service error',
    reasonUnknown: 'Check failed',
    updateBadge: 'Update',
    updateTitle: 'Update available',
    updateDetails: 'View update',
    otherPlugins: 'More plugins by this author',
    timelineDescription: 'Add a question timeline, bookmark folders, a prompt library, and chat exports to DSH.',
    chatgptDescription: 'Use your ChatGPT plan allowance directly in DSH.',
    browserDescription: 'Add a chat timeline, bookmarks, and a prompt library to ChatGPT, Gemini, DeepSeek, and other AI chat sites.',
    install: 'Install',
    installed: 'Installed',
    installing: 'Installing…',
    checkInstall: 'Checking…',
    retryInventory: 'Check again',
    installUnavailable: 'Install unavailable',
    installAction: '{name} · {action}',
    inventoryError: 'Could not load installed plugins. Check again.',
    installError: 'Installation failed. Try again.',
    chrome: 'Chrome',
    edge: 'Edge',
    storeLabel: '{name} · {store}',
  },
};

async function request(path, signal, body) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', headers, cache: 'no-store', signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : '');
  return data;
}

function monitorUpdates(ctx) {
  let update = null;
  const listeners = new Set();
  ctx.effect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let checking = false;
    async function refresh() {
      if (checking || signal.aborted) return;
      checking = true;
      let next = update && { currentVersion: update.currentVersion };
      try {
        const data = await request(updatePath, signal);
        if (typeof data?.currentVersion === 'string') {
          next = { currentVersion: data.currentVersion };
          if (data.status === 'update_available' && typeof data.latestVersion === 'string') {
            next.latestVersion = data.latestVersion;
          }
        }
      } catch {
        // The update request is independent of the model list.
      } finally {
        checking = false;
      }
      if (signal.aborted || (update?.currentVersion === next?.currentVersion
        && update?.latestVersion === next?.latestVersion)) return;
      update = next;
      for (const listener of listeners) listener();
    }
    const recheck = () => { void refresh(); };
    const timer = window.setInterval(recheck, updateCheckInterval);
    window.addEventListener('focus', recheck);
    recheck();
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', recheck);
    };
  }, 'free-model: update checks');
  return {
    getSnapshot: () => update,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function UpdateBanner({ ctx, t, update }) {
  if (!update?.latestVersion) return null;

  function openDetails(event) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    try {
      const navigation = ctx.get('pluginNavigation');
      if (typeof navigation?.openBundle !== 'function') return;
      navigation.openBundle(packageName);
      event.preventDefault();
    } catch {
      // The link leads to npm if plugin management is unavailable.
    }
  }
  return h('div', { className: 'dsh-free-model-update-banner' },
    h('p', { className: 'dsh-free-model-update-banner-content' },
      h('strong', { className: 'dsh-free-model-update-title' }, t('updateTitle')),
      h('span', { className: 'dsh-free-model-update-version' }, `v${update.latestVersion}`),
    ),
    h('a', { className: 'dsh-free-model-update-action', href: `https://www.npmjs.com/package/${packageName}`,
      target: '_blank', rel: 'noopener noreferrer', onClick: openDetails }, t('updateDetails')),
  );
}

function rpcValue(reply) {
  if (!reply?.ok) throw new Error(reply?.error?.message);
  return reply.value;
}

function createPluginInstaller(ctx) {
  const listeners = new Set();
  const initial = { inventory: 'unavailable', installed: new Set(), pending: null, error: null };
  let state = initial;
  let manager;
  let revision = 0;

  function update(changes) {
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  }

  async function refresh() {
    if (!manager) return;
    const current = ++revision;
    try {
      const bundles = rpcValue(await manager.listBundles());
      const installed = new Set(bundles.filter(bundle =>
        bundle.installed || bundle.availability === 'profile' || bundle.availability === 'installation')
        .map(bundle => bundle.name));
      if (current === revision) update({ inventory: 'ready', installed, error: installed.has(state.error?.name) ? null : state.error });
    } catch {
      if (current === revision) update({ inventory: 'failed' });
    }
  }

  ctx.inject(['remote', 'remote.pluginManager'], scope => {
    scope.effect(() => {
      manager = scope.remote.pluginManager;
      const recheck = () => { if (listeners.size) void refresh(); };
      const unsubscribe = scope.remote.$on('plugin-manager/changed', recheck);
      const reset = scope.on('connection/reset', recheck);
      window.addEventListener('focus', recheck);
      update({ ...initial, inventory: 'loading' });
      recheck();
      return () => {
        manager = undefined;
        revision++;
        update(initial);
        unsubscribe();
        reset();
        window.removeEventListener('focus', recheck);
      };
    }, 'free-model: plugin inventory');
  });

  async function install(name) {
    if (!manager || state.inventory !== 'ready' || state.pending || state.installed.has(name)) return;
    const host = manager;
    update({ pending: name, error: null });
    try {
      const info = rpcValue(await host.inspect(name, { registry: npmRegistry }));
      if (host !== manager) return;
      if (info.status !== 'accepted') throw new Error(info.reason);
      if (info.registry !== npmRegistry || info.name !== name || info.bundle !== true
        || typeof info.version !== 'string' || !publishedVersion.test(info.version)) throw new Error();

      const requestId = globalThis.crypto?.randomUUID?.();
      const options = {
        enabled: true, registry: npmRegistry, expected: { name, version: info.version },
        ...(requestId && { requestId }),
      };
      let result;
      try {
        result = rpcValue(await host.installBundle(`${name}@${info.version}`, options));
      } catch (error) {
        // A lost reply can leave pnpm running. Join that request before allowing a retry.
        if (!requestId || host !== manager) throw error;
        result = rpcValue(await host.waitForInstall(requestId));
        if (!result) throw error;
      }
      if (!['applied', 'restart-required', 'overridden'].includes(result.application)) {
        throw new Error(result.error?.diagnostic || result.error?.code);
      }
    } catch (error) {
      if (host === manager) update({ error: { name, message: error.message } });
    } finally {
      if (host === manager) {
        await refresh();
        if (host === manager) update({ pending: null });
      }
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) void refresh();
      return () => listeners.delete(listener);
    },
    install, refresh,
  };
}

function PluginInstallButton({ name, installer, state, t }) {
  let label = 'install';
  if (state.pending === name) label = 'installing';
  else if (state.inventory === 'unavailable') label = 'installUnavailable';
  else if (state.inventory === 'failed') label = 'retryInventory';
  else if (state.inventory === 'loading') label = 'checkInstall';
  else if (state.installed.has(name)) label = 'installed';
  return h('button', { type: 'button', className: 'dsh-free-model-plugin-action',
    'data-state': label, 'aria-label': t('installAction', { name, action: t(label) }),
    disabled: !!state.pending || (label !== 'install' && label !== 'retryInventory'),
    onClick: () => { void (label === 'retryInventory' ? installer.refresh() : installer.install(name)); },
  }, t(label));
}

function PluginRecommendations({ installer, t }) {
  const headingId = useId();
  const state = useSyncExternalStore(installer.subscribe, installer.getSnapshot);
  return h('section', { className: 'dsh-free-model-recommendations', 'aria-labelledby': headingId },
    h('h3', { id: headingId }, t('otherPlugins')),
    h('ul', { className: 'dsh-free-model-plugins' }, recommendedPlugins.map(({ name, description, stores }) =>
      h('li', { key: name, className: 'dsh-free-model-plugin' },
        h('div', null,
          h('span', { className: 'dsh-free-model-plugin-name' }, name),
          h('p', null, t(description)),
        ),
        h('div', { className: 'dsh-free-model-plugin-actions', 'aria-live': 'polite' },
          stores ? stores.map(store =>
            h('a', { key: store.label, className: 'dsh-free-model-plugin-action', href: store.href,
              target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('storeLabel', { name, store: t(store.label) }) }, t(store.label)),
          ) : h(PluginInstallButton, { name, installer, state, t }),
        ),
        state.error?.name === name && !state.installed.has(name) && h('p', { className: 'dsh-free-model-error', role: 'alert' },
          t('installError'), state.error.message && ` ${state.error.message}`),
      ),
    )),
    state.inventory === 'failed' && h('p', { className: 'dsh-free-model-error', role: 'alert' }, t('inventoryError')),
  );
}

function parseAvailability(data) {
  if (typeof data?.checking !== 'boolean' || !Array.isArray(data.models)
    || (data.retryAt !== undefined && !Number.isFinite(data.retryAt))
    || !data.models.every(result => typeof result?.id === 'string' && resultStatuses.has(result.status))) {
    throw new Error();
  }
  return data;
}

function ModelActionButton({ label, icon, busy, disabled, onClick }) {
  return h(Tooltip, { label, side: 'top' },
    h('span', { className: 'dsh-free-model-action-anchor' },
      h('button', { type: 'button', 'aria-label': label, 'aria-busy': busy, disabled, onClick },
        h(PanelIcon, { name: icon, size: 17 })),
    ),
  );
}

function KiloWorkspace({ t, language }) {
  const writes = useRef(new Map());
  const checkRequest = useRef(null);
  const [models, setModels] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState(new Map());
  const [availability, setAvailability] = useState(emptyAvailability);
  const [availabilityError, setAvailabilityError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [cooldown, setCooldown] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    // An active check is kept current by its dedicated polling request.
    const polling = availability.checking;
    const path = revision > 0 ? `${apiPath}?refresh=1` : apiPath;
    request(path, signal).then(data => {
      if (!Array.isArray(data?.models) || !data.models.every(model => (
        typeof model?.id === 'string' && typeof model?.name === 'string'
        && typeof model.enabled === 'boolean' && typeof model.available === 'boolean'
      ))) throw new Error();
      if (signal.aborted) return;
      setModels(data.models);
      setLoadError(data.catalogError ?? null);
      if (!polling && data.availability !== undefined) setAvailability(parseAvailability(data.availability));
    }).catch(error => {
      if (!signal.aborted) {
        setLoadError(error.message);
        setModels(current => current?.map(model => ({ ...model, available: false, unavailableReason: 'provider-unavailable' })) ?? null);
      }
    }).finally(() => {
      if (!signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const active = writes.current;
    return () => {
      for (const controller of active.values()) controller.abort();
      active.clear();
      checkRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!availability.checking) return;
    const controller = new AbortController();
    const { signal } = controller;
    let timer = setTimeout(poll, 1000);
    async function poll() {
      try {
        const snapshot = parseAvailability(await request(availabilityPath, signal));
        if (signal.aborted) return;
        setAvailability(snapshot);
        if (snapshot.checking) timer = setTimeout(poll, 1000);
      } catch (error) {
        if (signal.aborted) return;
        setAvailability(current => ({ ...current, checking: false, retryAt: undefined }));
        setAvailabilityError(error.message || t('checkProgressError'));
      }
    }
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [availability.checking]);

  useEffect(() => {
    let timer;
    function updateCooldown() {
      const delay = (availability.retryAt ?? 0) - Date.now();
      setCooldown(delay > 0);
      if (delay > 0) timer = setTimeout(updateCooldown, Math.min(delay, 2_147_483_647));
    }
    updateCooldown();
    return () => clearTimeout(timer);
  }, [availability.retryAt]);

  function refresh() {
    if (loading || writes.current.size || checkRequest.current) return;
    setLoading(true);
    setLoadError(null);
    setAvailabilityError(null);
    setRows(new Map());
    setRevision(value => value + 1);
  }

  async function checkAvailability() {
    if (loading || !models?.some(model => model.available) || checkRequest.current || availability.checking || availability.retryAt > Date.now()) return;
    const controller = new AbortController();
    const { signal } = controller;
    checkRequest.current = controller;
    setStarting(true);
    setAvailabilityError(null);
    try {
      const snapshot = parseAvailability(await request(availabilityPath, signal, {}));
      if (!signal.aborted) setAvailability(snapshot);
    } catch (error) {
      if (!signal.aborted) setAvailabilityError(error.message || t('checkError'));
    } finally {
      checkRequest.current = null;
      if (!signal.aborted) setStarting(false);
    }
  }

  function setRow(id, state) {
    setRows(previous => {
      const next = new Map(previous);
      if (state === undefined) next.delete(id);
      else next.set(id, state);
      return next;
    });
  }

  async function changeVisibility(id, enabled) {
    if (loading || writes.current.has(id) || !models?.some(model => model.id === id && model.available)) return;
    const controller = new AbortController();
    const { signal } = controller;
    writes.current.set(id, controller);
    setRow(id, { saving: true });
    try {
      const saved = await request(apiPath, signal, { id, enabled });
      if (saved?.id !== id || saved.enabled !== enabled) throw new Error();
      if (signal.aborted) return;
      setModels(current => current.map(model => model.id === id ? { ...model, enabled } : model));
      setRow(id, undefined);
    } catch (error) {
      if (!signal.aborted) setRow(id, { error: error.message });
    } finally {
      if (writes.current.get(id) === controller) writes.current.delete(id);
    }
  }

  const checking = starting || availability.checking;
  const results = new Map(availability.models.map(result => [result.id, result]));
  const finished = availability.models.filter(result => result.status !== 'checking').length;
  const checkLabel = checking && availability.checking && results.size
    ? t('checkProgress', { done: finished, total: results.size })
    : t(checking ? 'checkingAvailability' : cooldown ? 'checkCooldown' : 'checkAvailability');
  const headerActions = h('div', { className: 'dsh-free-model-actions' },
    h(ModelActionButton, { onClick: checkAvailability, icon: checking ? 'spinner' : 'activity',
      disabled: loading || checking || cooldown || !models?.some(model => model.available),
      label: checkLabel, busy: checking,
    }),
    h(ModelActionButton, { onClick: refresh, icon: 'refresh', label: t('refresh'), busy: loading,
      disabled: loading || starting || writes.current.size > 0,
    }),
  );

  return h('div', { className: 'dsh-free-model-catalog' },
    h(ModelList, { label: t('kiloTab'), language, models: models ?? [], headerActions,
      renderRow(model) {
        const state = rows.get(model.id);
        const result = model.available ? results.get(model.id) : undefined;
        const status = result && (result.status !== 'checking' || availability.checking) ? result.status : undefined;
        const checkedAt = Number.isFinite(result?.checkedAt)
          ? t('checkedAt', { time: new Date(result.checkedAt).toLocaleString(language) })
          : undefined;
        const elapsedMs = result?.elapsedMs;
        const showDuration = (status === 'available' || status === 'unavailable')
          && result.reason !== 'TIMEOUT' && Number.isSafeInteger(elapsedMs) && elapsedMs >= 0;
        return h('li', { className: 'dsh-model-hub-row', key: model.id,
          'aria-disabled': !model.available || undefined, 'aria-busy': state?.saving === true },
          h('div', null,
            h('div', { className: 'dsh-model-hub-row-heading' },
              h('span', { className: 'dsh-model-hub-row-name' }, model.name),
              !model.available && h('span', { className: 'dsh-model-hub-unavailable' }, t(catalogReasonKeys.get(model.unavailableReason) ?? 'unverified')),
              status && h('span', { className: 'dsh-free-model-badge', 'data-status': status, title: checkedAt }, t(status)),
              status === 'unavailable' && h('span', { className: 'dsh-free-model-reason' }, t(reasonKeys.get(result.reason) ?? 'reasonUnknown')),
              showDuration && h('span', { className: 'dsh-free-model-duration' }, `${elapsedMs} ms`),
            ),
            model.name !== model.id && h('code', { className: 'dsh-model-hub-row-id' }, model.id),
          ),
          h(Switch, {
            checked: model.available && model.enabled,
            disabled: !model.available || loading || state?.saving === true,
            label: t('toggle', { name: model.name }),
            onChange: enabled => { void changeVisibility(model.id, enabled); },
          }),
          state?.error !== undefined
            && h('p', { className: 'dsh-free-model-error', role: 'alert' }, state.error || t('saveError')),
        );
      },
    },
      loading && models === null && h('p', { className: 'dsh-free-model-status', role: 'status' }, t('loading')),
      loadError !== null && h('p', { className: 'dsh-free-model-status dsh-free-model-error', role: 'alert' }, loadError || t('loadError')),
      availabilityError !== null && h('p', { className: 'dsh-free-model-status dsh-free-model-error', role: 'alert' }, availabilityError),
      !loading && loadError === null && models?.length === 0
        && h('p', { className: 'dsh-free-model-status', role: 'status' }, t('empty')),
    ),
  );
}

function ModelPage({ ctx, t, updates, installer }) {
  const headingId = useId();
  const update = useSyncExternalStore(updates.subscribe, updates.getSnapshot);
  const aboutHeadingId = useId();
  const language = (ctx.locale.getSnapshot?.()?.active || document.documentElement.lang || 'zh').startsWith('en') ? 'en' : 'zh';

  return h('section', { className: 'dsh-free-model-page', 'aria-labelledby': headingId },
    h('div', { className: 'dsh-free-model-content' },
      h('header', { className: 'dsh-free-model-header' },
        h('h1', { id: headingId }, t('title')),
        h('p', { className: 'dsh-free-model-hint' }, t('introduction')),
      ),
      h(UpdateBanner, { ctx, t, update }),
      h(ModelSources, { ctx, t, language }, h(KiloWorkspace, { t, language })),
      h('section', { className: 'dsh-free-model-about', 'aria-labelledby': aboutHeadingId },
        h('h2', { id: aboutHeadingId }, t('about'), update?.currentVersion && h('span', null, `v${update.currentVersion}`)),
        h('div', { className: 'dsh-free-model-about-content' },
          h('a', { href: repositoryUrl, target: '_blank', rel: 'noopener noreferrer' }, t('project')),
          h(PluginRecommendations, { installer, t }),
        ),
      ),
    ),
  );
}

function SidebarIcon({ size }) {
  const Icon = IconSparkleRegular ?? IconSparkle16;
  return Icon ? h(Icon, { size }) : null;
}

function SidebarUpdateBadge({ t, updates, wide }) {
  const update = useSyncExternalStore(updates.subscribe, updates.getSnapshot);
  if (!update?.latestVersion) return null;
  if (wide) return h('span', { className: 'dsh-free-model-update-badge' }, t('updateBadge'));
  return h('span', { className: 'dsh-free-model-update-dot' },
    h('span', { className: 'dsh-free-model-update-sr' }, t('updateBadge')),
  );
}

export const inject = ['locale', 'slots'];

export function apply(ctx) {
  registerChatGPTClient(ctx);
  ctx.effect(() => ctx.locale.register(panelId, messages), 'free-model: translations');
  const t = ctx.locale.bind(panelId);
  const updates = monitorUpdates(ctx);
  const installer = createPluginInstaller(ctx);
  ctx.effect(() => {
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.append(style);
    return () => style.remove();
  }, 'free-model: styles');
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panelId, order: 30, label: () => t('title'),
  }, SidebarIcon));
  ctx.slots.inject('sidebar.panellist.trailing', () => ctx.slots.register({
    name: 'sidebar.panellist.trailing', id: panelId, locale: panelId,
  }, function Trailing(props) { return h(SidebarUpdateBadge, { ...props, updates }); }));
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: panelId, locale: panelId,
  }, function Panel(props) { return h(ModelPage, { ...props, ctx, updates, installer }); }));
}
