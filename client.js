window.__ModuleLoader__.load({
  id: '@houyanchao/dsh-free-model',
  factory(require) {
    const { createElement: h, useEffect, useId, useRef, useState, useSyncExternalStore } = require('react');
    const { Button, Switch, IconSparkleRegular, IconSparkle16 } = require('@deepseek-ai/dsh-client-ui-primitives');
    const panelId = 'dsh-free-model';
    const apiPath = '/api/dsh-free-model/models';
    const availabilityPath = `${apiPath}/availability`;
    const updatePath = '/api/dsh-free-model/update';
    const updateCheckInterval = 5 * 60 * 1000;
    const packageName = '@houyanchao/dsh-free-model';
    const repositoryUrl = 'https://github.com/houyanchao/dsh-free-model';
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
    const reasonKeys = new Map(Object.entries({
      AUTH: 'reasonAuth', QUOTA: 'reasonQuota', RATE_LIMIT: 'reasonRateLimit', TIMEOUT: 'reasonTimeout',
      MODEL_UNAVAILABLE: 'reasonRoute', TRANSPORT: 'reasonNetwork', INVALID_REQUEST: 'reasonRequest',
      MALFORMED_RESPONSE: 'reasonFormat', EMPTY_RESPONSE: 'reasonEmpty', SERVER: 'reasonServer',
    }));

    const messages = {
      zh: {
        title: '免费模型',
        hint: '开启的模型会显示在对话的「免费模型」分组中。',
        refresh: '刷新列表',
        loading: '正在读取 Kilo 模型列表…',
        empty: 'Kilo 当前没有可用的免费文本模型。',
        loadError: '无法读取模型列表，请重试。',
        saveError: '无法保存此模型的显示设置，请重试。',
        toggle: '在模型选择器中显示 {name}',
        checkAvailability: '检测可用性',
        checkingAvailability: '正在检测可用性…',
        checkCooldown: '请稍后再测',
        checkError: '无法检测模型可用性，请重试。',
        checkProgressError: '无法更新检测进度，请刷新列表。',
        unchecked: '未检测',
        checking: '检测中',
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
        viewProject: '查看 GitHub 仓库',
        otherPlugins: '作者的其他插件',
        timelineDescription: '为 DSH 对话添加提问时间轴、收藏夹、提示词库和多格式导出。',
        chatgptDescription: '关联 ChatGPT 账号，在 DSH 中使用套餐额度，并切换账号和模型。',
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
        title: 'Free Models',
        hint: 'Enabled models appear in the model picker.',
        refresh: 'Refresh list',
        loading: 'Loading the Kilo model list…',
        empty: 'Kilo currently lists no free text models.',
        loadError: 'Could not load the model list. Try again.',
        saveError: 'Could not save visibility for this model. Try again.',
        toggle: 'Show {name} in the model picker',
        checkAvailability: 'Check availability',
        checkingAvailability: 'Checking availability…',
        checkCooldown: 'Check again shortly',
        checkError: 'Could not start the model availability check. Try again.',
        checkProgressError: 'Could not update check progress. Refresh the list.',
        unchecked: 'Not checked',
        checking: 'Checking',
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
        viewProject: 'View GitHub repository',
        otherPlugins: 'More plugins by this author',
        timelineDescription: 'Add a question timeline, bookmark folders, a prompt library, and chat exports to DSH.',
        chatgptDescription: 'Connect your ChatGPT account to use your plan in DSH and switch between accounts and models.',
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

    const styles = `
      .dsh-free-model-page {
        width: 100%; height: 100%; min-width: 0; overflow: auto;
        background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
        font-size: 14px; line-height: 1.5;
      }
      .dsh-free-model-content { width: min(calc(100% - 36px), 760px); margin-inline: auto; padding-block: 28px 48px; }
      .dsh-free-model-update-banner {
        display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px;
        margin-block-end: 24px; padding: 8px 12px 8px 14px; border-radius: 12px;
        border: 1px solid var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 12%, transparent));
        background: color-mix(in srgb, currentColor 3%, var(--dsw-alias-bg-layer-1));
      }
      .dsh-free-model-update-banner-content {
        display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px;
        flex: 1 1 180px; min-width: 0; margin: 0; overflow-wrap: anywhere;
      }
      .dsh-free-model-update-title { font-weight: 600; }
      .dsh-free-model-update-version { color: var(--dsw-alias-label-secondary); font-size: 13px; }
      .dsh-free-model-update-action, .dsh-free-model-plugin-action {
        display: inline-flex; align-items: center; min-height: 32px; padding-inline: 12px;
        border-radius: 999px; white-space: nowrap;
        border: 1px solid var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 16%, transparent));
        background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
        font-size: 13px; font-weight: 550; text-decoration: none;
      }
      .dsh-free-model-update-action { margin-inline-start: auto; }
      .dsh-free-model-plugin-action { justify-content: center; box-sizing: border-box; font-family: inherit; cursor: pointer; }
      :is(.dsh-free-model-update-action, .dsh-free-model-plugin-action):hover { background: var(--dsw-alias-interactive-bg-hover); }
      :is(.dsh-free-model-update-action, .dsh-free-model-plugin-action):focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
      .dsh-free-model-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px 12px; }
      .dsh-free-model-header h1 { margin: 0; font-size: 24px; line-height: 1.3; font-weight: 600; }
      .dsh-free-model-hint { grid-column: 1 / -1; margin: 0; color: var(--dsw-alias-label-secondary); }
      .dsh-free-model-header-links { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
      .dsh-free-model-version { color: var(--dsw-alias-label-secondary); font-size: 13px; white-space: nowrap; }
      .dsh-free-model-project-link {
        display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
        border-radius: 50%; color: var(--dsw-alias-label-secondary); text-decoration: none;
      }
      .dsh-free-model-project-link:is(:hover, :focus-visible) {
        color: var(--dsw-alias-label-primary); background: color-mix(in srgb, currentColor 8%, transparent);
      }
      .dsh-free-model-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-block-start: 16px; }
      .dsh-free-model-status { margin-block: 20px 0; }
      .dsh-free-model-list { padding: 0; margin: 20px 0 0; list-style: none; }
      .dsh-free-model-row {
        display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
        gap: 4px 16px; padding-block: 12px; border-block-end: 1px solid var(--dsw-alias-line-secondary, color-mix(in srgb, currentColor 12%, transparent));
      }
      .dsh-free-model-row:first-child { border-block-start: 1px solid var(--dsw-alias-line-secondary, color-mix(in srgb, currentColor 12%, transparent)); }
      .dsh-free-model-row-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 3px 8px; }
      .dsh-free-model-name { display: block; font-weight: 550; overflow-wrap: anywhere; }
      .dsh-free-model-badge {
        padding: 1px 7px; border-radius: 4px; font-size: 12px; font-weight: 550;
        color: var(--dsw-alias-label-secondary); background: color-mix(in srgb, currentColor 11%, transparent);
      }
      .dsh-free-model-badge[data-status='available'] { color: var(--dsw-alias-state-success-primary, #238454); }
      .dsh-free-model-badge[data-status='unavailable'] { color: var(--dsw-alias-state-error-primary, #b63f39); }
      .dsh-free-model-reason, .dsh-free-model-duration { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .dsh-free-model-duration { font-variant-numeric: tabular-nums; white-space: nowrap; }
      .dsh-free-model-id { display: block; margin-block-start: 3px; font-size: 12px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
      .dsh-free-model-error { color: var(--dsw-alias-state-warn-label, #a1421c); overflow-wrap: anywhere; }
      .dsh-free-model-row .dsh-free-model-error { grid-column: 1 / -1; margin: 0; }
      .dsh-free-model-update-badge {
        display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 999px;
        background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-1);
        font-size: 11px; font-weight: 550; line-height: 16px; white-space: nowrap;
      }
      .dsh-free-model-update-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-primary); }
      .dsh-free-model-update-sr {
        position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
      }
      .dsh-free-model-recommendations {
        margin-block-start: 36px; container-type: inline-size;
        --plugin-divider: var(--dsw-alias-line-secondary, color-mix(in srgb, currentColor 12%, transparent));
      }
      .dsh-free-model-recommendations h2 { margin: 0 0 12px; font-size: 16px; font-weight: 600; line-height: 1.4; }
      .dsh-free-model-plugins { margin: 0; padding: 0 16px; list-style: none; border: 1px solid var(--plugin-divider); border-radius: 14px; }
      .dsh-free-model-plugin { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 16px; padding-block: 13px; }
      .dsh-free-model-plugin + .dsh-free-model-plugin { border-block-start: 1px solid var(--plugin-divider); }
      .dsh-free-model-plugin-name { font-weight: 550; }
      .dsh-free-model-plugin p { margin: 2px 0 0; font-size: 13px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
      .dsh-free-model-plugin-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      a.dsh-free-model-plugin-action {
        background: var(--dsw-static-neutral-bluish-1000, #0f1115); color: #fff; border-color: rgb(255 255 255 / 18%);
      }
      a.dsh-free-model-plugin-action:hover { background: var(--dsw-static-neutral-bluish-850, #2c2c2e); }
      a.dsh-free-model-plugin-action:focus-visible { outline-color: var(--dsw-alias-label-primary, #0f1115); }
      .dsh-free-model-plugin-action:disabled { cursor: default; background: transparent; color: var(--dsw-alias-label-secondary); }
      .dsh-free-model-plugin-action[data-state='installed'] { border-color: transparent; background: color-mix(in srgb, currentColor 6%, transparent); }
      .dsh-free-model-plugin .dsh-free-model-error { grid-column: 1 / -1; color: var(--dsw-alias-state-warn-label, #a1421c); }
      @container (max-width: 370px) {
        .dsh-free-model-plugin { grid-template-columns: minmax(0, 1fr); }
        .dsh-free-model-plugins { padding-inline: 12px; }
      }
    `;

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

    function HeaderLinks({ t, currentVersion }) {
      const label = t('viewProject');
      return h('div', { className: 'dsh-free-model-header-links' },
        currentVersion && h('span', { className: 'dsh-free-model-version' }, `v${currentVersion}`),
        h('a', { className: 'dsh-free-model-project-link', href: repositoryUrl, target: '_blank',
          rel: 'noopener noreferrer', title: label, 'aria-label': label },
          h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true, focusable: 'false' },
            h('path', { d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z' }),
          ),
        ),
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
        h('h2', { id: headingId }, t('otherPlugins')),
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

    function ModelPage({ ctx, t, updates, installer }) {
      const headingId = useId();
      const update = useSyncExternalStore(updates.subscribe, updates.getSnapshot);
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
            typeof model?.id === 'string' && typeof model?.name === 'string' && typeof model?.enabled === 'boolean'
          ))) throw new Error();
          if (signal.aborted) return;
          setModels(data.models);
          if (!polling && data.availability !== undefined) setAvailability(parseAvailability(data.availability));
        }).catch(error => {
          if (!signal.aborted) setLoadError(error.message);
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
        if (loading || checkRequest.current || availability.checking || availability.retryAt > Date.now()) return;
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
        if (loading || writes.current.has(id)) return;
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
      return h('section', { className: 'dsh-free-model-page', 'aria-labelledby': headingId },
        h('div', { className: 'dsh-free-model-content' },
          h(UpdateBanner, { ctx, t, update }),
          h('header', { className: 'dsh-free-model-header' },
            h('h1', { id: headingId }, t('title')),
            h(HeaderLinks, { t, currentVersion: update?.currentVersion }),
            h('p', { className: 'dsh-free-model-hint' }, t('hint')),
          ),
          h('div', { className: 'dsh-free-model-actions' },
            h(Button, {
              variant: 'outline', size: 'sm', onClick: checkAvailability,
              disabled: loading || checking || cooldown || !models?.length,
            }, t(checking ? 'checkingAvailability' : cooldown ? 'checkCooldown' : 'checkAvailability')),
            h(Button, { variant: 'outline', size: 'sm', onClick: refresh, disabled: loading || starting || writes.current.size > 0 }, t('refresh')),
          ),
          loading && h('p', { className: 'dsh-free-model-status', role: 'status' }, t('loading')),
          loadError !== null && h('p', { className: 'dsh-free-model-status dsh-free-model-error', role: 'alert' }, loadError || t('loadError')),
          availabilityError !== null && h('p', { className: 'dsh-free-model-status dsh-free-model-error', role: 'alert' }, availabilityError),
          !loading && loadError === null && models?.length === 0
            && h('p', { className: 'dsh-free-model-status', role: 'status' }, t('empty')),
          models?.length > 0 && h('ul', { className: 'dsh-free-model-list', 'aria-labelledby': headingId },
            models.map(model => {
              const state = rows.get(model.id);
              const result = results.get(model.id);
              const status = result && (result.status !== 'checking' || availability.checking) ? result.status : 'unchecked';
              const checkedAt = Number.isFinite(result?.checkedAt)
                ? t('checkedAt', { time: new Date(result.checkedAt).toLocaleString() })
                : undefined;
              const elapsedMs = result?.elapsedMs;
              const showDuration = (status === 'available' || status === 'unavailable')
                && result.reason !== 'TIMEOUT' && Number.isSafeInteger(elapsedMs) && elapsedMs >= 0;
              return h('li', { className: 'dsh-free-model-row', key: model.id, 'aria-busy': state?.saving === true },
                h('div', null,
                  h('div', { className: 'dsh-free-model-row-heading' },
                    h('span', { className: 'dsh-free-model-name' }, model.name),
                    h('span', { className: 'dsh-free-model-badge', 'data-status': status, title: checkedAt }, t(status)),
                    status === 'unavailable' && h('span', { className: 'dsh-free-model-reason' }, t(reasonKeys.get(result.reason) ?? 'reasonUnknown')),
                    showDuration && h('span', { className: 'dsh-free-model-duration' }, `${elapsedMs} ms`),
                  ),
                  h('code', { className: 'dsh-free-model-id' }, model.id),
                ),
                h(Switch, {
                  checked: model.enabled,
                  disabled: loading || state?.saving === true,
                  label: t('toggle', { name: model.name }),
                  onChange: enabled => { void changeVisibility(model.id, enabled); },
                }),
                state?.error !== undefined
                  && h('p', { className: 'dsh-free-model-error', role: 'alert' }, state.error || t('saveError')),
              );
            }),
          ),
          h(PluginRecommendations, { installer, t }),
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

    function apply(ctx) {
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

    return { inject: ['locale', 'slots'], apply };
  },
});
