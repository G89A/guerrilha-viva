import { beforeEach, describe, expect, it } from 'vitest';
import { ConsentChannel, ConsentStatus, ContactStatus, RecipientStatus } from '@prisma/client';
import {
  estimateAudience,
  fetchAudienceChunk,
} from '@/features/campaigns/audience-service';
import { prepareCampaign } from '@/features/campaigns/campaign-service';
import { resetDatabase, testPrisma } from '../helpers/db';
import {
  seedCampaign,
  seedChannel,
  seedContact,
  seedEligibleContact,
  seedTemplate,
  seedTenant,
} from '../helpers/factories';

async function withConsent(
  workspaceId: string,
  contactId: string,
  status: ConsentStatus,
): Promise<void> {
  await testPrisma().contactConsent.create({
    data: {
      workspaceId,
      contactId,
      channel: ConsentChannel.WHATSAPP,
      status,
      capturedAt: status === ConsentStatus.GRANTED ? new Date() : null,
    },
  });
}

describe('filtros de audiência', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('filtra por lista', async () => {
    const tenant = await seedTenant('aud-lista');
    const list = await testPrisma().contactList.create({
      data: { workspaceId: tenant.workspaceId, name: 'Dentistas' },
    });
    const dentro = await seedEligibleContact(tenant.workspaceId, '+5585900000001');
    await seedEligibleContact(tenant.workspaceId, '+5585900000002');
    await testPrisma().contactListMember.create({
      data: { workspaceId: tenant.workspaceId, listId: list.id, contactId: dentro },
    });

    const chunk = await fetchAudienceChunk(tenant.workspaceId, { listIds: [list.id] }, 'BR', null);
    expect(chunk.contacts.map((contact) => contact.id)).toEqual([dentro]);
  });

  it('filtra por tag', async () => {
    const tenant = await seedTenant('aud-tag');
    const tag = await testPrisma().tag.create({
      data: { workspaceId: tenant.workspaceId, name: 'Sem Site' },
    });
    const marcado = await seedEligibleContact(tenant.workspaceId, '+5585900000003');
    await seedEligibleContact(tenant.workspaceId, '+5585900000004');
    await testPrisma().contactTag.create({
      data: { workspaceId: tenant.workspaceId, tagId: tag.id, contactId: marcado },
    });

    const chunk = await fetchAudienceChunk(tenant.workspaceId, { tagIds: [tag.id] }, 'BR', null);
    expect(chunk.contacts.map((contact) => contact.id)).toEqual([marcado]);
  });

  it.each([
    ['cidade', 'cities', 'Fortaleza'],
    ['estado', 'states', 'CE'],
    ['segmento', 'segments', 'Saúde'],
    ['origem', 'sources', 'Feira'],
  ] as const)('filtra por %s', async (_label, key, value) => {
    const tenant = await seedTenant(`aud-${key}`);
    const field = { cities: 'city', states: 'state', segments: 'segment', sources: 'source' }[key];

    const dentro = await seedEligibleContact(tenant.workspaceId, '+5585900001001', {
      [field]: value,
    } as never);
    await seedEligibleContact(tenant.workspaceId, '+5585900001002', {
      [field]: 'Outro',
    } as never);

    const chunk = await fetchAudienceChunk(tenant.workspaceId, { [key]: [value] }, 'BR', null);
    expect(chunk.contacts.map((contact) => contact.id)).toEqual([dentro]);
  });

  it('filtra por consentimento concedido', async () => {
    const tenant = await seedTenant('aud-consent');
    const concedido = await seedEligibleContact(tenant.workspaceId, '+5585900002001');
    const revogado = await seedContact(tenant.workspaceId, '+5585900002002');
    await withConsent(tenant.workspaceId, revogado, ConsentStatus.REVOKED);
    await seedContact(tenant.workspaceId, '+5585900002003'); // sem registro algum

    const chunk = await fetchAudienceChunk(
      tenant.workspaceId,
      { consent: ConsentStatus.GRANTED },
      'BR',
      null,
    );
    expect(chunk.contacts.map((contact) => contact.id)).toEqual([concedido]);
  });

  it('consentimento desconhecido inclui quem nunca teve registro', async () => {
    const tenant = await seedTenant('aud-unknown');
    const semRegistro = await seedContact(tenant.workspaceId, '+5585900003001');
    await seedEligibleContact(tenant.workspaceId, '+5585900003002');

    const chunk = await fetchAudienceChunk(
      tenant.workspaceId,
      { consent: ConsentStatus.UNKNOWN },
      'BR',
      null,
    );
    expect(chunk.contacts.map((contact) => contact.id)).toEqual([semRegistro]);
  });

  it('exclui suprimidos por padrão', async () => {
    const tenant = await seedTenant('aud-supp');
    const livre = await seedEligibleContact(tenant.workspaceId, '+5585900004001');
    const suprimido = await seedEligibleContact(tenant.workspaceId, '+5585900004002');
    await testPrisma().suppressionEntry.create({
      data: {
        workspaceId: tenant.workspaceId,
        contactId: suprimido,
        phoneE164: '+5585900004002',
        reason: 'OPT_OUT',
      },
    });

    const padrao = await fetchAudienceChunk(tenant.workspaceId, {}, 'BR', null);
    expect(padrao.contacts.map((contact) => contact.id)).toEqual([livre]);

    // Incluir suprimidos é decisão explícita — e a elegibilidade ainda bloqueia.
    const explicito = await fetchAudienceChunk(
      tenant.workspaceId,
      { includeSuppressed: true },
      'BR',
      null,
    );
    expect(explicito.contacts).toHaveLength(2);
  });

  it('só traz contatos ativos por padrão', async () => {
    const tenant = await seedTenant('aud-ativo');
    const ativo = await seedEligibleContact(tenant.workspaceId, '+5585900005001');
    const arquivado = await seedEligibleContact(tenant.workspaceId, '+5585900005002');
    await testPrisma().contact.update({
      where: { id: arquivado },
      data: { status: ContactStatus.ARCHIVED, archivedAt: new Date() },
    });

    const chunk = await fetchAudienceChunk(tenant.workspaceId, {}, 'BR', null);
    expect(chunk.contacts.map((contact) => contact.id)).toEqual([ativo]);
  });

  it('combina filtros com E lógico', async () => {
    const tenant = await seedTenant('aud-combo');
    const list = await testPrisma().contactList.create({
      data: { workspaceId: tenant.workspaceId, name: 'Fortaleza' },
    });
    const tag = await testPrisma().tag.create({
      data: { workspaceId: tenant.workspaceId, name: 'Sem Site' },
    });

    // Só este casa com lista E tag E cidade E consentimento.
    const alvo = await seedEligibleContact(tenant.workspaceId, '+5585900006001', {
      city: 'Fortaleza',
    });
    const soLista = await seedEligibleContact(tenant.workspaceId, '+5585900006002', {
      city: 'Fortaleza',
    });
    const semConsent = await seedContact(tenant.workspaceId, '+5585900006003', {
      city: 'Fortaleza',
    });

    for (const contactId of [alvo, soLista, semConsent]) {
      await testPrisma().contactListMember.create({
        data: { workspaceId: tenant.workspaceId, listId: list.id, contactId },
      });
    }
    for (const contactId of [alvo, semConsent]) {
      await testPrisma().contactTag.create({
        data: { workspaceId: tenant.workspaceId, tagId: tag.id, contactId },
      });
    }

    const chunk = await fetchAudienceChunk(
      tenant.workspaceId,
      {
        listIds: [list.id],
        tagIds: [tag.id],
        cities: ['Fortaleza'],
        consent: ConsentStatus.GRANTED,
      },
      'BR',
      null,
    );
    expect(chunk.contacts.map((contact) => contact.id)).toEqual([alvo]);
  });

  it('nunca alcança contato de outro workspace', async () => {
    const alpha = await seedTenant('aud-a');
    const beta = await seedTenant('aud-b');
    await seedEligibleContact(alpha.workspaceId, '+5585900007001');
    await seedEligibleContact(beta.workspaceId, '+5585900007002');

    const chunk = await fetchAudienceChunk(alpha.workspaceId, {}, 'BR', null);
    expect(chunk.contacts).toHaveLength(1);
  });

  it('lista de outro workspace não traz ninguém', async () => {
    const alpha = await seedTenant('aud-c');
    const beta = await seedTenant('aud-d');
    const listaBeta = await testPrisma().contactList.create({
      data: { workspaceId: beta.workspaceId, name: 'De Beta' },
    });
    await seedEligibleContact(alpha.workspaceId, '+5585900008001');

    const chunk = await fetchAudienceChunk(
      alpha.workspaceId,
      { listIds: [listaBeta.id] },
      'BR',
      null,
    );
    expect(chunk.contacts).toHaveLength(0);
  });
});

