import 'server-only';
import { AppError } from '@/lib/errors/app-error';

/**
 * Contrato da execução de campanha — a ponte para a Sprint 5.
 *
 * Existe agora para que o resto do produto já dependa da interface certa: a
 * Sprint 4 marca a campanha como RUNNING e chama `enqueueCampaign`, que hoje
 * recusa de forma explícita. Quando a fila chegar, só esta implementação muda.
 *
 * O que NÃO está aqui, e é deliberado: laço de envio, fila distribuída,
 * workers, retry com backoff, gestão de vazão do provider, dead-letter queue.
 * Tudo isso é Sprint 5.
 */

export interface EnqueueResult {
  campaignId: string;
  /** Quantos destinatários entrariam na fila. */
  queued: number;
}

export interface CampaignExecutionService {
  enqueueCampaign(campaignId: string): Promise<EnqueueResult>;
}

/**
 * Implementação atual: recusa com clareza em vez de fingir que enfileirou.
 *
 * Marcar uma campanha como RUNNING sem execução por trás é honesto — o estado
 * descreve a intenção do operador. Devolver "enfileirado com sucesso" sem fila
 * nenhuma não seria.
 */
export const pendingExecutionService: CampaignExecutionService = {
  async enqueueCampaign(): Promise<EnqueueResult> {
    throw AppError.notConfigured(
      'A execução de campanhas entra na Sprint 5. A campanha fica marcada como em ' +
        'execução, mas nenhuma mensagem é enfileirada ou enviada ainda.',
    );
  },
};

/** Sinaliza para a UI que o motor de execução ainda não existe. */
export const EXECUTION_AVAILABLE = false;
