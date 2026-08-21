import 'server-only';
import type { Campaign, Prisma } from '@prisma/client';
import {
  CampaignStatus,
  ChannelKind,
  RecipientEligibility,
  RecipientStatus,
} from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { logger } from '@/lib/logging/logger';
import { requireChannel, findChannel } from '@/features/messaging/channel-service';
import type { VariableMapping } from '@/features/messaging/template-render';
import {
  ACTION_PRECONDITIONS,
  transitionRefusalMessage,
  type CampaignAction,
} from '@/features/campaigns/campaign-state';
import {
  AUDIENCE_CHUNK_SIZE,
  fetchAudienceChunk,
} from '@/features/campaigns/audience-service';
import {
  accumulate,
  buildEligibilityContext,
  emptyBreakdown,
  evaluateCampaignRecipientEligibility,
  type EvaluationBreakdown,
} from '@/features/campaigns/eligibility';
import { audienceFiltersSchema, type AudienceFilters } from '@/features/campaigns/schemas';
import { queueExecutionService } from '@/features/campaigns/execution-service';

/**
 * Operações sobre campanhas.
 *
 * Toda mudança de estado é um COMPARE-AND-SET atômico: `updateMany` com o
 * status esperado no `where`. Quem perde a corrida recebe `count === 0` e sabe
 * que não venceu — em vez de sobrescrever a decisão de outro processo.
 *
 * Nenhuma função deste módulo chama a Meta. O envio real entra na Sprint 5,
 * por trás de `CampaignExecutionService`.
 */

export async function getCampaignOrThrow(
  workspaceId: string,
  campaignId: string,
): Promise<Campaign> {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) throw AppError.notFound('Campanha não encontrada.');
  return campaign;
}

/**
 * Transição atômica.
 *
 * Devolve a campanha atualizada, ou lança CONFLICT explicando por quê. Nunca
 * lê-e-depois-escreve: a condição vai dentro do próprio UPDATE.
 */
export async function transition(
  workspaceId: string,
  campaignId: string,
  action: CampaignAction,
  to: CampaignStatus,
  extraData: Prisma.CampaignUpdateManyMutationInput = {},
): Promise<Campaign> {
  const allowedFrom = ACTION_PRECONDITIONS[action] as readonly CampaignStatus[];

  const result = await prisma.campaign.updateMany({
    where: { id: campaignId, workspaceId, status: { in: [...allowedFrom] } },
    data: { status: to, ...extraData },
  });

  if (result.count === 0) {
    // Ou a campanha não é deste workspace, ou o estado mudou embaixo de nós.
    const current = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      select: { status: true },
    });
    if (!current) throw AppError.notFound('Campanha não encontrada.');
    throw AppError.conflict(transitionRefusalMessage(current.status, to), {
      currentStatus: current.status,
    });
  }

  return prisma.campaign.findFirstOrThrow({ where: { id: campaignId, workspaceId } });
}

export interface CreateCampaignData {
  workspaceId: string;
  actorUserId: string;
  name: string;
  description: string | null;
  templateId?: string | undefined;
  audienceFilters: AudienceFilters;
  variableMap: VariableMapping;
  variablePolicy?: Campaign['variablePolicy'];
  variableFallbacks?: Record<string, string>;
}

export async function createCampaign(input: CreateCampaignData): Promise<Campaign> {
  const channel = await findChannel(input.workspaceId);
  const templateId = await resolveTemplateId(input.workspaceId, input.templateId);

  return prisma.campaign.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      channel: ChannelKind.WHATSAPP,
      channelId: channel?.id ?? null,
      templateId,
      audienceFilters: input.audienceFilters as unknown as Prisma.InputJsonValue,
      variableMap: input.variableMap as unknown as Prisma.InputJsonValue,
      ...(input.variablePolicy ? { variablePolicy: input.variablePolicy } : {}),
      variableFallbacks: (input.variableFallbacks ?? {}) as unknown as Prisma.InputJsonValue,
      createdById: input.actorUserId,
      status: CampaignStatus.DRAFT,
    },
  });
}

