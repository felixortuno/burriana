import { env } from 'cloudflare:workers';
export function warehouseDb(){if(!env.DB)throw new Error('Almacenamiento no disponible');return env.DB;}
