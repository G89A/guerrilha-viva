'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NumberQuality } from '@prisma/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/utils';
import { savePolicyAction, syncHealthAction } from '@/app/(dashboard)/settings/protection/actions';
import type { SendingPolicyView } from '@/features/protection/policy-service';
import type { NumberHealthView } from '@/features/protection/health-service';
import type { ActionResult } from '@/lib/errors/result';

const QUALITY_LABEL: Record<NumberQuality, string> = {
  [NumberQuality.UNKNOWN]: 'Não consultada',
  [NumberQuality.GREEN]: 'Verde',
  [NumberQuality.YELLOW]: 'Amarela',
  [NumberQuality.RED]: 'Vermelha',
};

function Toggle({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border p-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

export function PolicyForm({
  policy,
  health,
  canEdit,
}: {
  policy: SendingPolicyView;
  health: NumberHealthView | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult<{ ok: true }> | null, FormData>(
    savePolicyAction,
    null,
  );
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function sync() {
    setSyncing(true);
    setNotice(null);
    void syncHealthAction()
      .then((result) => {
        if (!result.ok) setNotice(result.error.message);
        else if ('blocked' in result.data) setNotice(result.data.blocked);
        else {
          setNotice(`Qualidade lida: ${QUALITY_LABEL[result.data.quality as NumberQuality]}.`);
          router.refresh();
        }
      })
      .finally(() => setSyncing(false));
  }

  return (
    <div className="space-y-6">
      <Alert>
        <AlertDescription>
          O que derruba um número no WhatsApp não é volume — é gente apertando{' '}
          <strong>Bloquear</strong> e <strong>Denunciar</strong>. Estas regras existem para reduzir
          essa chance. Nenhuma delas serve para disfarçar automação ou escapar de detecção, e o
          produto não implementa esse tipo de recurso.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Saúde do número</CardTitle>
            <CardDescription>
              A Meta classifica a qualidade a partir do comportamento de quem recebe, e restringe o
              envio depois de rebaixá-la. É o aviso que vem antes da restrição.
            </CardDescription>
          </div>
          {canEdit ? (
            <Button type="button" variant="outline" size="sm" disabled={syncing} onClick={sync}>
              {syncing ? 'Consultando…' : 'Consultar agora'}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-2">
          {health === null ? (
            <p className="text-sm text-muted-foreground">Nenhum canal cadastrado.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  variant={
                    health.quality === NumberQuality.RED
                      ? 'destructive'
                      : health.quality === NumberQuality.GREEN
                        ? 'default'
                        : 'neutral'
                  }
                >
                  {QUALITY_LABEL[health.quality]}
                </Badge>
                {health.tier ? (
                  <span className="text-xs text-muted-foreground">Limite: {health.tier}</span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {health.checkedAt
                    ? `Consultada em ${formatDateTime(health.checkedAt)}`
                    : 'Nunca consultada'}
                </span>
              </div>

              {health.stale ? (
                <p className="text-xs text-muted-foreground">
                  A leitura está velha demais para descrever o estado de agora. Consulte de novo
                  antes de um disparo grande.
                </p>
              ) : null}

              {health.blocksSending ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    Com esta qualidade e a política atual, <strong>o envio de campanha está
                    bloqueado</strong>. Trocar de número aqui seria rotação de identidade após
                    bloqueio — proibido, e o caminho mais rápido para perder a conta inteira. O
                    caminho certo é reduzir reclamação: revisar quem entra na audiência, o texto do
                    template e a frequência.
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          )}
          {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        </CardContent>
      </Card>

      <form action={formAction}>
        <fieldset disabled={!canEdit} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Descadastro automático</CardTitle>
              <CardDescription>
                Quem responde pedindo para sair e continua recebendo é exatamente quem denuncia. A
                comparação é com a mensagem inteira — “não quero parar de receber” não descadastra
                ninguém.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Toggle
                name="optOutEnabled"
                label="Descadastrar quando o contato pedir"
                description="Entra na supressão, revoga o consentimento e fica registrado na auditoria."
                defaultChecked={policy.optOutEnabled}
              />
              <div className="space-y-1.5">
                <label htmlFor="keywords" className="text-sm font-medium">
                  Palavras-chave, separadas por vírgula
                </label>
                <Input
                  id="keywords"
                  name="optOutKeywords"
                  defaultValue={policy.optOutKeywords.join(', ')}
                />
                <p className="text-xs text-muted-foreground">
                  Acento e caixa são ignorados. Prefixos de cortesia como “por favor” também.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Frequência</CardTitle>
              <CardDescription>
                Teto de mensagens de campanha para o mesmo contato. Resposta manual na Inbox não
                conta — limitar atendimento seria impedir conversa.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="cap" className="text-sm font-medium">
                  Máximo de mensagens
                </label>
                <Input
                  id="cap"
                  name="frequencyCapMessages"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={policy.frequencyCapMessages}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="window" className="text-sm font-medium">
                  A cada quantos dias
                </label>
                <Input
                  id="window"
                  name="frequencyCapWindowDays"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={policy.frequencyCapWindowDays}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Horário silencioso</CardTitle>
              <CardDescription>
                Mensagem de madrugada é denúncia quase garantida. O envio não é descartado: volta
                para a fila e sai quando a janela abre.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Toggle
                name="quietHoursEnabled"
                label="Não enviar campanha nesse intervalo"
                description="Vale só para campanha. Resposta na Inbox continua livre."
                defaultChecked={policy.quietHoursEnabled}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label htmlFor="start" className="text-sm font-medium">
                    Começa às
                  </label>
                  <Input
                    id="start"
                    name="quietHoursStart"
                    type="number"
                    min={0}
                    max={23}
                    defaultValue={policy.quietHoursStart}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="end" className="text-sm font-medium">
                    Termina às
                  </label>
                  <Input
                    id="end"
                    name="quietHoursEnd"
                    type="number"
                    min={0}
                    max={23}
                    defaultValue={policy.quietHoursEnd}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="tz" className="text-sm font-medium">
                    Fuso
                  </label>
                  <Input id="tz" name="timeZone" defaultValue={policy.timeZone} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Parada por qualidade</CardTitle>
              <CardDescription>
                Parar quando a Meta rebaixa o número. Continuar disparando com qualidade vermelha é
                o caminho mais rápido para a restrição virar permanente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Toggle
                name="pauseOnRedQuality"
                label="Bloquear campanha com qualidade vermelha"
                description="Recomendado. Vermelho significa que a Meta já está prestes a restringir."
                defaultChecked={policy.pauseOnRedQuality}
              />
              <Toggle
                name="pauseOnYellowQuality"
                label="Bloquear também com qualidade amarela"
                description="Mais conservador: para no primeiro sinal, antes do vermelho."
                defaultChecked={policy.pauseOnYellowQuality}
              />
            </CardContent>
          </Card>

          {state && !state.ok ? (
            <Alert variant="destructive">
              <AlertDescription>{state.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {state?.ok ? (
            <Alert>
              <AlertDescription>Política salva.</AlertDescription>
            </Alert>
          ) : null}

          {canEdit ? (
            <Button type="submit" disabled={pending}>
              {pending ? 'Salvando…' : 'Salvar política'}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Seu papel neste workspace não permite alterar a política de envio.
            </p>
          )}
        </fieldset>
      </form>
    </div>
  );
}