/** Um template só é aceito se pertencer ao workspace — id do browser não basta. */
async function resolveTemplateId(
  workspaceId: string,
  templateId: string | undefined,
): Promise<string | null> {
  if (!templateId) return null;

  const template = await prisma.messageTemplate.findFirst({
    where: { id: templateId, workspaceId },
    select: { id: true },
  });
  if (!template) throw AppError.notFound('Template não encontrado neste workspace.');
  return template.id;
}

export async function updateCampaign(
  workspaceId: string,
  campaignId: string,
  input: Omit<CreateCampaignData, 'workspaceId' | 'actorUserId'>,
): Promise<Campaign> {
  const campaign = await getCampaignOrThrow(workspaceId, campaignId);

  // Editar uma campanha em execução mudaria a audiência debaixo dos pés de
  // quem já está recebendo.
  if (!([CampaignStatus.DRAFT, CampaignStatus.READY, CampaignStatus.FAILED] as CampaignStatus[]).includes(campaign.status)) {
    throw AppError.conflict('Só é possível editar campanhas em rascunho, prontas ou com falha.');
  }

  const templateId = await resolveTemplateId(workspaceId, input.templateId);

  const result = await prisma.campaign.updateMany({
    where: {
      id: campaignId,
      workspaceId,
      status: { in: [CampaignStatus.DRAFT, CampaignStatus.READY, CampaignStatus.FAILED] },
    },
    data: {
      name: input.name,
      description: input.description,
      templateId,
      audienceFilters: input.audienceFilters as unknown as Prisma.InputJsonValue,
      variableMap: input.variableMap as unknown as Prisma.InputJsonValue,
      ...(input.variablePolicy ? { variablePolicy: input.variablePolicy } : {}),
      variableFallbacks: (input.variableFallbacks ?? {}) as unknown as Prisma.InputJsonValue,
    },
  });

  if (result.count === 0) {
    throw AppError.conflict('A campanha mudou de estado enquanto era editada.');
  }

  return prisma.campaign.findFirstOrThrow({ where: { id: campaignId, workspaceId } });
}

// ---------------------------------------------------------------------------
// Preparação
// ---------------------------------------------------------------------------

export interface PrepareReport {
  breakdown: EvaluationBreakdown;
  /** Quantos destinatários foram criados agora (0 numa repreparação idêntica). */
  created: number;
  chunks: number;
  durationMs: number;
  dryRun: boolean;
}

/**
 * Materializa a audiência em `CampaignRecipient`.
 *
 * A audiência é CONGELADA aqui: a campanha passa a saber exatamente quem estava
 * dentro no momento da preparação, em vez de depender de uma consulta dinâmica
 * que muda enquanto a campanha roda.
 *
 * A entrada em PREPARING é um compare-and-set. Dez chamadas simultâneas: uma
 * entra, nove recebem CONFLICT. E mesmo que duas entrassem, a unique
 * (campaignId, contactId) mais o `createMany({skipDuplicates})` impedem
 * destinatário repetido.
 */