describe('paginação por cursor', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('percorre tudo sem repetir nem pular', async () => {
    const tenant = await seedTenant('aud-cursor');
    const criados: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      criados.push(
        await seedEligibleContact(tenant.workspaceId, `+558590001${String(1000 + index)}`),
      );
    }

    const vistos: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const chunk = await fetchAudienceChunk(tenant.workspaceId, {}, 'BR', cursor, 5);
      if (chunk.contacts.length === 0) break;
      vistos.push(...chunk.contacts.map((contact) => contact.id));
      cursor = chunk.nextCursor;
      if (!cursor) break;
    }

    expect(vistos).toHaveLength(12);
    expect(new Set(vistos).size).toBe(12);
    expect(new Set(vistos)).toEqual(new Set(criados));
  });
});

describe('estimativa', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('conta por agregação, com o recorte de bloqueios', async () => {
    const tenant = await seedTenant('aud-est');
    await seedEligibleContact(tenant.workspaceId, '+5585900011001');
    await seedEligibleContact(tenant.workspaceId, '+5585900011002');

    const semConsent = await seedContact(tenant.workspaceId, '+5585900011003');
    await withConsent(tenant.workspaceId, semConsent, ConsentStatus.UNKNOWN);

    const estimate = await estimateAudience(
      tenant.workspaceId,
      { includeSuppressed: true },
      'BR',
    );

    expect(estimate.matched).toBe(3);
    expect(estimate.withConsent).toBe(2);
    expect(estimate.withoutConsent).toBe(1);
  });

  it('audiência vazia devolve zeros, não erro', async () => {
    const tenant = await seedTenant('aud-vazia');
    const estimate = await estimateAudience(tenant.workspaceId, {}, 'BR');

    expect(estimate).toMatchObject({
      matched: 0,
      withConsent: 0,
      suppressed: 0,
      invalidPhone: 0,
      potentiallyEligible: 0,
    });
  });
});

