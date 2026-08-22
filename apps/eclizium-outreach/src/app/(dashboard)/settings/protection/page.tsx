import type { Metadata } from 'next';
import { PolicyForm } from '@/components/protection/policy-form';
import { getSendingPolicy } from '@/features/protection/policy-service';
import { numberHealth } from '@/features/protection/health-service';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, WorkspaceRole } from '@/lib/auth/roles';

export const metadata: Metadata = { title: 'Proteção' };
export const dynamic = 'force-dynamic';

export default async function ProtectionPage() {
  const context = await requireWorkspace();
  const policy = await getSendingPolicy(context.workspace.id);
  const health = await numberHealth(context.workspace.id, policy);

  return (
    <PolicyForm
      policy={policy}
      health={health}
      canEdit={hasAtLeastRole(context.role, WorkspaceRole.ADMIN)}
    />
  );
}
