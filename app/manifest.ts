import type { MetadataRoute } from 'next';
import { brand } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Burriana · Grupo Trimodos',
    short_name: 'Burriana',
    description: 'Organización del almacén, viajes de producción, pedidos, camiones e inventario.',
    lang: 'es',
    start_url: '/',
    display: 'standalone',
    background_color: brand.negro,
    theme_color: brand.negro,
    icons: [
      { src: '/brand/icono-app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icono-app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Smaller emblem so Android's circular and squircle masks never clip its corners.
      { src: '/brand/icono-app-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/icono-app-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
