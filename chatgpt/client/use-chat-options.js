import { useEffect, useRef, useState } from 'react';

// The setting belongs to the conversation. A new model must read after any
// save the user already submitted for that same conversation.
const pendingWrites = new Map();

async function requestSettings(url, signal, enabled) {
  const response = await fetch(url, {
    cache: 'no-store', signal,
    ...(enabled !== undefined && {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }),
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || typeof data?.enabled !== 'boolean' || typeof data.available !== 'boolean') {
    throw new Error(typeof data?.error === 'string' ? data.error : data?.error?.message || '');
  }
  return { enabled: data.enabled, available: data.available };
}

export function useChatOptions(sessionId, provider, model, catalogGroups, preset) {
  const url = '/api/dsh-open-model/web-search?' + new URLSearchParams({ sessionId, provider, model });
  const [state, setState] = useState({});
  const [revision, setRevision] = useState(0);
  const lifetime = useRef(null);

  // DSH republishes catalog groups after settings, credentials or adapters change.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    lifetime.current = signal;
    setState({});
    async function load() {
      try {
        await pendingWrites.get(sessionId)?.catch(() => {});
        signal.throwIfAborted();
        const settings = await requestSettings(url, signal);
        if (!signal.aborted) setState({ url, settings });
      } catch (error) {
        if (!signal.aborted) setState({ url, error });
      }
    }
    void load();
    return () => controller.abort();
  }, [sessionId, url, revision, catalogGroups, preset]);

  const current = state.url === url ? state : {};
  async function save(enabled) {
    const signal = lifetime.current;
    if (!signal || signal.aborted || !current.settings?.available || pendingWrites.has(sessionId)) return;
    setState({ url, settings: current.settings, saving: true });
    const write = requestSettings(url, undefined, enabled);
    pendingWrites.set(sessionId, write);
    try {
      const settings = await write;
      if (!signal.aborted) setState({ url, settings });
    } catch (error) {
      if (!signal.aborted) setState({ url, settings: current.settings, error });
    } finally {
      pendingWrites.delete(sessionId);
    }
  }

  return { ...current, save, retry: () => setRevision(value => value + 1) };
}
