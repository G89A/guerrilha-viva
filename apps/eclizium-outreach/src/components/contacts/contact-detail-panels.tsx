'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X } from 'lucide-react';
import { ConsentChannel, ConsentStatus, SuppressionReason } from '@prisma/client';
import { toast } from 'sonner';
import {
  addToListAction,
  addTagAction,
  removeFromListAction,
  removeTagAction,
  suppressContactAction,
  unsuppressContactAction,
  updateConsentAction,
} from '@/app/(dashboard)/contacts/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/errors/result';

/** Executa uma action e transforma o resultado em toast + refresh. */
function useAction() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(
    action: (formData: FormData) => Promise<ActionResult<unknown>>,
    formData: FormData,
    successMessage: string,
  ) {
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        toast.error('Operação não concluída', { description: result.error.message });
        return;
      }
      toast.success(successMessage);
      router.refresh();
    });
  }

  return { run, isPending };
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function TagSelector({
  contactId,
  tags,
  canWrite,
}: {
  contactId: string;
  tags: Array<{ id: string; name: string }>;
  canWrite: boolean;
}) {
  const { run, isPending } = useAction();
  const [value, setValue] = useState('');

  function add() {
    const name = value.trim();
    if (!name) return;
    const formData = new FormData();
    formData.set('contactId', contactId);
    formData.set('tagName', name);
    setValue('');
    run(addTagAction, formData, 'Tag aplicada.');
  }

  return (
    <Panel title="Tags">
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma tag.</p>
        ) : (
          tags.map((tag) => (
            <Badge key={tag.id} variant="neutral" className="gap-1 pr-1">
              {tag.name}
              {canWrite ? (
                <button
                  type="button"
                  aria-label={`Remover tag ${tag.name}`}
                  disabled={isPending}
                  onClick={() => {
                    const formData = new FormData();
                    formData.set('contactId', contactId);
                    formData.set('tagId', tag.id);
                    run(removeTagAction, formData, 'Tag removida.');
                  }}
                  className="rounded-full p-0.5 hover:bg-background"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              ) : null}
            </Badge>
          ))
        )}
      </div>

      {canWrite ? (
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            placeholder="Nova tag"
            maxLength={48}
            aria-label="Nome da tag"
          />
          <Button size="sm" variant="outline" onClick={add} disabled={isPending || !value.trim()}>
            {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
            Aplicar
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

export function ListSelector({
  contactId,
  lists,
  canWrite,
}: {
  contactId: string;
  lists: Array<{ id: string; name: string }>;
  canWrite: boolean;
}) {
  const { run, isPending } = useAction();
  const [value, setValue] = useState('');

  function add() {
    const name = value.trim();
    if (!name) return;
    const formData = new FormData();
    formData.set('contactId', contactId);
    formData.set('listName', name);
    setValue('');
    run(addToListAction, formData, 'Contato adicionado à lista.');
  }

  return (
    <Panel title="Listas">
      <ul className="space-y-1">
        {lists.length === 0 ? (
          <li className="text-sm text-muted-foreground">Não pertence a nenhuma lista.</li>
        ) : (
          lists.map((list) => (
            <li key={list.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{list.name}</span>
              {canWrite ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    const formData = new FormData();
                    formData.set('contactId', contactId);
                    formData.set('listId', list.id);
                    run(removeFromListAction, formData, 'Removido da lista.');
                  }}
                >
                  Remover
                </Button>
              ) : null}
            </li>
          ))
        )}
      </ul>

      {canWrite ? (
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            placeholder="Nome da lista"
            maxLength={80}
            aria-label="Nome da lista"
          />
          <Button size="sm" variant="outline" onClick={add} disabled={isPending || !value.trim()}>
            Adicionar
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

export function ConsentPanel({
  contactId,
  consents,
  canWrite,
}: {
  contactId: string;
  consents: Array<{ channel: ConsentChannel; status: ConsentStatus; capturedAt: Date | null }>;
  canWrite: boolean;
}) {
  const { run, isPending } = useAction();

  const byChannel = new Map(consents.map((consent) => [consent.channel, consent]));

  return (
    <Panel title="Consentimentos">
      <ul className="space-y-2">
        {Object.values(ConsentChannel).map((channel) => {
          const current = byChannel.get(channel);
          const status = current?.status ?? ConsentStatus.UNKNOWN;

          return (
            <li key={channel} className="flex items-center justify-between gap-3">
              <span className="text-sm">{channel}</span>
              {canWrite ? (
                <select
                  aria-label={`Consentimento ${channel}`}
                  disabled={isPending}
                  value={status}
                  onChange={(event) => {
                    const formData = new FormData();
                    formData.set('contactId', contactId);
                    formData.set('channel', channel);
                    formData.set('status', event.target.value);
                    run(updateConsentAction, formData, 'Consentimento atualizado.');
                  }}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value={ConsentStatus.UNKNOWN}>Desconhecido</option>
                  <option value={ConsentStatus.GRANTED}>Concedido</option>
                  <option value={ConsentStatus.REVOKED}>Revogado</option>
                </select>
              ) : (
                <Badge variant="neutral">{status}</Badge>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function SuppressionPanel({
  contactId,
  suppressions,
  canWrite,
  canUnsuppress,
}: {
  contactId: string;
  suppressions: Array<{ id: string; channel: ConsentChannel; reason: string; createdAt: Date }>;
  canWrite: boolean;
  canUnsuppress: boolean;
}) {
  const { run, isPending } = useAction();
  const [notes, setNotes] = useState('');

  return (
    <Panel title="Compliance">
      {suppressions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Este contato não está na lista de supressão.
        </p>
      ) : (
        <ul className="space-y-2">
          {suppressions.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                <Badge variant="destructive">{entry.channel}</Badge>{' '}
                <span className="text-muted-foreground">{entry.reason}</span>
              </span>
              {canUnsuppress ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => {
                    const reason = window.prompt(
                      'Motivo para remover a supressão (registrado em auditoria):',
                    );
                    if (!reason || reason.trim().length < 5) return;
                    const formData = new FormData();
                    formData.set('contactId', contactId);
                    formData.set('channel', entry.channel);
                    formData.set('reason', reason.trim());
                    run(unsuppressContactAction, formData, 'Supressão removida.');
                  }}
                >
                  Remover supressão
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite && suppressions.length === 0 ? (
        <div className="space-y-2 border-t border-border pt-3">
          <Label htmlFor="suppress-notes" className="text-xs text-muted-foreground">
            Observação (opcional)
          </Label>
          <Input
            id="suppress-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={1000}
            placeholder="Ex.: pediu para não receber mensagens"
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() => {
              if (!window.confirm('Suprimir este contato no canal WhatsApp?')) return;
              const formData = new FormData();
              formData.set('contactId', contactId);
              formData.set('channel', ConsentChannel.WHATSAPP);
              formData.set('reason', SuppressionReason.OPT_OUT);
              if (notes.trim()) formData.set('notes', notes.trim());
              run(suppressContactAction, formData, 'Contato suprimido.');
            }}
          >
            Suprimir contato
          </Button>
          <p className="text-xs text-muted-foreground">
            A supressão revoga o consentimento do canal e impede envios futuros.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
