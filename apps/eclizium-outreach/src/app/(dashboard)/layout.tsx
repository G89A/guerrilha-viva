import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { listWorkspacesForUser } from '@/features/workspaces/service';
import { requireWorkspace } from '@/lib/auth/guards';
import { ROLE_LABELS } from '@/lib/auth/roles';
import { getCurrentSession } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors/app-error';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  let context;
  try {
    context = await requireWorkspace();
  } catch (error) {
    // A signed-in user with no membership cannot be served any tenant data.
    if (isAppError(error) && error.code === 'FORBIDDEN') redirect('/login');
    throw error;
  }

  const workspaces = await listWorkspacesForUser(context.user.id);

  return (
    <AppShell
      user={{ name: context.user.name, email: context.user.email }}
      workspace={{
        id: context.workspace.id,
        name: context.workspace.name,
        slug: context.workspace.slug,
      }}
      workspaces={workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      }))}
      roleLabel={ROLE_LABELS[context.role]}
    >
      {children}
    </AppShell>
  );
}
