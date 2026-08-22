import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ChannelStatus,
  ConsentChannel,
  ConsentSource,
  ConsentStatus,
  JobStatus,
  JobType,
  TemplateStatus,
} from '@prisma/client';
import { assessSendReadiness } from '@/features/readiness/service';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedChannel, seedEligibleContact, seedTemplate, seedTenant } from '../helpers/factories';

function checkOf(report: Awaited<ReturnType<typeof assessSendReadiness>>, id: string) {
  const check = report.checks.find((entry) => entry.id === id);
  if (!check) throw new Error(`verificação ${id} não existe`);
  return check;
}

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('prontidão para disparo', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('workspace vazio NÃO está pronto e diz o que falta', async () => {
    const tenant = await seedTenant('rdy1');
    const report = await assessSendReadiness(tenant.workspaceId);

    expect(report.readyToSend).toBe(false);
    expect(checkOf(report, 'channel').state).toBe('FALTA');
    expect(checkOf(report, 'template').state).toBe('FALTA');
    expect(checkOf(report, 'audience').state).toBe('FALTA');
  });

  it('canal sem token não conta como configurado', async () => {
    const tenant = await seedTenant('rdy2');
    const channel = await seedChannel(tenant.workspaceId);
    await testPrisma().messagingChannel.update({
      where: { id: channel.id },
      data: { wabaId: null },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'channel').state).toBe('FALTA');
    expect(checkOf(report, 'channel').detail).toContain('WABA ID');
  });

  it('template em revisão NÃO conta como aprovado', async () => {
    const tenant = await seedTenant('rdy3');
    const channel = await seedChannel(tenant.workspaceId);
    const template = await seedTemplate(tenant.workspaceId, channel.id);
    await testPrisma().messageTemplate.update({
      where: { id: template.id },
      data: { status: TemplateStatus.PENDING },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'template').state).toBe('FALTA');
  });

  it('contato sem consentimento NÃO conta como público', async () => {
    const tenant = await seedTenant('rdy4');
    await testPrisma().contact.create({
      data: { workspaceId: tenant.workspaceId, phoneE164: '+5585900000001' },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'audience').state).toBe('FALTA');
  });

  it('contato suprimido NÃO conta como público, mesmo com consentimento', async () => {
    const tenant = await seedTenant('rdy5');
    const contactId = await seedEligibleContact(tenant.workspaceId, '+5585900000002');
    await testPrisma().suppressionEntry.create({
      data: {
        workspaceId: tenant.workspaceId,
        contactId,
        phoneE164: '+5585900000002',
        reason: 'MANUAL',
      },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'audience').state).toBe('FALTA');
  });

  it('consentimento REVOKED não vira público', async () => {
    const tenant = await seedTenant('rdy6');
    const contact = await testPrisma().contact.create({
      data: { workspaceId: tenant.workspaceId, phoneE164: '+5585900000003' },
    });
    await testPrisma().contactConsent.create({
      data: {
        workspaceId: tenant.workspaceId,
        contactId: contact.id,
        channel: ConsentChannel.WHATSAPP,
        status: ConsentStatus.REVOKED,
        source: ConsentSource.MANUAL,
      },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'audience').state).toBe('FALTA');
  });

  it('conexão verificada há muito tempo deixa de valer como prova', async () => {
    const tenant = await seedTenant('rdy7b');
    const channel = await seedChannel(tenant.workspaceId);
    await testPrisma().messagingChannel.update({
      where: { id: channel.id },
      data: {
        status: ChannelStatus.CONNECTED,
        lastVerifiedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        connectedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    const connection = checkOf(report, 'connection');
    expect(connection.state).toBe('ATENCAO');
    expect(connection.detail).toContain('antiga demais');
  });

  it('conexão sem data de verificação não afirma que foi testada', async () => {
    const tenant = await seedTenant('rdy7c');
    const channel = await seedChannel(tenant.workspaceId);
    await testPrisma().messagingChannel.update({
      where: { id: channel.id },
      data: { status: ChannelStatus.CONNECTED, lastVerifiedAt: null, connectedAt: null },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'connection').state).toBe('ATENCAO');
  });

  it('canal completo mas nunca testado fica FALTA na conexão', async () => {
    const tenant = await seedTenant('rdy7');
    const channel = await seedChannel(tenant.workspaceId);
    await testPrisma().messagingChannel.update({
      where: { id: channel.id },
      data: { status: ChannelStatus.DISCONNECTED },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'connection').state).toBe('FALTA');
    expect(report.readyToSend).toBe(false);
  });

  it('job parado há mais de 5 minutos denuncia worker desligado', async () => {
    const tenant = await seedTenant('rdy8');
    await testPrisma().job.create({
      data: {
        workspaceId: tenant.workspaceId,
        type: JobType.CAMPAIGN_SEND,
        payload: {},
        idempotencyKey: 'rdy8:parado',
        runAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'worker').state).toBe('FALTA');
    expect(checkOf(report, 'worker').detail).toContain('desligado');
  });

  it('sem worker dentro da aplicação, a orientação é o comando de terminal', async () => {
    const tenant = await seedTenant('rdy8b');
    delete process.env.RUN_WORKER_IN_PROCESS;

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'worker').action).toContain('npm run worker');
  });

  it('com worker dentro da aplicação, NÃO manda rodar comando nenhum', async () => {
    const tenant = await seedTenant('rdy8c');
    process.env.RUN_WORKER_IN_PROCESS = 'true';

    const report = await assessSendReadiness(tenant.workspaceId);
    const worker = checkOf(report, 'worker');
    // Quem instalou por blueprint não tem terminal: mandar rodar um comando é
    // orientação impossível de seguir.
    expect(worker.action).not.toContain('npm run worker');
    expect(worker.action).toContain('junto com a aplicação');
  });

  it('worker dentro da aplicação explica job parado como serviço fora do ar', async () => {
    const tenant = await seedTenant('rdy8d');
    process.env.RUN_WORKER_IN_PROCESS = 'true';
    await testPrisma().job.create({
      data: {
        workspaceId: tenant.workspaceId,
        type: JobType.CAMPAIGN_SEND,
        payload: {},
        idempotencyKey: 'rdy8d:parado',
        runAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'worker').state).toBe('FALTA');
    expect(checkOf(report, 'worker').detail).toContain('fora do ar');
  });

  it('job concluído recentemente mostra worker vivo', async () => {
    const tenant = await seedTenant('rdy9');
    await testPrisma().job.create({
      data: {
        workspaceId: tenant.workspaceId,
        type: JobType.CAMPAIGN_SEND,
        payload: {},
        idempotencyKey: 'rdy9:feito',
        status: JobStatus.DONE,
        completedAt: new Date(),
      },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'worker').state).toBe('OK');
  });

  it('carta morta aparece como atenção, com a contagem', async () => {
    const tenant = await seedTenant('rdy10');
    await testPrisma().job.create({
      data: {
        workspaceId: tenant.workspaceId,
        type: JobType.CAMPAIGN_SEND,
        payload: {},
        idempotencyKey: 'rdy10:morto',
        status: JobStatus.DEAD,
      },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'dead').state).toBe('ATENCAO');
    expect(checkOf(report, 'dead').detail).toContain('1');
  });

  it('sem variáveis de webhook, a verificação denuncia a recusa da rota', async () => {
    const tenant = await seedTenant('rdy11');
    delete process.env.META_APP_SECRET;
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'webhook').state).toBe('FALTA');
    expect(checkOf(report, 'webhook').detail).toContain('META_APP_SECRET');
  });

  it('webhook faltando NÃO bloqueia o disparo — degrada, não impede', async () => {
    const tenant = await seedTenant('rdy12');
    const channel = await seedChannel(tenant.workspaceId);
    await testPrisma().messagingChannel.update({
      where: { id: channel.id },
      data: { status: ChannelStatus.CONNECTED, lastVerifiedAt: new Date() },
    });
    await seedTemplate(tenant.workspaceId, channel.id);
    await seedEligibleContact(tenant.workspaceId, '+5585900000004');
    await testPrisma().job.create({
      data: {
        workspaceId: tenant.workspaceId,
        type: JobType.CAMPAIGN_SEND,
        payload: {},
        idempotencyKey: 'rdy12:feito',
        status: JobStatus.DONE,
        completedAt: new Date(),
      },
    });
    delete process.env.META_APP_SECRET;

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(checkOf(report, 'webhook').state).toBe('FALTA');
    expect(report.readyToSend).toBe(true);
  });

  it('workspace completo fica pronto', async () => {
    const tenant = await seedTenant('rdy13');
    const channel = await seedChannel(tenant.workspaceId);
    await testPrisma().messagingChannel.update({
      where: { id: channel.id },
      data: { status: ChannelStatus.CONNECTED, lastVerifiedAt: new Date() },
    });
    await seedTemplate(tenant.workspaceId, channel.id);
    await seedEligibleContact(tenant.workspaceId, '+5585900000005');
    await testPrisma().job.create({
      data: {
        workspaceId: tenant.workspaceId,
        type: JobType.CAMPAIGN_SEND,
        payload: {},
        idempotencyKey: 'rdy13:feito',
        status: JobStatus.DONE,
        completedAt: new Date(),
      },
    });

    const report = await assessSendReadiness(tenant.workspaceId);
    expect(report.readyToSend).toBe(true);
  });

  it('a prontidão de um workspace ignora o outro por completo', async () => {
    const pronto = await seedTenant('rdy14a');
    const channel = await seedChannel(pronto.workspaceId);
    await testPrisma().messagingChannel.update({
      where: { id: channel.id },
      data: { status: ChannelStatus.CONNECTED, lastVerifiedAt: new Date() },
    });
    await seedTemplate(pronto.workspaceId, channel.id);
    await seedEligibleContact(pronto.workspaceId, '+5585900000006');

    const vazio = await seedTenant('rdy14b');
    const report = await assessSendReadiness(vazio.workspaceId);

    expect(report.readyToSend).toBe(false);
    expect(checkOf(report, 'channel').state).toBe('FALTA');
    expect(checkOf(report, 'template').state).toBe('FALTA');
    expect(checkOf(report, 'audience').state).toBe('FALTA');
  });
});
