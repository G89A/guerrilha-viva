import 'server-only';
import {
  ChannelStatus,
  ConsentChannel,
  ConsentStatus,
  ContactStatus,
  JobStatus,
  TemplateStatus,
} from '@prisma/client';
import { shouldRunInProcessWorker } from '@/lib/config/worker';
import { prisma } from '@/lib/db/client';
import { findChannel } from '@/features/messaging/channel-service';
import { describeCredentials } from '@/features/messaging/credentials';
import { getSendingPolicy } from '@/features/protection/policy-service';
import { numberHealth } from '@/features/protection/health-service';

/**
 * Prontidão para disparo em massa.
 *
 * Existe porque "está funcionando?" é a pergunta que o operador realmente faz, e
 * a resposta honesta tem várias partes: credencial, template aprovado, público
 * com consentimento, webhook chegando e worker rodando. Faltando qualquer uma,
 * o disparo não sai — e é melhor dizer QUAL falta do que deixar a pessoa
 * descobrir com uma campanha parada.
 *
 * Cada verificação lê o estado real. Nada aqui presume sucesso, e nenhuma
 * verificação fica verde por configuração existir: template aprovado é template
 * que a Meta aprovou, worker rodando é job concluído de verdade.
 */

export type CheckState = 'OK' | 'FALTA' | 'ATENCAO';

export interface ReadinessCheck {
  id: string;
  label: string;
  state: CheckState;
  /** O que está acontecendo agora, em uma frase. */
  detail: string;
  /** O que fazer quando não está OK. */
  action?: string;
  href?: string;
}

export interface ReadinessReport {
  /** `true` só quando nada impede um disparo real. */
  readyToSend: boolean;
  checks: ReadinessCheck[];
}

/** Um job pendente parado além disso é sinal de worker desligado. */
const STALE_JOB_MS = 5 * 60 * 1000;

/**
 * Idade a partir da qual uma verificação de conexão deixa de valer como prova.
 *
 * `status: CONNECTED` é o resultado do ÚLTIMO teste, não do estado de agora: um
 * token revogado ontem deixa a marca verde para sempre. Depois deste prazo a
 * verificação vira atenção, com a data — em vez de afirmar algo que ninguém
 * confirmou recentemente.
 */
