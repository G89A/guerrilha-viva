'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, RotateCcw } from 'lucide-react';
import { ContactStatus } from '@prisma/client';
import { toast } from 'sonner';
import { archiveContactAction, restoreContactAction } from '@/app/(dashboard)/contacts/actions';
import { Button } from '@/components/ui/button';

export function ArchiveButton({
  contactId,
  status,
}: {
  contactId: string;
  status: ContactStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const archived = status === ContactStatus.ARCHIVED;

  function submit() {
    if (!archived && !window.confirm('Arquivar este contato? Ele deixa de aparecer nas campanhas.'))
      return;

    startTransition(async () => {
      const formData = new FormData();
      formData.set('contactId', contactId);
      const result = await (archived
        ? restoreContactAction(formData)
        : archiveContactAction(formData));

      if (!result.ok) {
        toast.error('Operação não concluída', { description: result.error.message });
        return;
      }
      toast.success(archived ? 'Contato restaurado.' : 'Contato arquivado.');
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={submit} disabled={isPending}>
      {archived ? <RotateCcw aria-hidden="true" /> : <Archive aria-hidden="true" />}
      {archived ? 'Restaurar' : 'Arquivar'}
    </Button>
  );
}
