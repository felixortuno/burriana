import type { Metadata } from 'next';
import { Warehouse } from 'lucide-react';
import LoginForm from './login-form';
import WarehouseDrawing from './warehouse-drawing';

export const metadata: Metadata = {
  title: 'Entrar · BURRIANA - GTR SOLUTIONS-',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main className="login">
      <section className="login-plan">
        <div className="plan-sheet">
          <WarehouseDrawing />
          {/* A title block, the way the original drawing carries its own. */}
          <div className="plan-titleblock">
            <div>
              <b>Plano 08</b>
              <span>Distribución proyectada · diciembre de 2022</span>
            </div>
            <dl>
              <div className="zone-carton">
                <dt>Almacén de cartón</dt>
                <dd>Bloques CAR</dd>
              </div>
              <div className="zone-montaje">
                <dt>Montaje y almacenaje de cajas</dt>
                <dd>Bloques CAJ</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-column">
          <div className="login-brand">
            <span className="login-mark"><Warehouse size={22} /></span>
            <div>
              <b>BURRIANA</b>
              <small>GTR SOLUTIONS</small>
            </div>
          </div>

          <h1>Entrar al almacén</h1>
          <p>Existencias, ubicaciones y cierre de turno.</p>

          <LoginForm />

          <p className="login-foot">La sesión dura el turno, de 07:00 a 15:00.</p>
        </div>
      </section>
    </main>
  );
}
