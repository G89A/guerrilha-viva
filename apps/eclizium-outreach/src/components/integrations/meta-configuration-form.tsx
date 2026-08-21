'use client';

import { useActionState, useState } from 'react';
import { ChannelEnvironment, CredentialSource } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { configureIntegrationAction } from '@/app/(dashboard)/settings/integrations/actions';
import type { ActionResult } from '@/lib/errors/result';
import type { ChannelView } from '@/features/messaging/channel-service';

/**
 * Formulário de configuração da integração.
 *
 * O access token só trafega do navegador para o servidor no momento em que o
 * operador o digita. Ele NUNCA é devolvido: o campo vem sempre vazio, e o que
 * se mostra do token existente é apenas o fingerprint.
 */
export function MetaConfigurationForm({
  channel,
  envFingerprint,
}: {
  channel: ChannelView | null;
  envFingerprint: string | null;
}) {
  const [state, formAction, pending] = useActionState<ActionResult<{ channelId: string }> | null, FormData>(
    configureIntegrationAction,
    null,
  );

  const [credentialSource, setCredentialSource] = useState<CredentialSource>(
    channel?.credentials.source ?? CredentialSource.ENVIRONMENT,
  );

  const fieldErrors = state && !state.ok ? (state.error.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="space-y-5">
      {state && !state.ok ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {state?.ok ? (
        <Alert variant="info">
          <AlertDescription>
            Configuração salva. Use “Testar conexão” para validar contra a Meta — só então o canal
            é marcado como conectado.
          </AlertDescription>
        </Alert>
      ) : null}

      <Field label="Nome de exibição" errors={fieldErrors.displayName} id="displayName">
        <Input
          id="displayName"
          name="displayName"
          defaultValue={channel?.displayName ?? 'WhatsApp Business'}
          maxLength={80}
          required
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="WABA ID" errors={fieldErrors.wabaId} id="wabaId">
          <Input
            id="wabaId"
            name="wabaId"
            defaultValue={channel?.wabaId ?? ''}
            inputMode="numeric"
            placeholder="222222222222222"
            required
          />
        </Field>

        <Field
          label="Phone Number ID"
          errors={fieldErrors.phoneNumberId}
          id="phoneNumberId"
        >
          <Input
            id="phoneNumberId"
            name="phoneNumberId"
            defaultValue={channel?.phoneNumberId ?? ''}
            inputMode="numeric"
            placeholder="111111111111111"
            required
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Versão da Graph API"
          errors={fieldErrors.graphApiVersion}
          hint="Configurável para que atualizar de versão não seja um salto no escuro."
          id="graphApiVersion"
        >
          <Input
            id="graphApiVersion"
            name="graphApiVersion"
            defaultValue={channel?.graphApiVersion ?? 'v21.0'}
            placeholder="v21.0"
            required
          />
        </Field>

        <Field label="Ambiente" errors={fieldErrors.environment} id="environment">
          <select
            id="environment"
            name="environment"
            defaultValue={channel?.environment ?? ChannelEnvironment.TEST}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value={ChannelEnvironment.TEST}>Teste</option>
            <option value={ChannelEnvironment.PRODUCTION}>Produção</option>
          </select>
        </Field>
      </div>

      <fieldset className="space-y-3 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium">Credencial</legend>

        <div className="space-y-2">
          <Label className="flex items-start gap-2 font-normal">
            <input
              type="radio"
              name="credentialSource"
              value={CredentialSource.ENVIRONMENT}
              checked={credentialSource === CredentialSource.ENVIRONMENT}
              onChange={() => setCredentialSource(CredentialSource.ENVIRONMENT)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Variável de ambiente</span>
              <span className="block text-xs text-muted-foreground">
                Usa <code>META_ACCESS_TOKEN</code> do servidor.{' '}
                {envFingerprint
                  ? `Token presente (${envFingerprint}).`
                  : 'Nenhum token definido no ambiente.'}
              </span>
            </span>
          </Label>

          <Label className="flex items-start gap-2 font-normal">
            <input
              type="radio"
              name="credentialSource"
              value={CredentialSource.ENCRYPTED}
              checked={credentialSource === CredentialSource.ENCRYPTED}
              onChange={() => setCredentialSource(CredentialSource.ENCRYPTED)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Token deste workspace</span>
              <span className="block text-xs text-muted-foreground">
                Guardado cifrado (AES-256-GCM) no banco. Necessário quando cada workspace tem sua
                própria conta na Meta.
              </span>
            </span>
          </Label>
        </div>

        {credentialSource === CredentialSource.ENCRYPTED ? (
          <Field
            label="Access Token"
            errors={fieldErrors.accessToken}
            hint={
              channel?.credentials.fingerprint
                ? `Já existe um token salvo (${channel.credentials.fingerprint}). Deixe em branco para mantê-lo.`
                : 'O token é cifrado antes de ser gravado e nunca volta para o navegador.'
            }
            id="accessToken"
          >
            <Input
              id="accessToken"
              name="accessToken"
              type="password"
              autoComplete="off"
              placeholder="••••••••••••••••••••••••"
            />
          </Field>
        ) : null}
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? 'Salvando…' : 'Salvar configuração'}
      </Button>
    </form>
  );
}
