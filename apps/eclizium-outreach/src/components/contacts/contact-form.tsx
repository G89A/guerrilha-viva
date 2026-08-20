'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { ConsentStatus } from '@prisma/client';
import { toast } from 'sonner';
import {
  createContactAction,
  updateContactAction,
  type ContactActionState,
} from '@/app/(dashboard)/contacts/actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ContactFormValues {
  contactId?: string;
  phone: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  segment: string;
  city: string;
  state: string;
  country: string;
  source: string;
  notes: string;
  whatsappConsent?: ConsentStatus;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {pending ? 'Salvando…' : label}
    </Button>
  );
}

function errorsFor(state: ContactActionState, field: string): string[] | undefined {
  if (!state || state.ok) return undefined;
  return state.error.fieldErrors?.[field];
}

export function ContactForm({
  mode,
  defaults,
}: {
  mode: 'create' | 'edit';
  defaults: ContactFormValues;
}) {
  const router = useRouter();
  const action = mode === 'create' ? createContactAction : updateContactAction;
  const [state, formAction] = useActionState<ContactActionState, FormData>(action, null);
  const handled = useRef<ContactActionState>(null);

  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;

    if (state.ok) {
      toast.success(mode === 'create' ? 'Contato criado.' : 'Contato atualizado.');
      router.push(`/contacts/${state.data.contactId}`);
      router.refresh();
    } else if (state.error.code !== 'VALIDATION_ERROR') {
      toast.error('Não foi possível salvar', { description: state.error.message });
    }
  }, [state, mode, router]);

  const blockingError =
    state && !state.ok && state.error.code !== 'VALIDATION_ERROR' ? state.error.message : null;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {defaults.contactId ? (
        <input type="hidden" name="contactId" value={defaults.contactId} />
      ) : null}

      {blockingError ? (
        <Alert variant="destructive">
          <AlertDescription>{blockingError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="phone"
          label="Telefone"
          hint="Aceita formato local; é normalizado para E.164 ao salvar."
          errors={errorsFor(state, 'phone')}
        >
          <Input
            id="phone"
            name="phone"
            defaultValue={defaults.phone}
            required
            maxLength={40}
            inputMode="tel"
            autoComplete="tel"
            placeholder="(85) 99999-9999"
            aria-describedby="phone-error"
            aria-invalid={Boolean(errorsFor(state, 'phone'))}
          />
        </Field>

        <Field id="email" label="E-mail" errors={errorsFor(state, 'email')}>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={defaults.email}
            maxLength={254}
            autoComplete="email"
            aria-describedby="email-error"
            aria-invalid={Boolean(errorsFor(state, 'email'))}
          />
        </Field>

        <Field id="firstName" label="Nome" errors={errorsFor(state, 'firstName')}>
          <Input id="firstName" name="firstName" defaultValue={defaults.firstName} maxLength={120} />
        </Field>

        <Field id="lastName" label="Sobrenome" errors={errorsFor(state, 'lastName')}>
          <Input id="lastName" name="lastName" defaultValue={defaults.lastName} maxLength={120} />
        </Field>

        <Field id="company" label="Empresa" errors={errorsFor(state, 'company')}>
          <Input id="company" name="company" defaultValue={defaults.company} maxLength={160} />
        </Field>

        <Field id="segment" label="Segmento" errors={errorsFor(state, 'segment')}>
          <Input id="segment" name="segment" defaultValue={defaults.segment} maxLength={120} />
        </Field>

        <Field id="city" label="Cidade" errors={errorsFor(state, 'city')}>
          <Input id="city" name="city" defaultValue={defaults.city} maxLength={120} />
        </Field>

        <Field id="state" label="Estado" errors={errorsFor(state, 'state')}>
          <Input id="state" name="state" defaultValue={defaults.state} maxLength={120} />
        </Field>

        <Field id="country" label="País" errors={errorsFor(state, 'country')}>
          <Input id="country" name="country" defaultValue={defaults.country} maxLength={120} />
        </Field>

        <Field id="source" label="Origem" errors={errorsFor(state, 'source')}>
          <Input
            id="source"
            name="source"
            defaultValue={defaults.source}
            maxLength={120}
            placeholder="Ex.: formulário do site"
          />
        </Field>
      </div>

      {mode === 'create' ? (
        <div className="space-y-1.5">
          <Label htmlFor="whatsappConsent">Consentimento WhatsApp</Label>
          <select
            id="whatsappConsent"
            name="whatsappConsent"
            defaultValue={defaults.whatsappConsent ?? ConsentStatus.UNKNOWN}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm sm:max-w-xs"
          >
            <option value={ConsentStatus.UNKNOWN}>Desconhecido</option>
            <option value={ConsentStatus.GRANTED}>Concedido</option>
            <option value={ConsentStatus.REVOKED}>Revogado</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Só marque &ldquo;Concedido&rdquo; se houver registro real do consentimento.
          </p>
        </div>
      ) : null}

      <Field id="notes" label="Observações" errors={errorsFor(state, 'notes')}>
        <textarea
          id="notes"
          name="notes"
          defaultValue={defaults.notes}
          maxLength={4000}
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--color-ring]"
        />
      </Field>

      <div className="flex gap-2">
        <SubmitButton label={mode === 'create' ? 'Criar contato' : 'Salvar alterações'} />
        <Button asChild variant="ghost" type="button">
          <Link href={defaults.contactId ? `/contacts/${defaults.contactId}` : '/contacts'}>
            Cancelar
          </Link>
        </Button>
      </div>
    </form>
  );
}
