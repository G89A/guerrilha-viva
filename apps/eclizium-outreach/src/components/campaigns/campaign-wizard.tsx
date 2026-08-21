'use client';

import { useActionState, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConsentStatus, MissingVariablePolicy } from '@prisma/client';
import { AlertTriangle, ArrowLeft, ArrowRight, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EligibilityReport } from '@/components/campaigns/eligibility-report';
import { WhatsAppTemplatePreview } from '@/components/templates/whatsapp-template-preview';
import {
  createCampaignAction,
  estimateAudienceAction,
} from '@/app/(dashboard)/campaigns/actions';
import {
  VARIABLE_SOURCE_LABELS,
  VARIABLE_SOURCES,
  renderTemplateText,
  type VariableMapping,
  type VariableSource,
} from '@/features/messaging/template-render';
import type { TemplateVariable } from '@/features/messaging/template-normalize';
import type { AudienceEstimate } from '@/features/campaigns/audience-service';
import type { ActionResult } from '@/lib/errors/result';

export interface WizardTemplate {
  id: string;
  name: string;
  language: string;
  body: string;
  headerText: string | null;
  footerText: string | null;
  variables: unknown;
  variableCount: number;
}

export interface WizardOptions {
  lists: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  cities: string[];
  states: string[];
  segments: string[];
  sources: string[];
}

const STEPS = [
  'Detalhes',
  'Canal',
  'Audiência',
  'Template',
  'Variáveis',
  'Elegibilidade',
  'Prévia',
  'Agendamento',
  'Revisão',
] as const;

/**
 * Wizard de criação de campanha.
 *
 * Nada é enviado por este componente. Ao final, a campanha nasce como RASCUNHO
 * e a preparação (materialização da audiência) é uma ação explícita e separada.
 */
