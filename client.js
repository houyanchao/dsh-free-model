window.__ModuleLoader__.load({
  id: '@houyanchao/dsh-free-model',
  factory(require) {
    const { createElement: h, useEffect, useId, useRef, useState } = require('react');
    const { Button, Switch, IconSparkleRegular, IconSparkle16 } = require('@deepseek-ai/dsh-client-ui-primitives');
    const panelId = 'dsh-free-model';
    const apiPath = '/api/dsh-free-model/models';
    const availabilityPath = `${apiPath}/availability`;
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
      },
    };

    const styles = `
      .dsh-free-model-page {
        width: 100%; height: 100%; min-width: 0; overflow: auto;
        background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
        font-size: 14px; line-height: 1.5;
      }
      .dsh-free-model-content { width: min(calc(100% - 36px), 760px); margin-inline: auto; padding-block: 28px 48px; }
      .dsh-free-model-header { display: flex; align-items: flex-start; gap: 8px 16px; justify-content: space-between; flex-wrap: wrap; }
      .dsh-free-model-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .dsh-free-model-header h1 { margin: 0; font-size: 24px; line-height: 1.3; font-weight: 600; }
      .dsh-free-model-hint { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); }
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

    function parseAvailability(data) {
      if (typeof data?.checking !== 'boolean' || !Array.isArray(data.models)
        || (data.retryAt !== undefined && !Number.isFinite(data.retryAt))
        || !data.models.every(result => typeof result?.id === 'string' && resultStatuses.has(result.status))) {
        throw new Error();
      }
      return data;
    }

    function ModelPage({ t }) {
      const headingId = useId();
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
          h('header', { className: 'dsh-free-model-header' },
            h('div', null,
              h('h1', { id: headingId }, t('title')),
              h('p', { className: 'dsh-free-model-hint' }, t('hint')),
            ),
            h('div', { className: 'dsh-free-model-actions' },
              h(Button, {
                variant: 'outline', size: 'sm', onClick: checkAvailability,
                disabled: loading || checking || cooldown || !models?.length,
              }, t(checking ? 'checkingAvailability' : cooldown ? 'checkCooldown' : 'checkAvailability')),
              h(Button, { variant: 'outline', size: 'sm', onClick: refresh, disabled: loading || starting || writes.current.size > 0 }, t('refresh')),
            ),
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
        ),
      );
    }

    function SidebarIcon({ size }) {
      const Icon = IconSparkleRegular ?? IconSparkle16;
      return Icon ? h(Icon, { size }) : null;
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(panelId, messages), 'free-model: translations');
      const t = ctx.locale.bind(panelId);
      ctx.effect(() => {
        const style = document.createElement('style');
        style.textContent = styles;
        document.head.append(style);
        return () => style.remove();
      }, 'free-model: styles');
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: panelId, order: 30, label: () => t('title'),
      }, SidebarIcon));
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main', key: panelId, locale: panelId,
      }, ModelPage));
    }

    return { inject: ['locale', 'slots'], apply };
  },
});
