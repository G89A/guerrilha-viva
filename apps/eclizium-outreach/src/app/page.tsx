import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const session = await getCurrentSession();
  redirect(session ? '/dashboard' : '/login');
}
