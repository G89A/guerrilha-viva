'use client';

import { useActionState, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { WhatsAppTemplatePreview, type TemplateButton } from '@/components/templates/whatsapp-template-preview';
import { sendTestMessageAction, type SendTestResult } from '@/app/(dashboard)/templates/actions';
import {
  renderTemplateText,
  VARIABLE_SOURCE_LABELS,
  VARIABLE_SOURCES,
  type VariableBinding,
  type VariableMapping,
  type VariableSource,
} from '@/features/messaging/template-render';
import type { TemplateVariable } from '@/features/messaging/template-normalize';
import type { ActionResult } from '@/lib/errors/result';
import type { TemplateHeaderFormat } from '@prisma/client';

export interface SelectableContact {
  id: string;
  label: string;
  phoneE164: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  city: string | null;
  segment: string | null;
}

export interface SendTestDialogProps {
  templateId: string;
  templateName: string;
  language: string;
  headerFormat: TemplateHeaderFormat | null;
  headerText: string | null;
  body: string;
  footerText: string | null;
  buttons: TemplateButton[];
  variables: TemplateVariable[];
  contacts: SelectableContact[];
  canSend: boolean;
}

/**
 * Envio de teste: UM contato, mapeamento explícito das variáveis, preview e
 * confirmação. O botão só habilita depois que todas as variáveis têm valor —
 * e o servidor revalida tudo de qualquer forma.
 */
export function SendTestDialog(props: SendTestDialogProps) {
  const [open, setOpen] = useState(false);
  const [contactId, setContactId] = useState('');
  const [mapping, setMapping] = useState<VariableMapping>(() => initialMapping(props.variables));

  const [state, formAction, pending] = useActionState<ActionResult<SendTestResult> | null, FormData>(
    sendTestMessageAction,
    null,
  );

  const contact = props.contacts.find((entry) => entry.id === contactId) ?? null;

  const resolved = useMemo(() => {
    if (!contact) return { values: [] as string[], missing: props.variables.map((v) => v.key) };

    const values: string[] = [];
    const missing: string[] = [];

    for (const variable of props.variables.filter((item) => item.component === 'body')) {
      const binding = mapping[`body:${variable.key}`];
      const value = binding ? readValue(contact, binding) : null;
      if (value === null) missing.push(variable.key);
      else values.push(value);
    }

    return { values, missing };
  }, [contact, mapping, props.variables]);

  const ready = contact !== null && resolved.missing.length === 0;
  const result = state?.ok ? state.data : null;

  if (!props.canSend) {
    return (
      <p className="text-sm text-muted-foreground">
        Seu papel neste workspace não permite enviar mensagens de teste.
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        Enviar mensagem de teste
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Envio real via WhatsApp</h3>
          <p className="text-xs text-muted-foreground">
            Uma mensagem, um contato. Isto consome cota da sua conta na Meta.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Fechar
        </Button>
      </div>

      {state && !state.ok ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {result?.status === 'SENT' ? (
        <Alert variant="info">
          <AlertTitle>Mensagem enviada para o provedor</AlertTitle>
          <AlertDescription>
            <span className="block">Provider Message ID:</span>
            <code className="text-xs break-all">{result.providerMessageId}</code>
            <span className="mt-2 block text-xs">
              A entrega será confirmada por webhook, no Sprint 3. Até lá, o status é “enviado ao
              provedor”, não “entregue”.
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      {result?.status === 'BLOCKED' ? (
        <Alert variant="warning">
          <AlertTitle>Envio bloqueado pela verificação de elegibilidade</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc text-sm">
              {result.reasons.map((reason) => (
                <li key={reason.code}>{reason.message}</li>
              ))}
            </ul>
            <span className="mt-2 block text-xs">Nenhuma requisição foi feita à Meta.</span>
          </AlertDescription>
        </Alert>
      ) : null}

      {result?.status === 'FAILED' ? (
        <Alert variant="destructive">
          <AlertTitle>A Meta recusou o envio</AlertTitle>
          <AlertDescription>
            {result.error}
            {result.retryable ? ' Você pode tentar novamente em alguns minutos.' : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label id="contact-label" htmlFor="contact-select">
          Destinatário
        </Label>
        <select
          id="contact-select"
          value={contactId}
          onChange={(event) => setContactId(event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Selecione um contato…</option>
          {props.contacts.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label} — {entry.phoneE164}
            </option>
          ))}
        </select>
        {props.contacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum contato ativo com consentimento de WhatsApp neste workspace.
          </p>
        ) : null}
      </div>

      {props.variables.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Variáveis</p>
          {props.variables.map((variable) => {
            const key = `${variable.component}:${variable.key}`;
            const binding = mapping[key] ?? { source: 'literal' as const, value: '' };

            return (
              <div key={key} className="flex flex-wrap items-center gap-2">
                <code className="w-14 text-xs">{`{{${variable.key}}}`}</code>
                <span className="text-xs text-muted-foreground">{variable.component}</span>
                <select
                  aria-label={`Origem da variável ${variable.key}`}
                  value={binding.source}
                  onChange={(event) =>
                    setMapping((current) => ({
                      ...current,
                      [key]: { ...binding, source: event.target.value as VariableSource },
                    }))
                  }
                  className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {VARIABLE_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {VARIABLE_SOURCE_LABELS[source]}
                    </option>
                  ))}
                </select>
                {binding.source === 'literal' ? (
                  <Input
                    aria-label={`Texto fixo da variável ${variable.key}`}
                    value={binding.value ?? ''}
                    placeholder="Texto fixo"
                    className="flex-1"
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [key]: { ...binding, value: event.target.value },
                      }))
                    }
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-medium">Preview</p>
        <WhatsAppTemplatePreview
          headerFormat={props.headerFormat}
          headerText={props.headerText}
          body={renderTemplateText(props.body, resolved.values)}
          footerText={props.footerText}
          buttons={props.buttons}
        />
      </div>

      {contact && resolved.missing.length > 0 ? (
        <Alert variant="warning">
          <AlertDescription>
            Sem valor para {resolved.missing.map((key) => `{{${key}}}`).join(', ')}. Escolha outra
            origem ou use texto fixo.
          </AlertDescription>
        </Alert>
      ) : null}

      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="templateId" value={props.templateId} />
        <input type="hidden" name="contactId" value={contactId} />
        <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
        <input type="hidden" name="confirmed" value="true" />

        <Button type="submit" disabled={!ready || pending}>
          {pending ? 'Enviando…' : 'Enviar mensagem'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancelar
        </Button>
        {contact ? (
          <span className="text-xs text-muted-foreground">
            Para {contact.label} ({contact.phoneE164}) via {props.templateName} / {props.language}
          </span>
        ) : null}
      </form>
    </div>
  );
}

function initialMapping(variables: TemplateVariable[]): VariableMapping {
  const mapping: VariableMapping = {};
  const preferred: VariableSource[] = [
    'contact.firstName',
    'contact.company',
    'contact.city',
    'contact.segment',
  ];

  variables.forEach((variable, index) => {
    mapping[`${variable.component}:${variable.key}`] = {
      source: preferred[index] ?? 'literal',
      value: '',
    };
  });
  return mapping;
}

/** Espelha `readSource` do servidor para o preview; o servidor decide de fato. */
function readValue(contact: SelectableContact, binding: VariableBinding): string | null {
  switch (binding.source) {
    case 'contact.firstName':
      return contact.firstName;
    case 'contact.lastName':
      return contact.lastName;
    case 'contact.fullName': {
      const full = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
      return full.length > 0 ? full : null;
    }
    case 'contact.company':
      return contact.company;
    case 'contact.city':
      return contact.city;
    case 'contact.segment':
      return contact.segment;
    case 'literal': {
      const value = binding.value?.trim();
      return value && value.length > 0 ? value : null;
    }
    default:
      return null;
  }
}
