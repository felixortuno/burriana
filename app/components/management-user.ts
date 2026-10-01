import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/server/access';

export async function managementUser(adminOnly = false) {
  const user = await getCurrentUser(await headers());
  if (!user) redirect('/login');
  if (user.role === 'pantalla') redirect('/pantalla');
  if (adminOnly && user.role !== 'administrador') redirect('/');
  return user;
}
