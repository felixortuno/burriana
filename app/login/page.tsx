import type { Metadata } from 'next';
import LoginForm from './login-form';

export const metadata: Metadata = {
  title: 'Entrar · BURRIANA - GTR SOLUTIONS-',
  robots: { index: false, follow: false },
};

// The same two zones the app manages, taken from the plano 08 geometry: the
// cardboard warehouse on the left and the L of box assembly and storage around it.
const CARTON = 'M35 35H852V594H35Z';
const MONTAJE = 'M860 35H1929V1155H35V605H860Z';

export default function LoginPage() {
  return (
    <main className="login">
      <section className="login-plan" aria-hidden="true">
        <svg viewBox="0 0 2100 1200" preserveAspectRatio="xMidYMid meet">
          <path d={CARTON} fill="#168769" fillOpacity=".18" stroke="#3fae8c" strokeWidth="6" />
          <path d={MONTAJE} fill="#b88726" fillOpacity=".12" stroke="#d4a23f" strokeWidth="6" />
        </svg>
        <div className="login-plan-key">
          <span><i className="key-carton" />Almacén de cartón</span>
          <span><i className="key-montaje" />Montaje y almacenaje de cajas</span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-brand">
          <b>BURRIANA</b>
          <small>GTR SOLUTIONS</small>
        </div>
        <h1>Entrar al almacén</h1>
        <p>Gestión de existencias, ubicaciones y cierre de turno. Uso interno de oficina.</p>
        <LoginForm />
        <footer className="login-foot">
          <span>Turno de mañana · 07:00 a 15:00</span>
          <span>La sesión dura un turno. Al día siguiente vuelve a pedir la contraseña.</span>
        </footer>
      </section>
    </main>
  );
}