const CONNECTION_PROOF_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function assessSendReadiness(
  workspaceId: string,
  now: Date = new Date(),
): Promise<ReadinessReport> {
  const channel = await findChannel(workspaceId);

  const [approvedTemplates, eligibleContacts, webhookEvents, staleJobs, recentDone, deadJobs] =
    await Promise.all([
      prisma.messageTemplate.count({ where: { workspaceId, status: TemplateStatus.APPROVED } }),
      prisma.contact.count({
        where: {
          workspaceId,
          status: ContactStatus.ACTIVE,
          suppressions: { none: {} },
          consents: {
            some: { channel: ConsentChannel.WHATSAPP, status: ConsentStatus.GRANTED },
          },
        },
      }),
      prisma.webhookEvent.count({ where: { workspaceId } }),
      prisma.job.count({
        where: {
          workspaceId,
          status: { in: [JobStatus.PENDING, JobStatus.FAILED] },
          runAt: { lt: new Date(now.getTime() - STALE_JOB_MS) },
        },
      }),
      prisma.job.count({
        where: {
          workspaceId,
          status: JobStatus.DONE,
          completedAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.job.count({ where: { workspaceId, status: JobStatus.DEAD } }),
    ]);

  const policy = await getSendingPolicy(workspaceId);
  const health = await numberHealth(workspaceId, policy, now);

  const credentials = channel ? describeCredentials(channel) : null;
  const channelComplete = Boolean(
    channel?.wabaId && channel?.phoneNumberId && credentials?.present,
  );

  const checks: ReadinessCheck[] = [];

  checks.push({
    id: 'channel',
    label: 'Canal WhatsApp configurado',
    state: channelComplete ? 'OK' : 'FALTA',
    detail: !channel
      ? 'Nenhum canal cadastrado neste workspace.'
      : channelComplete
        ? 'WABA ID, número e token presentes.'
        : `Faltando: ${[
            channel.wabaId ? null : 'WABA ID',
            channel.phoneNumberId ? null : 'Phone Number ID',
            credentials?.present ? null : 'token de acesso',
          ]
            .filter(Boolean)
            .join(', ')}.`,
    action: 'Cadastre WABA ID, Phone Number ID e o token permanente da Meta.',
    href: '/settings/integrations',
  });

  const connected = channel?.status === ChannelStatus.CONNECTED;
  const verifiedAt = channel?.lastVerifiedAt ?? channel?.connectedAt ?? null;
  const proofStale =
    connected && (!verifiedAt || now.getTime() - verifiedAt.getTime() > CONNECTION_PROOF_TTL_MS);

  checks.push({
    id: 'connection',
    label: 'Conexão testada com a Meta',
    state: !channelComplete ? 'ATENCAO' : !connected ? 'FALTA' : proofStale ? 'ATENCAO' : 'OK',
    detail: !channelComplete
      ? 'Depende do canal estar configurado.'
      : !connected
        ? `Estado atual: ${channel?.status ?? 'desconhecido'}. Nenhum teste bem-sucedido.`
        : proofStale
          ? verifiedAt
            ? `Última verificação em ${verifiedAt.toISOString().slice(0, 10)} — antiga demais para valer como prova. Um token revogado desde então continuaria marcado como conectado.`
            : 'Marcado como conectado, mas sem data de verificação registrada.'
          : `Verificado em ${verifiedAt?.toISOString().slice(0, 10)}.`,
    action: 'Use "Testar conexão" na tela de integrações.',
    href: '/settings/integrations',
  });

  checks.push({
    id: 'template',
    label: 'Template aprovado pela Meta',
    state: approvedTemplates > 0 ? 'OK' : 'FALTA',
    detail:
      approvedTemplates > 0
        ? `${approvedTemplates} template(s) aprovado(s).`
        : 'Nenhum template APROVADO. Campanha exige template aprovado — texto livre só vale na Inbox, dentro da janela de 24 h.',
    action: 'Crie e submeta o template no Gerenciador da Meta, depois sincronize aqui.',
    href: '/templates',
  });

  checks.push({
    id: 'audience',
    label: 'Contatos com consentimento',
    state: eligibleContacts > 0 ? 'OK' : 'FALTA',
    detail:
      eligibleContacts > 0
        ? `${eligibleContacts} contato(s) ativo(s), com consentimento concedido e fora da supressão.`
        : 'Nenhum contato elegível. Consentimento UNKNOWN nunca vira GRANTED sozinho.',
    action: 'Importe contatos e registre o consentimento com origem e data.',
    href: '/contacts',
  });

  const webhookEnv = Boolean(process.env.META_APP_SECRET && process.env.META_WEBHOOK_VERIFY_TOKEN);
  checks.push({
    id: 'webhook',
    label: 'Webhook recebendo eventos',
    state: webhookEvents > 0 ? 'OK' : webhookEnv ? 'ATENCAO' : 'FALTA',
    detail: !webhookEnv
      ? 'META_APP_SECRET e/ou META_WEBHOOK_VERIFY_TOKEN ausentes: a rota recusa toda entrega em vez de aceitar sem verificar.'
      : webhookEvents > 0
        ? `${webhookEvents} evento(s) recebido(s).`
        : 'Variáveis presentes, mas nenhum evento chegou ainda.',
    action: webhookEnv
      ? 'Aponte o webhook da Meta para /api/webhooks/meta/whatsapp. Sem isso o envio até acontece, mas status de entrega e respostas nunca chegam.'
      : 'Defina META_APP_SECRET e META_WEBHOOK_VERIFY_TOKEN nas variáveis de ambiente da hospedagem. As duas pertencem ao app da Meta, não ao workspace — por isso não estão na tela de Integrações.',
    href: '/settings/integrations',
  });

  // Quatro formas de a fila andar: worker dentro do processo, processo separado,
  // cron chamando a rota interna, ou uma pessoa clicando em "Processar agora".
  // A orientação tem de corresponder à que este deploy usa — mandar rodar um
  // comando no terminal para quem instalou clicando é conselho impossível.
  const inProcessWorker = shouldRunInProcessWorker();
  const cronSecret = process.env.WORKER_TOKEN ?? process.env.CRON_SECRET;
  const workerConfigured = inProcessWorker || Boolean(cronSecret && cronSecret.length >= 16);
  const workerLooksStopped = staleJobs > 0;
  checks.push({
    id: 'worker',
    label: 'Worker processando a fila',
    state: workerLooksStopped ? 'FALTA' : recentDone > 0 ? 'OK' : 'ATENCAO',
    detail: workerLooksStopped
      ? inProcessWorker
        ? `${staleJobs} job(s) parado(s) há mais de 5 minutos. O worker roda dentro da aplicação, então isto costuma significar que o serviço esteve fora do ar.`
        : `${staleJobs} job(s) parado(s) há mais de 5 minutos: o worker parece desligado.`
      : recentDone > 0
        ? `${recentDone} job(s) concluído(s) nas últimas 24 h.`
        : workerConfigured
          ? 'Nada na fila e nada processado ainda — sem sinal de atividade, mas também sem trabalho parado.'
          : 'Sem worker de fundo e sem segredo de cron: a fila anda pelo botão "Processar agora", dentro da campanha.',
    action: inProcessWorker
      ? 'O worker já roda junto com a aplicação (RUN_WORKER_IN_PROCESS). Ele só trabalha enquanto o serviço está no ar: se a hospedagem hibernar por falta de acesso, a fila para junto e volta a andar no próximo acesso.'
      : workerConfigured
        ? 'Configure um cron chamando /api/internal/worker/tick com o segredo, ou rode `npm run worker` em processo contínuo. Enquanto isso, o botão "Processar agora" dentro da campanha faz a fila andar.'
        : 'Abra a campanha e use "Processar agora": a fila anda enquanto a aba estiver aberta. Para envio contínuo, ligue RUN_WORKER_IN_PROCESS numa hospedagem que não hiberne, ou configure um cron com WORKER_TOKEN.',
  });

  // A qualidade do número entra na prontidão porque é o único item que pode
  // BLOQUEAR o envio sem nada estar mal configurado.
  if (health) {
    checks.push({
      id: 'quality',
      label: 'Qualidade do número na Meta',
      state: health.blocksSending ? 'FALTA' : health.stale ? 'ATENCAO' : 'OK',
      detail: health.blocksSending
        ? `Qualidade ${health.quality} e a política manda parar. Nenhuma campanha sai assim.`
        : health.checkedAt === null
          ? 'Nunca consultada. A Meta rebaixa a qualidade antes de restringir o número.'
          : health.stale
            ? 'Leitura antiga demais para descrever o estado de agora.'
            : `Qualidade ${health.quality}${health.tier ? `, limite ${health.tier}` : ''}.`,
      action: 'Consulte a qualidade em Configurações → Proteção do número.',
      href: '/settings/protection',
    });
  }

  if (deadJobs > 0) {
    checks.push({
      id: 'dead',
      label: 'Trabalho desistido na fila',
      state: 'ATENCAO',
      detail: `${deadJobs} job(s) em carta morta — esgotaram as tentativas e NÃO foram entregues.`,
      action: 'Veja o motivo na campanha antes de tentar de novo.',
      href: '/campaigns',
    });
  }

  // Só estes travam um disparo real. Webhook faltando degrada (não há status de
  // entrega), mas não impede a mensagem de sair.
  //
  // ATENCAO não bloqueia: é aviso, não impedimento. FALTA bloqueia.
  const blocking = ['channel', 'connection', 'template', 'audience', 'worker', 'quality'];
  const readyToSend = checks
    .filter((check) => blocking.includes(check.id))
    .every((check) => check.state !== 'FALTA');

  return { readyToSend, checks };
}
