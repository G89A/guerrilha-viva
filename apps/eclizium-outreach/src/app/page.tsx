import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth/session';
import { databaseConfigured } from '@/features/setup/database-status';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  // Sem banco não há sessão possível: ir direto ao login, que explica o que
  // falta em vez de estourar um erro de servidor.
  if (!databaseConfigured()) redirect('/login');

  const session = await getCurrentSession();
  redirect(session ? '/dashboard' : '/login');
}
