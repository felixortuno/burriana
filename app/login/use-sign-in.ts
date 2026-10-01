'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The sign-in call, unchanged from the old login form: POST /api/session with
 * { user, password }, the server's own error messages, and the same redirect
 * by role. Only `beforeRedirect` is new, so the scene can play its exit first.
 */
export function useSignIn({ beforeRedirect }: { beforeRedirect?: () => Promise<void> } = {}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** 'rechazado' means the server answered no (the old form cleared the password then). */
  async function signIn(user: string, password: string): Promise<'ok' | 'rechazado' | 'sin-conexion' | 'ocupado'> {
    if (busy) return 'ocupado';
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? 'No se ha podido entrar. Vuelve a intentarlo.');
        return 'rechazado';
      }
      const session = await res.json() as { user?: { role: string } };
      await beforeRedirect?.().catch(() => undefined);
      router.replace(session.user?.role === 'pantalla' ? '/pantalla' : '/');
      router.refresh();
      return 'ok';
    } catch {
      setError('No hay conexión con el servidor. Comprueba la red y vuelve a intentarlo.');
      return 'sin-conexion';
    } finally {
      setBusy(false);
    }
  }

  return { signIn, error, busy };
}
