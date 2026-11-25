import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase } from '../shared/identity.js';

const connectionStatuses = ['disconnected', 'connecting', 'connected', 'reauth_required'];

function validFeatures(features) {
  return typeof features?.webSearch === 'boolean' && typeof features.jsonSchema === 'string';
}

export async function request(action, signal, payload, method = 'GET') {
  const response = await fetch(`${apiBase}/${action}`, {
    method,
    headers: { accept: 'application/json', ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    cache: 'no-store',
    signal,
  });
  const data = await response.json().catch(() => undefined);
  if (!response.ok) {
    const failure = new Error(typeof data?.error?.message === 'string' ? data.error.message : '');
    failure.code = data?.error?.code;
    throw failure;
  }
  return data;
}

async function requestConnection(action, signal, payload) {
  const data = await request(action, signal, payload, action === 'status' ? 'GET' : 'POST');
  if (!connectionStatuses.includes(data?.status) || typeof data.available !== 'boolean'
    || typeof data.sharing !== 'boolean' || (action === 'features' && !validFeatures(data.features))) {
    throw new Error();
  }
  return data;
}

function isSignIn(action) {
  return action === 'sign-in' || action === 'enable' || action === 'add-account';
}

export function isAccountDialogAction(action) {
  return action === 'add-account' || action === 'cancel-add';
}

export function useConnection() {
  const [connection, setConnection] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const lifetime = useRef(null);
  const pendingAction = useRef(null);
  const refreshSignal = useRef(null);
  const revision = useRef(0);

  const refresh = useCallback(async (clearError = true) => {
    const signal = lifetime.current?.signal;
    if (!signal || refreshSignal.current === signal || pendingAction.current) return;
    const update = revision.current;
    refreshSignal.current = signal;
    try {
      const next = await requestConnection('status', signal);
      if (signal.aborted || revision.current !== update) return;
      setConnection(next);
      if (clearError) setError(previous => previous?.action === 'status' ? null : previous);
    } catch (failure) {
      if (!signal.aborted && revision.current === update) {
        setError(previous => previous?.action && previous.action !== 'status'
          ? previous : { action: 'status', message: failure.message });
      }
    } finally {
      if (refreshSignal.current === signal) refreshSignal.current = null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    void refresh();
    return () => {
      window.removeEventListener('focus', onFocus);
      controller.abort();
      lifetime.current = null;
      pendingAction.current = null;
    };
  }, [refresh]);

  const polling = connection?.status === 'connecting' || connection?.addingAccount;
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => { void refresh(false); }, 1000);
    return () => { window.clearInterval(timer); };
  }, [polling, refresh]);

  async function run(action, payload) {
    const signal = lifetime.current?.signal;
    const previous = pendingAction.current;
    const route = action === 'add-account' ? 'sign-in' : action === 'cancel-add' ? 'cancel' : action;
    if (!signal || (previous && !(route === 'cancel' && isSignIn(previous)))) return;
    const update = ++revision.current;
    pendingAction.current = action;
    setPending(action);
    setError(null);
    let failed = false;
    try {
      const next = await requestConnection(route, signal, payload);
      if (!signal.aborted && revision.current === update) {
        setConnection(next);
        return next;
      }
    } catch (failure) {
      failed = true;
      if (!signal.aborted && revision.current === update && !(action === 'add-account' && failure.code === 'cancelled')) {
        setError({ action, message: failure.message, code: failure.code });
      }
    } finally {
      if (!signal.aborted && revision.current === update) {
        pendingAction.current = null;
        setPending(null);
        if (failed) void refresh(false);
      }
    }
  }

  return { connection, pending, error, dismissError: () => setError(null), refresh, run };
}