export function CampaignWizard({
  templates,
  options,
  channelConnected,
}: {
  templates: WizardTemplate[];
  options: WizardOptions;
  channelConnected: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [listIds, setListIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [consent, setConsent] = useState<ConsentStatus | ''>(ConsentStatus.GRANTED);
  const [mapping, setMapping] = useState<VariableMapping>({});
  const [policy, setPolicy] = useState<MissingVariablePolicy>(
    MissingVariablePolicy.BLOCK_RECIPIENT,
  );
  const [fallbacks, setFallbacks] = useState<Record<string, string>>({});
  const [scheduledAt, setScheduledAt] = useState('');

  const [estimate, setEstimate] = useState<AudienceEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  const [state, formAction, pending] = useActionState<
    ActionResult<{ campaignId: string }> | null,
    FormData
  >(createCampaignAction, null);

  const template = templates.find((entry) => entry.id === templateId) ?? null;
  const variables = useMemo(
    () => ((template?.variables as TemplateVariable[] | undefined) ?? []),
    [template],
  );

  const filters = useMemo(
    () => ({
      ...(listIds.length > 0 ? { listIds } : {}),
      ...(tagIds.length > 0 ? { tagIds } : {}),
      ...(cities.length > 0 ? { cities } : {}),
      ...(consent ? { consent } : {}),
    }),
    [listIds, tagIds, cities, consent],
  );

  async function refreshEstimate() {
    setEstimating(true);
    const result = await estimateAudienceAction(JSON.stringify(filters));
    setEstimate(result.ok ? result.data : null);
    setEstimating(false);
  }

  const previewText = template
    ? renderTemplateText(
        template.body,
        variables
          .filter((variable) => variable.component === 'body')
          .map((variable) => {
            const binding = mapping[`body:${variable.key}`];
            if (binding?.source === 'literal') return binding.value ?? `{{${variable.key}}}`;
            return binding ? exampleFor(binding.source) : `{{${variable.key}}}`;
          }),
      )
    : '';

  const canAdvance = step !== 0 || name.trim().length > 0;
  const readyToCreate = name.trim().length > 0 && templateId.length > 0;

  if (state?.ok) {
    router.push(`/campaigns/${state.data.campaignId}`);
  }

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-1.5" aria-label="Etapas">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(index)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                index === step
                  ? 'bg-primary text-primary-foreground'
                  : index < step
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              {index + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {state && !state.ok ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-lg border border-border p-5">
        {step === 0 ? (
          <div className="space-y-4">
            <Field id="name" label="Nome da campanha" errors={undefined}>
              <Input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                placeholder="Dentistas Fortaleza — Setembro"
                required
              />
            </Field>
            <Field id="description" label="Descrição" hint="Opcional.">
              <textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={2000}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </Field>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Canal</p>
            <Badge variant={channelConnected ? 'success' : 'warning'}>
              WhatsApp {channelConnected ? '· conectado' : '· não conectado'}
            </Badge>
            {!channelConnected ? (
              <Alert variant="warning">
                <AlertTitle>Canal não conectado</AlertTitle>
                <AlertDescription>
                  Conecte a integração da Meta em Configurações → Integrações. Sem canal
                  conectado nenhum contato ficará elegível.
                </AlertDescription>
              </Alert>
            ) : null}
            <p className="text-xs text-muted-foreground">
              E-mail e SMS não fazem parte deste produto ainda.
            </p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <MultiSelect
              label="Listas"
              options={options.lists.map((list) => ({ value: list.id, label: list.name }))}
              selected={listIds}
              onChange={setListIds}
            />
            <MultiSelect
              label="Tags"
              options={options.tags.map((tag) => ({ value: tag.id, label: tag.name }))}
              selected={tagIds}
              onChange={setTagIds}
            />
            <MultiSelect
              label="Cidades"
              options={options.cities.map((city) => ({ value: city, label: city }))}
              selected={cities}
              onChange={setCities}
            />

            <Field id="consent" label="Consentimento de WhatsApp">
              <select
                id="consent"
                value={consent}
                onChange={(event) => setConsent(event.target.value as ConsentStatus | '')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value={ConsentStatus.GRANTED}>Concedido (recomendado)</option>
                <option value="">Qualquer</option>
                <option value={ConsentStatus.UNKNOWN}>Desconhecido</option>
                <option value={ConsentStatus.REVOKED}>Revogado</option>
              </select>
            </Field>

            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" onClick={refreshEstimate} disabled={estimating}>
                {estimating ? 'Calculando…' : 'Estimar audiência'}
              </Button>
              {estimate ? (
                <p className="text-sm text-muted-foreground">
                  {estimate.matched.toLocaleString('pt-BR')} contato(s) ·{' '}
                  {estimate.withConsent.toLocaleString('pt-BR')} com consentimento ·{' '}
                  {estimate.suppressed.toLocaleString('pt-BR')} suprimido(s)
                </p>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">
              Contatos suprimidos ficam de fora sempre, mesmo que estejam nas listas escolhidas.
            </p>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            {templates.length === 0 ? (
              <Alert variant="warning">
                <AlertTitle>Nenhum template aprovado</AlertTitle>
                <AlertDescription>
                  Campanhas iniciadas pela empresa exigem um template aprovado pela Meta.
                  Sincronize os templates em Configurações → Integrações.
                </AlertDescription>
              </Alert>
            ) : (
              <Field id="template" label="Template aprovado">
                <select
                  id="template"
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione…</option>
                  {templates.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} ({entry.language}) · {entry.variableCount} variável(is)
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {template ? (
              <WhatsAppTemplatePreview
                headerFormat={null}
                headerText={template.headerText}
                body={template.body}
                footerText={template.footerText}
                buttons={[]}
              />
            ) : null}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-4">
            {variables.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {template
                  ? 'Este template não tem variáveis.'
                  : 'Escolha um template para mapear as variáveis.'}
              </p>
            ) : (
              variables.map((variable) => {
                const key = `${variable.component}:${variable.key}`;
                const binding = mapping[key] ?? { source: 'literal' as const, value: '' };
                return (
                  <div key={key} className="flex flex-wrap items-center gap-2">
                    <code className="w-14 text-xs">{`{{${variable.key}}}`}</code>
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
                    ) : (
                      <Input
                        aria-label={`Valor alternativo da variável ${variable.key}`}
                        value={fallbacks[key] ?? ''}
                        placeholder="Valor alternativo (opcional)"
                        className="flex-1"
                        onChange={(event) =>
                          setFallbacks((current) => ({ ...current, [key]: event.target.value }))
                        }
                      />
                    )}
                  </div>
                );
              })
            )}

            {variables.length > 0 ? (
              <Label className="flex items-start gap-2 font-normal">
                <input
                  type="checkbox"
                  checked={policy === MissingVariablePolicy.FALLBACK_VALUE}
                  onChange={(event) =>
                    setPolicy(
                      event.target.checked
                        ? MissingVariablePolicy.FALLBACK_VALUE
                        : MissingVariablePolicy.BLOCK_RECIPIENT,
                    )
                  }
                  className="mt-1"
                />
                <span className="text-sm">
                  Usar o valor alternativo quando o contato não tiver o dado
                  <span className="block text-xs text-muted-foreground">
                    Sem isso, quem não tiver o campo preenchido fica de fora — nunca é enviada
                    uma mensagem com lacuna.
                  </span>
                </span>
              </Label>
            ) : null}
          </div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-3">
            <Alert variant="info">
              <AlertTitle>A conta exata sai na preparação</AlertTitle>
              <AlertDescription>
                A estimativa abaixo usa consultas agregadas. O número definitivo — com variável
                ausente e telefone inválido conferidos um a um — aparece depois de preparar a
                campanha ou rodar um ensaio.
              </AlertDescription>
            </Alert>

            {estimate ? (
              <EligibilityReport
                total={estimate.matched}
                eligible={estimate.potentiallyEligible}
                suppressed={estimate.suppressed}
                invalid={estimate.invalidPhone}
                ineligible={estimate.withoutConsent}
                byReason={{
                  CONSENT_MISSING: estimate.withoutConsent,
                  SUPPRESSED: estimate.suppressed,
                  INVALID_PHONE: estimate.invalidPhone,
                }}
              />
            ) : (
              <Button type="button" variant="outline" onClick={refreshEstimate} disabled={estimating}>
                {estimating ? 'Calculando…' : 'Calcular estimativa'}
              </Button>
            )}
          </div>
        ) : null}

        {step === 6 ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Como a mensagem vai chegar</p>
            {template ? (
              <WhatsAppTemplatePreview
                headerFormat={null}
                headerText={template.headerText}
                body={previewText}
                footerText={template.footerText}
                buttons={[]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Escolha um template primeiro.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Os valores acima são exemplos. As prévias reais, por contato, aparecem depois da
              preparação.
            </p>
          </div>
        ) : null}

        {step === 7 ? (
          <div className="space-y-3">
            <Field
              id="scheduledAt"
              label="Agendar para"
              hint="Opcional. Deixe em branco para decidir depois. O horário usa o fuso deste navegador."
            >
              <Input
                id="scheduledAt"
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              O agendamento é gravado em UTC. A execução automática entra na Sprint 5.
            </p>
          </div>
        ) : null}

        {step === 8 ? (
          <div className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Review label="Campanha" value={name || '—'} />
              <Review label="Canal" value="WhatsApp" />
              <Review label="Template" value={template ? `${template.name} (${template.language})` : '—'} />
              <Review
                label="Audiência"
                value={
                  [
                    listIds.length > 0 ? `${listIds.length} lista(s)` : null,
                    tagIds.length > 0 ? `${tagIds.length} tag(s)` : null,
                    cities.length > 0 ? `${cities.length} cidade(s)` : null,
                    consent ? `consentimento ${consent}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Todos os contatos ativos'
                }
              />
              <Review
                label="Estimativa"
                value={
                  estimate
                    ? `${estimate.matched.toLocaleString('pt-BR')} selecionados · ${estimate.potentiallyEligible.toLocaleString('pt-BR')} potencialmente elegíveis`
                    : 'Não calculada'
                }
              />
              <Review
                label="Variável ausente"
                value={
                  policy === MissingVariablePolicy.FALLBACK_VALUE
                    ? 'Usa valor alternativo'
                    : 'Bloqueia o contato'
                }
              />
              <Review label="Agendamento" value={scheduledAt || 'Sem agendamento'} />
            </dl>

            <Alert variant="info">
              <FlaskConical aria-hidden="true" />
              <AlertTitle>A campanha nasce como rascunho</AlertTitle>
              <AlertDescription>
                Criar não envia nada. Depois disso você prepara a audiência, revê os bloqueios e
                só então decide iniciar.
              </AlertDescription>
            </Alert>

            {!readyToCreate ? (
              <Alert variant="warning">
                <AlertTriangle aria-hidden="true" />
                <AlertDescription>
                  Informe um nome e escolha um template aprovado para criar a campanha.
                </AlertDescription>
              </Alert>
            ) : null}

            <form action={formAction}>
              <input type="hidden" name="name" value={name} />
              <input type="hidden" name="description" value={description} />
              <input type="hidden" name="templateId" value={templateId} />
              <input type="hidden" name="audienceFilters" value={JSON.stringify(filters)} />
              <input type="hidden" name="variableMap" value={JSON.stringify(mapping)} />
              <input type="hidden" name="variablePolicy" value={policy} />
              <input type="hidden" name="variableFallbacks" value={JSON.stringify(fallbacks)} />
              <Button type="submit" disabled={!readyToCreate || pending}>
                {pending ? 'Criando…' : 'Criar campanha (rascunho)'}
              </Button>
            </form>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          disabled={step === 0}
        >
          <ArrowLeft aria-hidden="true" className="mr-1 size-4" />
          Voltar
        </Button>
        <Button
          type="button"
          onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
          disabled={step === STEPS.length - 1 || !canAdvance}
        >
          Avançar
          <ArrowRight aria-hidden="true" className="ml-1 size-4" />
        </Button>
      </div>
    </div>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  if (options.length === 0) {
    return (
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">Nada cadastrado ainda.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() =>
                onChange(
                  active
                    ? selected.filter((value) => value !== option.value)
                    : [...selected, option.value],
                )
              }
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                active
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Exemplos usados só na prévia do wizard — nunca enviados. */
function exampleFor(source: VariableSource): string {
  return {
    'contact.firstName': 'Ana',
    'contact.lastName': 'Souza',
    'contact.fullName': 'Ana Souza',
    'contact.company': 'Clínica XPTO',
    'contact.city': 'Fortaleza',
    'contact.segment': 'Saúde',
    literal: '—',
  }[source];
}