export async function prepareCampaign(input: {
  workspaceId: string;
  campaignId: string;
  actorUserId: string;
  /** Em ensaio, nada é gravado e ZERO chamadas externas acontecem. */
  dryRun?: boolean;
}): Promise<PrepareReport> {
  const startedAt = Date.now();
  const dryRun = input.dryRun ?? false;

  const campaign = dryRun
    ? await getCampaignOrThrow(input.workspaceId, input.campaignId)
    : await transition(input.workspaceId, input.campaignId, 'prepare', CampaignStatus.PREPARING);

  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: input.workspaceId },
      select: { defaultPhoneRegion: true },
    });

    const [channel, template] = await Promise.all([
      campaign.channelId
        ? prisma.messagingChannel.findFirst({
            where: { id: campaign.channelId, workspaceId: input.workspaceId },
          })
        : findChannel(input.workspaceId),
      campaign.templateId
        ? prisma.messageTemplate.findFirst({
            where: { id: campaign.templateId, workspaceId: input.workspaceId },
          })
        : null,
    ]);

    const context = buildEligibilityContext({
      channel,
      template,
      mapping: campaign.variableMap as unknown as VariableMapping,
      variablePolicy: campaign.variablePolicy,
      variableFallbacks: campaign.variableFallbacks as unknown as Record<string, string>,
    });

    const filters = audienceFiltersSchema.parse(campaign.audienceFilters ?? {});
    const breakdown = emptyBreakdown();

    let cursor: string | null = null;
    let created = 0;
    let chunks = 0;

    // Percorre por cursor: a base nunca é carregada inteira na memória.
    for (;;) {
      const chunk = await fetchAudienceChunk(
        input.workspaceId,
        filters,
        workspace.defaultPhoneRegion,
        cursor,
        AUDIENCE_CHUNK_SIZE,
      );
      if (chunk.contacts.length === 0) break;

      chunks += 1;
      const rows: Prisma.CampaignRecipientCreateManyInput[] = [];

      for (const contact of chunk.contacts) {
        const evaluation = evaluateCampaignRecipientEligibility(contact, context);
        accumulate(breakdown, evaluation);

        if (dryRun) continue;

        rows.push({
          workspaceId: input.workspaceId,
          campaignId: campaign.id,
          contactId: contact.id,
          status: evaluation.status,
          eligibility: evaluation.eligible
            ? RecipientEligibility.ELIGIBLE
            : RecipientEligibility.BLOCKED,
          eligibilityReasons: evaluation.reasons,
          // Chave determinística: repreparar não gera destinatário novo.
          idempotencyKey: `${campaign.id}:${contact.id}:1`,
          variables: (evaluation.resolved ?? {}) as unknown as Prisma.InputJsonValue,
          renderedPreview: evaluation.preview,
        });
      }

      if (rows.length > 0) {
        // skipDuplicates = ON CONFLICT DO NOTHING: uma preparação concorrente
        // perde silenciosamente em vez de estourar a unique.
        const inserted = await prisma.campaignRecipient.createMany({
          data: rows,
          skipDuplicates: true,
        });
        created += inserted.count;
      }

      cursor = chunk.nextCursor;
      if (!cursor) break;
    }

    if (!dryRun) {
      await prisma.campaign.updateMany({
        where: { id: campaign.id, workspaceId: input.workspaceId, status: CampaignStatus.PREPARING },
        data: {
          status: CampaignStatus.READY,
          preparedAt: new Date(),
          totalRecipients: breakdown.total,
          eligibleRecipients: breakdown.eligible,
          suppressedRecipients: breakdown.suppressed,
          invalidRecipients: breakdown.invalid,
          failureReason: null,
        },
      });
    } else {
      await prisma.campaign.updateMany({
        where: { id: campaign.id, workspaceId: input.workspaceId },
        data: { lastDryRunAt: new Date() },
      });
    }

    const report: PrepareReport = {
      breakdown,
      created,
      chunks,
      durationMs: Date.now() - startedAt,
      dryRun,
    };

    logger.info('campaign.prepared', {
      workspaceId: input.workspaceId,
      campaignId: campaign.id,
      dryRun,
      total: breakdown.total,
      eligible: breakdown.eligible,
      chunks,
      durationMs: report.durationMs,
    });

    return report;
  } catch (error) {
    if (!dryRun) {
      // A campanha não pode ficar presa em PREPARING para sempre.
      await prisma.campaign.updateMany({
        where: { id: campaign.id, workspaceId: input.workspaceId, status: CampaignStatus.PREPARING },
        data: {
          status: CampaignStatus.FAILED,
          failureReason:
            error instanceof AppError ? error.message : 'Falha inesperada na preparação.',
        },
      });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

export async function scheduleCampaign(input: {
  workspaceId: string;
  campaignId: string;
  scheduledAt: Date;
  timezone: string;
}): Promise<Campaign> {
  if (input.scheduledAt.getTime() <= Date.now()) {
    throw AppError.validation('O agendamento precisa ser no futuro.', {
      scheduledAt: ['O agendamento precisa ser no futuro.'],
    });
  }

  await assertHasEligibleRecipients(input.workspaceId, input.campaignId);

  return transition(input.workspaceId, input.campaignId, 'schedule', CampaignStatus.SCHEDULED, {
    // Sempre gravado em UTC; `timezone` é só para exibir de volta.
    scheduledAt: input.scheduledAt,
    timezone: input.timezone,
  });
}

/**
 * Coloca a campanha em execução e ENFILEIRA os destinatários.
 *
 * Nenhuma mensagem sai daqui: esta função cria um job por destinatário elegível
 * e retorna. Quem envia é o worker, que relê tudo e reavalia a elegibilidade
 * antes de cada chamada — é o que impede um handler HTTP de disparar milhares
 * de requisições dentro de uma requisição.
 */
export async function startCampaign(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<{ campaign: Campaign; queued: number }> {
  await assertHasEligibleRecipients(input.workspaceId, input.campaignId);
  await requireChannel(input.workspaceId);

  const campaign = await transition(
    input.workspaceId,
    input.campaignId,
    'start',
    CampaignStatus.RUNNING,
    { startedAt: new Date(), pausedAt: null },
  );

  const enqueued = await queueExecutionService.enqueueCampaign(
    input.workspaceId,
    input.campaignId,
  );

  return { campaign, queued: enqueued.queued };
}

/**
 * Pausa e retira da fila os jobs ainda não executados.
 *
 * O worker também checa o status antes de cada envio, então isto é defesa em
 * profundidade — mas evita que a fila fique carregando trabalho morto.
 */
export async function pauseCampaign(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<{ campaign: Campaign; cancelledJobs: number }> {
  const campaign = await transition(
    input.workspaceId,
    input.campaignId,
    'pause',
    CampaignStatus.PAUSED,
    { pausedAt: new Date() },
  );

  const cancelledJobs = await queueExecutionService.pauseCampaignJobs(
    input.workspaceId,
    input.campaignId,
  );

  return { campaign, cancelledJobs };
}

/** Retoma e reenfileira quem ficou para trás. */
export async function resumeCampaign(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<{ campaign: Campaign; queued: number }> {
  const campaign = await transition(
    input.workspaceId,
    input.campaignId,
    'resume',
    CampaignStatus.RUNNING,
    { pausedAt: null },
  );

  const enqueued = await queueExecutionService.enqueueCampaign(
    input.workspaceId,
    input.campaignId,
  );

  return { campaign, queued: enqueued.queued };
}

/**
 * Cancela a campanha e impede que destinatários pendentes sejam processados.
 *
 * O histórico NÃO é apagado: quem já recebeu continua registrado como enviado.
 * Só quem ainda não saiu vira CANCELLED.
 */
export async function cancelCampaign(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<{ campaign: Campaign; cancelledRecipients: number }> {
  const campaign = await transition(
    input.workspaceId,
    input.campaignId,
    'cancel',
    CampaignStatus.CANCELLED,
    { cancelledAt: new Date() },
  );

  // Tira da fila antes de mexer nos destinatários: um worker que já pegou o
  // job ainda vai ver a campanha cancelada e pular.
  await queueExecutionService.cancelCampaignJobs(input.workspaceId, input.campaignId);

  const result = await prisma.campaignRecipient.updateMany({
    where: {
      campaignId: campaign.id,
      workspaceId: input.workspaceId,
      // Só o que ainda não foi enviado. Nada que já saiu é reescrito.
      status: {
        in: [
          RecipientStatus.PENDING,
          RecipientStatus.ELIGIBLE,
          RecipientStatus.QUEUED,
        ],
      },
    },
    data: { status: RecipientStatus.CANCELLED, cancelledAt: new Date() },
  });

  return { campaign, cancelledRecipients: result.count };
}

async function assertHasEligibleRecipients(
  workspaceId: string,
  campaignId: string,
): Promise<void> {
  const eligible = await prisma.campaignRecipient.count({
    where: { campaignId, workspaceId, eligibility: RecipientEligibility.ELIGIBLE },
  });

  if (eligible === 0) {
    throw AppError.conflict(
      'Nenhum destinatário elegível. Prepare a campanha e revise os bloqueios antes de continuar.',
    );
  }
}
