import type { Metadata } from 'next';
import SettingsClient from './settings-client';
import { managementUser } from '../components/management-user';

export const metadata: Metadata = { title: 'Ajustes · Burriana', robots: { index: false, follow: false } };

export default async function SettingsPage() {
  return <SettingsClient user={await managementUser(true)}/>;
}
