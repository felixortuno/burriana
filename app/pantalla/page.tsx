import type { Metadata } from 'next';
import WarehouseBoard from './board';
import './board.css';

export const metadata: Metadata = {
  title: 'Pantalla de trabajo · BURRIANA',
  description: 'Organización del turno, producción y muelle del almacén.',
  robots: { index: false, follow: false },
};

export default function BoardPage() {
  return <WarehouseBoard />;
}
