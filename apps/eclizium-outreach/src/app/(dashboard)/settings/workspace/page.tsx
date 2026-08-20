import type { Metadata } from 'next';
import { RenameWorkspaceForm } from '@/components/workspace/rename-workspace-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listWorkspaceMembers } from '@/features/workspaces/service';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, ROLE_LABELS, WorkspaceRole } from '@/lib/auth/roles';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Workspace' };
export const dynamic = 'force-dynamic';

export default async function WorkspaceSettingsPage() {
  const context = await requireWorkspace();
  const members = await listWorkspaceMembers(context.workspace.id);
  const canEdit = hasAtLeastRole(context.role, WorkspaceRole.ADMIN);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Identificação</CardTitle>
          <CardDescription>
            O slug <code className="rounded bg-muted px-1 py-0.5 text-xs">{context.workspace.slug}</code>{' '}
            é gerado na criação e permanece estável.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RenameWorkspaceForm defaultName={context.workspace.name} canEdit={canEdit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Membros</CardTitle>
          <CardDescription>
            Somente estes usuários podem ler ou escrever dados deste workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Desde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <span className="block font-medium">{member.name}</span>
                    <span className="block text-xs text-muted-foreground">{member.email}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.role === WorkspaceRole.OWNER ? 'default' : 'neutral'}>
                      {ROLE_LABELS[member.role]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(member.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-5 pt-4 text-xs text-muted-foreground">
            Convite e gestão de membros entram em uma fase posterior; hoje o proprietário é criado
            junto com o workspace.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
