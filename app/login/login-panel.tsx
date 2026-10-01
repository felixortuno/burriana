'use client';
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import Logo from '../components/logo';
import { useSignIn } from './use-sign-in';
import './login-panel.css';

/** «Recordarme» keeps the username on this device; the session length is the server's. */
const REMEMBER_USER_KEY = 'tm-usuario-recordado';

const read = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => {
  try { if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value); } catch { /* private mode */ }
};

export type LoginPanelHandle = {
  /** Focuses the first empty field, unless the focus is already in the form. */
  focusFirst: () => void;
};

type Props = {
  ref?: Ref<LoginPanelHandle>;
  /** Runs right before the redirect; it must not hold it up. */
  beforeRedirect: () => Promise<void>;
};

/**
 * Sign-in form. The request, its rules and the redirect are the existing ones
 * (useSignIn); this adds field-level messages and works without the scene.
 */
export default function LoginPanel({ ref, beforeRedirect }: Props) {
  const id = useId();
  const { signIn, error, busy } = useSignIn({ beforeRedirect });
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [touched, setTouched] = useState({ user: false, password: false });
  const formRef = useRef<HTMLFormElement>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = read(REMEMBER_USER_KEY);
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists after hydration
    setUser(saved);
    setRemember(true);
  }, []);

  useImperativeHandle(ref, () => ({
    focusFirst() {
      if (!formRef.current || formRef.current.contains(document.activeElement)) return;
      const field = userRef.current?.value.trim() ? passwordRef.current : userRef.current;
      // preventScroll: phones must not jump while the keyboard comes up.
      field?.focus({ preventScroll: true });
    },
  }), []);

  const problems = {
    user: user.trim() ? '' : 'Escribe tu usuario.',
    password: password ? '' : 'Escribe tu contraseña.',
  };
  const shown = { user: touched.user ? problems.user : '', password: touched.password ? problems.password : '' };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched({ user: true, password: true });
    if (problems.user) { userRef.current?.focus(); return; }
    if (problems.password) { passwordRef.current?.focus(); return; }
    write(REMEMBER_USER_KEY, remember ? user.trim() : null);
    const result = await signIn(user, password);
    if (result === 'rechazado') {
      setPassword('');
      setTouched(current => ({ ...current, password: false }));
      passwordRef.current?.focus();
    }
  }

  return <section className="login-panel" aria-labelledby={`${id}-titulo`}>
    <header className="lp-cabecera">
      <Logo variant="lima" size={32} />
      <div>
        <h1 id={`${id}-titulo`}>Iniciar sesión</h1>
        <p>Almacén de Burriana · Grupo Trimodos</p>
      </div>
    </header>

    {/* method="post" so that, without JS, the password never ends up in the URL. */}
    <form ref={formRef} className="lp-form" method="post" onSubmit={submit} noValidate aria-busy={busy}>
      <div className="lp-campo" data-invalid={shown.user ? '' : undefined}>
        <label htmlFor={`${id}-usuario`}>Usuario</label>
        <input ref={userRef} id={`${id}-usuario`} name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          required maxLength={180} value={user} onChange={event => setUser(event.target.value)} onBlur={() => setTouched(current => ({ ...current, user: true }))}
          aria-invalid={shown.user ? true : undefined} aria-describedby={shown.user ? `${id}-usuario-error` : undefined} />
        {shown.user && <p id={`${id}-usuario-error`} className="lp-aviso">{shown.user}</p>}
      </div>

      <div className="lp-campo" data-invalid={shown.password ? '' : undefined}>
        <label htmlFor={`${id}-clave`}>Contraseña</label>
        <div className="lp-clave">
          <input ref={passwordRef} id={`${id}-clave`} type={show ? 'text' : 'password'} name="password" autoComplete="current-password"
            required maxLength={400} value={password} onChange={event => setPassword(event.target.value)} onBlur={() => setTouched(current => ({ ...current, password: true }))}
            aria-invalid={shown.password ? true : undefined} aria-describedby={shown.password ? `${id}-clave-error` : undefined} />
          <button type="button" className="lp-ojo" onClick={() => setShow(value => !value)} aria-pressed={show} aria-controls={`${id}-clave`}
            aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
            {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
        {shown.password && <p id={`${id}-clave-error`} className="lp-aviso">{shown.password}</p>}
      </div>

      <label className="lp-recordar">
        <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
        <span>Recordarme <small>(guarda tu usuario en este dispositivo)</small></span>
      </label>

      {error && <p className="lp-error" role="alert">{error}</p>}

      <button className="lp-entrar" type="submit" disabled={busy}>
        {busy
          ? <><LoaderCircle className="lp-girando" size={18} aria-hidden="true" />Entrando…</>
          : <>Entrar <ArrowRight size={18} aria-hidden="true" /></>}
      </button>
    </form>
  </section>;
}
