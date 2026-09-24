import { GET as getWarehouse, POST as postWarehouse } from '@/lib/server/warehouse-runtime';

export const dynamic = 'force-dynamic';

export const GET = getWarehouse;
export const POST = postWarehouse;
