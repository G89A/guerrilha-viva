import Link from 'next/link';
import { ConsentStatus, type ConsentChannel } from '@prisma/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPhone } from '@/features/contacts/phone';
import { CHANNEL_LABELS, CONSENT_LABELS } from '@/features/consent/service';

export interface ContactPanelProps {
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    phoneE164: string;
    email: string | null;
    company: string | null;
    city: string | null;
    notes: string | null;
    source: string | null;
  };
  tags: Array<{ id: string; name: string }>;
  lists: Array<{ id: string; name: string }>;
  consents: Array<{ channel: ConsentChannel; status: ConsentStatus }>;
  suppressed: boolean;
}

const CONSENT_VARIANT: Record<ConsentStatus, 'success' | 'destructive' | 'neutral'> = {
  [ConsentStatus.GRANTED]: 'success',
  [ConsentStatus.REVOKED]: 'destructive',
  [ConsentStatus.UNKNOWN]: 'neutral',
};

/** Ficha resumida do contato ao lado da conversa. Reusa o domínio da Sprint 1. */
export function ContactPanel({ contact, tags, lists, consents, suppressed }: ContactPanelProps) {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || 'Sem nome';

  return (
    <div className="space-y-5 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{name}</h2>
        <p className="font-mono text-xs text-muted-foreground">{formatPhone(contact.phoneE164)}</p>
      </div>

      {suppressed ? (
        <Badge variant="destructive">Na lista de supressão</Badge>
      ) : null}

      <dl className="space-y-2 text-sm">
        {contact.company ? (
          <div>
            <dt className="text-xs text-muted-foreground">Empresa</dt>
            <dd>{contact.company}</dd>
          </div>
        ) : null}
        {contact.email ? (
          <div>
            <dt className="text-xs text-muted-foreground">E-mail</dt>
            <dd className="break-all">{contact.email}</dd>
          </div>
        ) : null}
        {contact.city ? (
          <div>
            <dt className="text-xs text-muted-foreground">Cidade</dt>
            <dd>{contact.city}</dd>
          </div>
        ) : null}
        {contact.source ? (
          <div>
            <dt className="text-xs text-muted-foreground">Origem</dt>
            <dd>{contact.source}</dd>
          </div>
        ) : null}
      </dl>

      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Consentimento</p>
        <div className="flex flex-wrap gap-1.5">
          {consents.length === 0 ? (
            <Badge variant="neutral">Sem registro</Badge>
          ) : (
            consents.map((consent) => (
              <Badge key={consent.channel} variant={CONSENT_VARIANT[consent.status]}>
                {CHANNEL_LABELS[consent.channel]}: {CONSENT_LABELS[consent.status]}
              </Badge>
            ))
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Tags</p>
        <div className="flex flex-wrap gap-1.5">
          {tags.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            tags.map((tag) => (
              <Badge key={tag.id} variant="outline">
                {tag.name}
              </Badge>
            ))
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Listas</p>
        <div className="flex flex-wrap gap-1.5">
          {lists.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            lists.map((list) => (
              <Badge key={list.id} variant="outline">
                {list.name}
              </Badge>
            ))
          )}
        </div>
      </div>

      {contact.notes ? (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Notas</p>
          <p className="whitespace-pre-wrap text-sm">{contact.notes}</p>
        </div>
      ) : null}

      <Button asChild variant="outline" size="sm" className="w-full">
        <Link href={`/contacts/${contact.id}`}>Abrir ficha completa</Link>
      </Button>
    </div>
  );
}
