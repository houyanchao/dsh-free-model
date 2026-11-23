window.__ModuleLoader__.load({
  id: '@houyanchao/dsh-free-model',
  factory(require) {
    const { createElement: h, useEffect, useId, useRef, useState } = require('react');
    const { Button, Switch, IconSparkleRegular, IconSparkle16 } = require('@deepseek-ai/dsh-client-ui-primitives');
    const panelId = 'dsh-free-model';
    const apiPath = '/api/dsh-free-model/models';

    const messages = {
      zh: {
        title: '免费模型',
        hint: '开启的模型会显示在对话的「Kilo 免费模型」分组中。',
        refresh: '刷新列表',
        loading: '正在读取 Kilo 模型列表…',
        empty: 'Kilo 当前没有可用的免费文本模型。',
        loadError: '无法读取模型列表，请重试。',
        saveError: '无法保存此模型的显示设置，请重试。',
        toggle: '在模型选择器中显示 {name}',
      },
      en: {
        title: 'Free Models',
        hint: 'Enabled models appear under Kilo Free Models in the model picker.',
        refresh: 'Refresh list',
        loading: 'Loading the Kilo model list…',
        empty: 'Kilo currently lists no free text models.',
        loadError: 'Could not load the model list. Try again.',
        saveError: 'Could not save visibility for this model. Try again.',
        toggle: 'Show {name} in the model picker',
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
      .dsh-free-model-header h1 { margin: 0; font-size: 24px; line-height: 1.3; font-weight: 600; }
      .dsh-free-model-hint { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); }
      .dsh-free-model-status { margin-block: 20px 0; }
      .dsh-free-model-list { padding: 0; margin: 20px 0 0; list-style: none; }
      .dsh-free-model-row {
        display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
        gap: 4px 16px; padding-block: 12px; border-block-end: 1px solid var(--dsw-alias-line-secondary, color-mix(in srgb, currentColor 12%, transparent));
      }
      .dsh-free-model-row:first-child { border-block-start: 1px solid var(--dsw-alias-line-secondary, color-mix(in srgb, currentColor 12%, transparent)); }
      .dsh-free-model-name { display: block; font-weight: 550; overflow-wrap: anywhere; }
      .dsh-free-model-id { display: block; margin-block-start: 3px; font-size: 12px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
      .dsh-free-model-error { color: var(--dsw-alias-state-warn-label, #a1421c); overflow-wrap: anywhere; }
      .dsh-free-model-row .dsh-free-model-error { grid-column: 1 / -1; margin: 0; }
    `;

    async function request(signal, body) {
      const headers = { accept: 'application/json' };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(apiPath, {
        method: body === undefined ? 'GET' : 'POST', headers, cache: 'no-store', signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : '');
      return data;
    }

    function ModelPage({ t }) {
      const headingId = useId();
      const writes = useRef(new Map());
      const [models, setModels] = useState(null);
      const [loadError, setLoadError] = useState(null);
      const [loading, setLoading] = useState(true);
      const [revision, setRevision] = useState(0);
      const [rows, setRows] = useState(new Map());

      useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;
        request(signal).then(data => {
          if (!Array.isArray(data?.models) || !data.models.every(model => (
            typeof model?.id === 'string' && typeof model?.name === 'string' && typeof model?.enabled === 'boolean'
          ))) throw new Error();
          if (!signal.aborted) setModels(data.models);
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
        };
      }, []);

      function refresh() {
        if (loading || writes.current.size) return;
        setLoading(true);
        setLoadError(null);
        setRows(new Map());
        setRevision(value => value + 1);
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
          const saved = await request(signal, { id, enabled });
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

      return h('section', { className: 'dsh-free-model-page', 'aria-labelledby': headingId },
        h('div', { className: 'dsh-free-model-content' },
          h('header', { className: 'dsh-free-model-header' },
            h('div', null,
              h('h1', { id: headingId }, t('title')),
              h('p', { className: 'dsh-free-model-hint' }, t('hint')),
            ),
            h(Button, { variant: 'outline', size: 'sm', onClick: refresh, disabled: loading || writes.current.size > 0 }, t('refresh')),
          ),
          loading && h('p', { className: 'dsh-free-model-status', role: 'status' }, t('loading')),
          loadError !== null && h('p', { className: 'dsh-free-model-status dsh-free-model-error', role: 'alert' }, loadError || t('loadError')),
          !loading && loadError === null && models?.length === 0
            && h('p', { className: 'dsh-free-model-status', role: 'status' }, t('empty')),
          models?.length > 0 && h('ul', { className: 'dsh-free-model-list', 'aria-labelledby': headingId },
            models.map(model => {
              const state = rows.get(model.id);
              return h('li', { className: 'dsh-free-model-row', key: model.id, 'aria-busy': state?.saving === true },
                h('div', null,
                  h('span', { className: 'dsh-free-model-name' }, model.name),
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
        name: 'sidebar.panellist', id: panelId, order: 8, label: () => t('title'),
      }, SidebarIcon));
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main', key: panelId, locale: panelId,
      }, ModelPage));
    }

    return { inject: ['locale', 'slots'], apply };
  },
});
