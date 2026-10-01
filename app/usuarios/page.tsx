import Management from '../components/management';
import { managementUser } from '../components/management-user';

export default async function Page() {
  return <Management section="usuarios" user={await managementUser(true)} />;
}
