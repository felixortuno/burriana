import type { Metadata } from 'next';
import Logo from '../components/logo';
import { BrandCube } from '../components/cubo-loader';
import LoginForm from './login-form';

export const metadata: Metadata = {
  title: 'Entrar · Burriana',
  robots: { index: false, follow: false },
};

const companies = [
  { name: 'Intraser', color: 'var(--tm-azul)' },
  { name: 'Transargi', color: 'var(--tm-naranja)' },
  { name: 'Stinsa', color: 'var(--tm-turquesa)' },
];

export default function LoginPage() {
  return (
    <main className="signin">
      <section className="signin-brand">
        <div className="signin-cube"><BrandCube size={150} /></div>
        <div className="signin-brand-text">
          <b>Grupo Trimodos</b>
          <span>Cartonaje, transporte y logística</span>
          <ul aria-label="Empresas del grupo">{companies.map(company => <li key={company.name}><i style={{ background: company.color }} />{company.name}</li>)}</ul>
        </div>
      </section>
      <section className="signin-panel">
        <div className="signin-card">
          <span className="glyph"><Logo variant="tema" size="62%" title="Grupo Trimodos" data-logo-target="" /></span>
          <h1>Almacén de Burriana</h1>
          <p>Entra para ver el turno, el stock y la nave.</p>
          <LoginForm />
          <p className="login-foot">Usa tu perfil de administrador, encargado o pantalla. La sesión dura ocho horas.</p>
        </div>
      </section>
    </main>
  );
}
