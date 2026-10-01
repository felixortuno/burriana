import type { Metadata, Viewport } from 'next';
import LoginExperience from './login-experience';

export const metadata: Metadata = {
  title: 'Entrar · Burriana',
  robots: { index: false, follow: false },
};

// The sign-in scene is dark; so is the browser chrome around it.
export const viewport: Viewport = { themeColor: '#141413' };

export default function LoginPage() {
  return <LoginExperience />;
}
