import Management from './components/management';
import { managementUser } from './components/management-user';

export default async function Page() {
  return <Management section="dashboard" user={await managementUser()} />;
}
