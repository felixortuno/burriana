import type { Metadata } from 'next';
import LoaderDemo from './demo';

export const metadata: Metadata = {
  title: 'Pantalla de carga · Burriana',
  robots: { index: false, follow: false },
};

export default function DemoLoaderPage() {
  return <LoaderDemo/>;
}
