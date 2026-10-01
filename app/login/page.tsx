import type { Metadata, Viewport } from 'next';
import LoginScreen from './login-screen';

export const metadata: Metadata = {
  title: 'Entrar · Burriana',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // The scene is dark; so is the browser chrome around it.
  themeColor: '#0F1216',
  // Android shrinks the layout (and dvh) for the keyboard, so the panel stays in view.
  interactiveWidget: 'resizes-content',
};

export default function LoginPage() {
  return <LoginScreen />;
}
