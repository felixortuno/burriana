import type { Metadata } from 'next';
import Logo from '../components/logo';
import LoginForm from './login-form';

export const metadata: Metadata = {
  title: 'Entrar · Burriana',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main className="signin">
      <div className="signin-card">
        <span className="glyph"><Logo variant="tema" size="62%" title="Grupo Trimodos" data-logo-target="" /></span>
        <h1>Almacén de Burriana</h1>
        <p>Producción, expediciones y organización del turno.</p>
        <LoginForm />
        <p className="login-foot">Entra con tu perfil de administrador, encargado o pantalla. La sesión dura ocho horas.</p>
      </div>
    </main>
  );
}