describe('materialização congela a audiência', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('contato adicionado depois não entra na campanha já preparada', async () => {
    const tenant = await seedTenant('mat-freeze');
    const channel = await seedChannel(tenant.workspaceId);
    const template = await seedTemplate(tenant.workspaceId, channel.id);
    await seedEligibleContact(tenant.workspaceId, '+5585900012001');

    const campaign = await seedCampaign(tenant.workspaceId, {
      channelId: channel.id,
      templateId: template.id,
    });
    await prepareCampaign({
      workspaceId: tenant.workspaceId,
      campaignId: campaign.id,
      actorUserId: tenant.userId,
    });

    // Novo contato entra na base DEPOIS da preparação.
    await seedEligibleContact(tenant.workspaceId, '+5585900012002');

    await expect(
      testPrisma().campaignRecipient.count({ where: { campaignId: campaign.id } }),
    ).resolves.toBe(1);
  });

  it('o mesmo contato vindo de lista E tag aparece uma vez só', async () => {
    const tenant = await seedTenant('mat-dedup');
    const channel = await seedChannel(tenant.workspaceId);
    const template = await seedTemplate(tenant.workspaceId, channel.id);

    const list = await testPrisma().contactList.create({
      data: { workspaceId: tenant.workspaceId, name: 'Lista A' },
    });
    const tag = await testPrisma().tag.create({
      data: { workspaceId: tenant.workspaceId, name: 'Tag B' },
    });
    const contactId = await seedEligibleContact(tenant.workspaceId, '+5585900013001');

    await testPrisma().contactListMember.create({
      data: { workspaceId: tenant.workspaceId, listId: list.id, contactId },
    });
    await testPrisma().contactTag.create({
      data: { workspaceId: tenant.workspaceId, tagId: tag.id, contactId },
    });

    const campaign = await seedCampaign(tenant.workspaceId, {
      channelId: channel.id,
      templateId: template.id,
      audienceFilters: { listIds: [list.id], tagIds: [tag.id] },
    });

    const report = await prepareCampaign({
      workspaceId: tenant.workspaceId,
      campaignId: campaign.id,
      actorUserId: tenant.userId,
    });

    expect(report.breakdown.total).toBe(1);
    await expect(
      testPrisma().campaignRecipient.count({ where: { campaignId: campaign.id } }),
    ).resolves.toBe(1);
  });

  it('suprimido incluído de propósito entra como SUPPRESSED, nunca elegível', async () => {
    const tenant = await seedTenant('mat-supp');
    const channel = await seedChannel(tenant.workspaceId);
    const template = await seedTemplate(tenant.workspaceId, channel.id);
    const contactId = await seedEligibleContact(tenant.workspaceId, '+5585900014001');
    await testPrisma().suppressionEntry.create({
      data: {
        workspaceId: tenant.workspaceId,
        contactId,
        phoneE164: '+5585900014001',
        reason: 'OPT_OUT',
      },
    });

    const campaign = await seedCampaign(tenant.workspaceId, {
      channelId: channel.id,
      templateId: template.id,
      audienceFilters: { includeSuppressed: true },
    });
    const report = await prepareCampaign({
      workspaceId: tenant.workspaceId,
      campaignId: campaign.id,
      actorUserId: tenant.userId,
    });

    expect(report.breakdown.suppressed).toBe(1);
    expect(report.breakdown.eligible).toBe(0);

    const recipient = await testPrisma().campaignRecipient.findFirstOrThrow({
      where: { campaignId: campaign.id },
    });
    expect(recipient.status).toBe(RecipientStatus.SUPPRESSED);
    expect(recipient.eligibilityReasons).toContain('SUPPRESSED');
  });
});
