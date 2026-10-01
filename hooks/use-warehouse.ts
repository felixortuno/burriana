'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { initialState, type State } from '@/lib/warehouse';
import { returnToLogin } from '@/lib/client-session';

export function useWarehouse() {
  const [data, setData] = useState<State>(initialState);
  const [displayRevision, setDisplayRevision] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const revision = useRef(-1);
  const fetching = useRef(false);
  const saving = useRef(false);
  const mounted = useRef(true);

  const accept = useCallback((result: { state: State; revision: number }) => {
    if (!mounted.current || result.revision < revision.current) return;
    revision.current = result.revision;
    setDisplayRevision(result.revision);
    setData(result.state);
    setUpdatedAt(new Date().toISOString());
    setError('');
  }, []);

  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const response = await fetch('/api/warehouse', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (response.status === 401) { returnToLogin(); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pueden actualizar los datos.');
      accept(result);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'No hay conexión.');
    } finally {
      fetching.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [accept]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = window.setInterval(refresh, 15000);
    const focus = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [refresh]);

  const save = useCallback(async (action: Record<string, unknown>) => {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    try {
      const response = await fetch('/api/warehouse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: revision.current, action }), signal: AbortSignal.timeout(20000),
      });
      if (response.status === 401) { returnToLogin(); return false; }
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) await refresh();
        throw new Error(result.error || 'No se ha podido guardar.');
      }
      accept(result);
      return true;
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [accept, refresh]);

  return { data, revision: displayRevision, loading, error, busy, updatedAt, refresh, save };
}
