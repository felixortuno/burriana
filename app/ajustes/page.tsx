import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import SettingsClient from './settings-client';
import { getCurrentUser } from '@/lib/server/access';

export const metadata: Metadata = { title: 'Ajustes · Burriana', robots: { index: false, follow: false } };

export default async function SettingsPage() {
  const user = await getCurrentUser(await headers());
  if (!user) redirect('/login');
  return <SettingsClient user={user}/>;
}
