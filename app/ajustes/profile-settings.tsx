'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ClipboardList, KeyRound, LogOut, Monitor, ShieldCheck, UserRound, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicUser } from '@/lib/identity';
import { returnToLogin } from '@/lib/client-session';

const roles = {
  administrador: { label: 'Administrador', Icon: ShieldCheck, detail: 'Gestionas el almacén, las personas y sus permisos.' },
  encargado: { label: 'Encargado', Icon: ClipboardList, detail: 'Organizas el turno, registras producción y gestionas el inventario.' },
  pantalla: { label: 'Pantalla', Icon: Monitor, detail: 'Consultas las instrucciones del turno y gestionas tu propia cuenta.' },
};

export default function ProfileSettings({ user, onUpdate }: { user: PublicUser; onUpdate: (user: PublicUser) => void }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [passwords, setPasswords] = useState({ current: '', next: '', repeat: '' });
  const [busy, setBusy] = useState<'name' | 'password' | 'logout' | null>(null);
  const [failure, setFailure] = useState<{ section: string; message: string } | null>(null);
  const editable = user.id !== 'bootstrap';
  const role = roles[user.role];

  async function save(section: 'name' | 'password', body: Record<string, unknown>) {
    if (busy) return false;
    setBusy(section);
    setFailure(null);
    try {
      const response = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      if (response.status === 401) { returnToLogin(); return false; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se han podido guardar los cambios.');
      onUpdate(result.user);
      setName(result.user.name);
      router.refresh();
      toast.success(section === 'name' ? 'Nombre actualizado.' : 'Contraseña actualizada. Tu sesión sigue abierta.');
      return true;
    } catch (reason) {
      setFailure({ section, message: reason instanceof Error ? reason.message : 'No hay conexión. Vuelve a intentarlo.' });
      return false;
    } finally { setBusy(null); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwords.next !== passwords.repeat) {
      setFailure({ section: 'password', message: 'Las dos contraseñas nuevas deben coincidir.' });
      return;
    }
    if (await save('password', { action: 'password', currentPassword: passwords.current, password: passwords.next })) setPasswords({ current: '', next: '', repeat: '' });
  }

  async function logout() {
    setBusy('logout');
    setFailure(null);
    try {
      const response = await fetch('/api/session', { method: 'DELETE', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('No se ha podido cerrar la sesión. Vuelve a intentarlo.');
      returnToLogin();
    } catch (reason) {
      setFailure({ section: 'logout', message: reason instanceof Error ? reason.message : 'No hay conexión. Vuelve a intentarlo.' });
      setBusy(null);
    }
  }

  return <div className="profile-settings">
    <section className="profile-overview" aria-label="Tu perfil">
      <span className="profile-initial" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
      <div><h2>{user.name}</h2><p>@{user.username}</p></div>
      <span className="profile-role"><role.Icon size={16}/>{role.label}</span>
    </section>
    {!editable && <div className="callout profile-main-account"><ShieldCheck size={20}/><div><b>Cuenta principal</b><p>El nombre y la contraseña de esta cuenta se cambian en la configuración del servidor. Crea un perfil administrador personal para editarlos desde aquí.</p><Link href="/usuarios" className="btn secondary">Gestionar perfiles <ArrowRight size={14}/></Link></div></div>}
    <div className="profile-columns">
      <section className="group">
        <div className="group-head"><div><h2><UserRound size={18}/> Datos personales</h2><p>El nombre que aparece en la aplicación y en tus operaciones.</p></div></div>
        <form onSubmit={async event => { event.preventDefault(); await save('name', { action: 'name', name }); }}>
          <div className="profile-form-fields">
            <label className="field"><span>Nombre</span><input name="name" required maxLength={100} autoComplete="name" readOnly={!editable} value={name} onChange={event => setName(event.target.value)}/></label>
            <label className="field"><span>Usuario de acceso</span><input autoComplete="username" value={user.username} readOnly/></label>
            <p className="profile-note">El usuario de acceso se mantiene igual al cambiar tu nombre.</p>
            {failure?.section === 'name' && <div className="callout error" role="alert">{failure.message}</div>}
          </div>
          {editable && <div className="group-foot"><button className="btn primary" disabled={Boolean(busy) || !name.trim() || name.trim() === user.name}>{busy === 'name' ? 'Guardando…' : 'Guardar nombre'}</button></div>}
        </form>
      </section>
      <section className="group">
        <div className="group-head"><div><h2><KeyRound size={18}/> Contraseña</h2><p>{editable ? 'Para cambiarla, confirma primero tu contraseña actual.' : 'Esta cuenta se configura en el servidor.'}</p></div></div>
        {editable ? <form onSubmit={changePassword}>
          <div className="profile-form-fields">
            <input className="sr-only" tabIndex={-1} aria-hidden="true" autoComplete="username" value={user.username} readOnly/>
            <label className="field"><span>Contraseña actual</span><input type="password" name="currentPassword" autoComplete="current-password" required maxLength={256} value={passwords.current} onChange={event => setPasswords({ ...passwords, current: event.target.value })}/></label>
            <label className="field"><span>Nueva contraseña</span><input type="password" name="newPassword" autoComplete="new-password" required minLength={6} maxLength={256} aria-describedby="password-requirement" value={passwords.next} onChange={event => setPasswords({ ...passwords, next: event.target.value })}/></label>
            <label className="field"><span>Repetir nueva contraseña</span><input type="password" name="repeatPassword" autoComplete="new-password" required minLength={6} maxLength={256} value={passwords.repeat} onChange={event => setPasswords({ ...passwords, repeat: event.target.value })}/></label>
            <p className="profile-note" id="password-requirement">Mínimo 6 caracteres. Se cerrarán las sesiones de otros dispositivos; esta seguirá abierta.</p>
            {failure?.section === 'password' && <div className="callout error" role="alert">{failure.message}</div>}
          </div>
          <div className="group-foot"><button className="btn primary" disabled={Boolean(busy)}>{busy === 'password' ? 'Guardando…' : 'Cambiar contraseña'}</button></div>
        </form> : <p className="profile-form-fields profile-note">Para usar una contraseña personal que puedas cambiar aquí, accede con un perfil creado desde Personas y accesos.</p>}
      </section>
    </div>
    <section className="group profile-access">
      <div className="group-head"><div><h2><role.Icon size={18}/> Tu acceso</h2><p>{role.detail}{user.role !== 'administrador' && ' El administrador gestiona tus permisos.'}</p></div><button className="btn secondary" disabled={Boolean(busy)} onClick={logout}><LogOut size={15}/>{busy === 'logout' ? 'Saliendo…' : 'Cerrar sesión'}</button></div>
      {failure?.section === 'logout' && <div className="profile-form-fields"><div className="callout error" role="alert">{failure.message}</div></div>}
    </section>
  </div>;
}

export function TeamSettings() {
  return <div className="profile-settings">
    <section className="group team-settings">
      <span className="team-settings-icon"><Users size={26}/></span>
      <div><h2>Personas y accesos</h2><p>Controla quién entra al almacén y qué puede hacer cada perfil.</p></div>
      <Link className="btn primary" href="/usuarios">Gestionar equipo <ArrowRight size={16}/></Link>
      <ul><li>Crea cuentas para el equipo y las pantallas.</li><li>Edita nombres, cambia permisos y restablece contraseñas.</li><li>Desactiva accesos conservando el historial de operaciones.</li></ul>
    </section>
    <div className="roles">{Object.entries(roles).map(([key, role]) => <section className="group" key={key}><role.Icon size={22}/><h3>{role.label}</h3><p>{role.detail}</p></section>)}</div>
    <p className="profile-note">Cada persona puede cambiar su nombre y contraseña en Mi perfil. Los ajustes del almacén y el control del equipo están reservados al administrador.</p>
  </div>;
}
