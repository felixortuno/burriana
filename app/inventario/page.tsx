import Inventory from './inventory-client';
import { managementUser } from '../components/management-user';

export default async function Page() {
  const user = await managementUser();
  return <Inventory user={user}/>;
}
