'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm() {
  const router = useRouter();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
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
        setPassword('');
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('No hay conexión con el servidor. Comprueba la red y vuelve a intentarlo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit} noValidate>
      {error && <p className="login-error" role="alert">{error}</p>}
      <label className="login-field">
        <span>Usuario</span>
        <input
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={180}
          value={user}
          onChange={event => setUser(event.target.value)}
        />
      </label>
      <label className="login-field">
        <span>Contraseña</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          maxLength={400}
          value={password}
          onChange={event => setPassword(event.target.value)}
        />
      </label>
      <button className="login-submit" type="submit" disabled={busy}>
        {busy ? 'Entrando' : 'Entrar'}
      </button>
    </form>
  );
}
