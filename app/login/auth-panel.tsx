'use client';
import { ArrowRight, Eye, EyeOff, Info, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import Logo from '../components/logo';
import { REMEMBER_USER_KEY } from './escena/config';
import { useSignIn } from './use-sign-in';

type Tab = 'entrar' | 'registro';

type Props = {
  /** Hidden and inert until the intro reaches the panel. */
  visible: boolean;
  /** The username field, so a keypress during the intro can land there. */
  userRef: RefObject<HTMLInputElement | null>;
  /** Plays the exit; the redirect waits for it (the caller caps it at 600 ms). */
  beforeRedirect: () => Promise<void>;
};

const read = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => {
  try { if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value); } catch { /* private mode */ }
};

/**
 * Sign-in panel over the scene. The request, its validation and the redirect
 * are the existing ones (useSignIn); this only adds field-level messages.
 */
export default function AuthPanel({ visible, userRef, beforeRedirect }: Props) {
  const id = useId();
  const [tab, setTab] = useState<Tab>('entrar');
  const tabs = useRef<Record<Tab, HTMLButtonElement | null>>({ entrar: null, registro: null });
  const select = (next: Tab) => { setTab(next); tabs.current[next]?.focus(); };
  const onTabKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      select(tab === 'entrar' ? 'registro' : 'entrar');
    }
  };

  return <section className={'auth-panel' + (visible ? ' visible' : '')} inert={!visible} aria-labelledby={`${id}-titulo`}>
    <header className="auth-head">
      <span className="auth-mark"><Logo variant="lima" size={22} /></span>
      <span className="auth-brand">Grupo Trimodos</span>
    </header>
    <h1 id={`${id}-titulo`} className="auth-title">Almacén de Burriana</h1>
    <p className="auth-lead">Entra para ver el turno, el stock y la nave.</p>

    <div className="auth-tabs" role="tablist" aria-label="Acceso">
      {(['entrar', 'registro'] as const).map(name => <button key={name} ref={node => { tabs.current[name] = node; }}
        type="button" role="tab" id={`${id}-tab-${name}`} aria-selected={tab === name} aria-controls={`${id}-panel-${name}`}
        tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={onTabKey}>
        {name === 'entrar' ? 'Iniciar sesión' : 'Registrarse'}
      </button>)}
      <i className="auth-tabs-thumb" data-tab={tab} aria-hidden="true" />
    </div>

    <div role="tabpanel" id={`${id}-panel-entrar`} aria-labelledby={`${id}-tab-entrar`} hidden={tab !== 'entrar'}>
      <SignInForm userRef={userRef} beforeRedirect={beforeRedirect} />
    </div>
    <div role="tabpanel" id={`${id}-panel-registro`} aria-labelledby={`${id}-tab-registro`} hidden={tab !== 'registro'}>
      <RegisterForm onSignIn={() => select('entrar')} />
    </div>
  </section>;
}

function SignInForm({ userRef, beforeRedirect }: Pick<Props, 'userRef' | 'beforeRedirect'>) {
  const id = useId();
  const { signIn, error, busy } = useSignIn({ beforeRedirect });
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [touched, setTouched] = useState({ user: false, password: false });
  const passwordRef = useRef<HTMLInputElement>(null);

  // «Recordarme» keeps the username on this device; the session length is the server's.
  useEffect(() => {
    const saved = read(REMEMBER_USER_KEY);
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists after hydration
    setUser(saved);
    setRemember(true);
  }, []);

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

  return <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy}>
    <div className="auth-field" data-invalid={shown.user ? '' : undefined}>
      <label htmlFor={`${id}-usuario`}>Usuario</label>
      <input ref={userRef} id={`${id}-usuario`} name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        required maxLength={180} value={user} onChange={event => setUser(event.target.value)} onBlur={() => setTouched(current => ({ ...current, user: true }))}
        aria-invalid={shown.user ? true : undefined} aria-describedby={shown.user ? `${id}-usuario-error` : undefined} />
      {shown.user && <p id={`${id}-usuario-error`} className="auth-hint">{shown.user}</p>}
    </div>
    <div className="auth-field" data-invalid={shown.password ? '' : undefined}>
      <label htmlFor={`${id}-clave`}>Contraseña</label>
      <div className="auth-password">
        <input ref={passwordRef} id={`${id}-clave`} type={show ? 'text' : 'password'} name="password" autoComplete="current-password"
          required maxLength={400} value={password} onChange={event => setPassword(event.target.value)} onBlur={() => setTouched(current => ({ ...current, password: true }))}
          aria-invalid={shown.password ? true : undefined} aria-describedby={shown.password ? `${id}-clave-error` : undefined} />
        <button type="button" className="auth-eye" onClick={() => setShow(value => !value)} aria-pressed={show} aria-controls={`${id}-clave`}
          aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
          {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      {shown.password && <p id={`${id}-clave-error`} className="auth-hint">{shown.password}</p>}
    </div>
    <label className="auth-check">
      <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
      <span>Recordarme <small>(guarda tu usuario en este dispositivo)</small></span>
    </label>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button className="auth-submit" type="submit" disabled={busy}>
      {busy ? <><LoaderCircle className="auth-spin" size={18} aria-hidden="true" />Entrando…</> : <>Entrar <ArrowRight size={18} aria-hidden="true" /></>}
    </button>
    <p className="auth-foot">Perfiles de administrador, encargado o pantalla. La sesión dura ocho horas.</p>
  </form>;
}

/**
 * Prepared for self-registration, which the backend does not have: profiles are
 * created by an administrator (POST /api/users, admin only). The fields and rules
 * mirror createUser; plug a public endpoint into `register` to switch it on.
 */
const register: null | ((input: { name: string; username: string; password: string }) => Promise<void>) = null;

function RegisterForm({ onSignIn }: { onSignIn: () => void }) {
  const id = useId();
  const enabled = register !== null;
  return <form className="auth-form" onSubmit={event => event.preventDefault()} noValidate>
    <p className="auth-note" id={`${id}-aviso`}>
      <Info size={16} aria-hidden="true" />
      <span>Las cuentas las crea un administrador en <b>Personas y accesos</b>. Pide tu perfil a tu encargado.</span>
    </p>
    <fieldset disabled={!enabled} aria-describedby={`${id}-aviso`}>
      <div className="auth-field">
        <label htmlFor={`${id}-nombre`}>Nombre</label>
        <input id={`${id}-nombre`} name="name" autoComplete="name" maxLength={100} />
      </div>
      <div className="auth-field">
        <label htmlFor={`${id}-alta-usuario`}>Usuario</label>
        <input id={`${id}-alta-usuario`} name="username" autoComplete="username" autoCapitalize="none" maxLength={64} pattern="[a-z0-9][a-z0-9._@\-]{1,63}" />
      </div>
      <div className="auth-field">
        <label htmlFor={`${id}-alta-clave`}>Contraseña <small>(mínimo 6 caracteres)</small></label>
        <input id={`${id}-alta-clave`} type="password" name="new-password" autoComplete="new-password" minLength={6} maxLength={256} />
      </div>
      <button className="auth-submit" type="submit">Crear cuenta</button>
    </fieldset>
    <button type="button" className="auth-link" onClick={onSignIn}>Ya tengo cuenta: iniciar sesión</button>
  </form>;
}
