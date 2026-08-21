import { beforeEach, describe, expect, it } from 'vitest';
import { MessageDirection, MessageStatus } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit/audit-log';
import {
  auditActivity,
  auditFilterOptions,
  listAuditEntries,
} from '@/features/analytics/audit-query';
import { buildRange, parseRangeDays, parseTimeZone } from '@/features/analytics/range';
import { audienceGrowth, messagingSeries, messagingTotals } from '@/features/analytics/service';
import { escapeCsvCell } from '@/features/contacts/csv/export';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedChannel, seedContact, seedTenant } from '../helpers/factories';

const range = () => buildRange({ days: 30, timeZone: 'UTC' });

async function tenantWithChannel(label: string) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId);
  return { tenant, channel };
}

describe('registro de auditoria', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('lista os registros do workspace, mais recentes primeiro', async () => {
    const tenant = await seedTenant('au1');

    for (let index = 0; index < 3; index += 1) {
      await writeAuditLog({
        action: 'contact.created',
        resourceType: 'Contact',
        resourceId: `c${index}`,
        workspaceId: tenant.workspaceId,
        actorUserId: tenant.userId,
        metadata: { index },
      });
    }

    const page = await listAuditEntries(tenant.workspaceId);
    expect(page.entries).toHaveLength(3);
    expect(page.entries[0]?.actorName).toBeTruthy();
  });

  it('registro de OUTRO workspace nunca aparece', async () => {
    const a = await seedTenant('au2a');
    const b = await seedTenant('au2b');

    await writeAuditLog({
      action: 'contact.created',
      resourceType: 'Contact',
      resourceId: 'segredo',
      workspaceId: a.workspaceId,
      actorUserId: a.userId,
      metadata: {},
    });

    const page = await listAuditEntries(b.workspaceId);
    expect(page.entries).toHaveLength(0);

    const options = await auditFilterOptions(b.workspaceId);
    expect(options.actions).toHaveLength(0);
    expect(options.actors.map((actor) => actor.id)).not.toContain(a.userId);
  });

  it('pagina por cursor sem repetir nem pular registro', async () => {
    const tenant = await seedTenant('au3');
    for (let index = 0; index < 7; index += 1) {
      await writeAuditLog({
        action: 'contact.updated',
        resourceType: 'Contact',
        resourceId: `r${index}`,
        workspaceId: tenant.workspaceId,
        actorUserId: tenant.userId,
        metadata: {},
      });
    }

    const first = await listAuditEntries(tenant.workspaceId, {}, { take: 3 });
    const second = await listAuditEntries(
      tenant.workspaceId,
      {},
      { take: 3, cursor: first.nextCursor ?? undefined },
    );
    const third = await listAuditEntries(
      tenant.workspaceId,
      {},
      { take: 3, cursor: second.nextCursor ?? undefined },
    );

    const ids = [...first.entries, ...second.entries, ...third.entries].map((entry) => entry.id);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(third.nextCursor).toBeNull();
  });

  it('filtra por ação e por recurso', async () => {
    const tenant = await seedTenant('au4');
    await writeAuditLog({
      action: 'campaign.started',
      resourceType: 'Campaign',
      workspaceId: tenant.workspaceId,
      actorUserId: tenant.userId,
      metadata: {},
    });
    await writeAuditLog({
      action: 'contact.created',
      resourceType: 'Contact',
      workspaceId: tenant.workspaceId,
      actorUserId: tenant.userId,
      metadata: {},
    });

    const porAcao = await listAuditEntries(tenant.workspaceId, { action: 'campaign.started' });
    expect(porAcao.entries).toHaveLength(1);

    const porRecurso = await listAuditEntries(tenant.workspaceId, { resourceType: 'Contact' });
    expect(porRecurso.entries).toHaveLength(1);
  });

  it('ação do sistema aparece sem autor, e não some', async () => {
    const tenant = await seedTenant('au5');
    await writeAuditLog({
      action: 'webhook.processed',
      resourceType: 'WebhookEvent',
      workspaceId: tenant.workspaceId,
      actorUserId: null,
      actorType: 'SYSTEM',
      metadata: {},
    });

    const page = await listAuditEntries(tenant.workspaceId);
    expect(page.entries[0]).toMatchObject({ actorType: 'SYSTEM', actorName: null });
  });

  it('o volume por ação só conta o próprio workspace', async () => {
    const a = await seedTenant('au6a');
    const b = await seedTenant('au6b');
    await writeAuditLog({
      action: 'contact.created',
      resourceType: 'Contact',
      workspaceId: a.workspaceId,
      actorUserId: a.userId,
      metadata: {},
    });

    const r = range();
    await expect(auditActivity(b.workspaceId, r.from, r.to)).resolves.toHaveLength(0);
    await expect(auditActivity(a.workspaceId, r.from, r.to)).resolves.toHaveLength(1);
  });

  it('20 escritas simultâneas de auditoria gravam as 20', async () => {
    const tenant = await seedTenant('au7');

    await Promise.all(
      Array.from({ length: 20 }, (_value, index) =>
        writeAuditLog({
          action: 'contact.batch_action',
          resourceType: 'Contact',
          resourceId: `b${index}`,
          workspaceId: tenant.workspaceId,
          actorUserId: tenant.userId,
          metadata: { index },
        }),
      ),
    );

    const page = await listAuditEntries(tenant.workspaceId, {}, { take: 50 });
    expect(page.entries).toHaveLength(20);
    expect(new Set(page.entries.map((entry) => entry.id)).size).toBe(20);
  });
});

describe('red team — analytics', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('fuso forjado não chega ao SQL: cai no padrão', async () => {
    const { tenant } = await tenantWithChannel('rt-an1');
    const hostil = parseTimeZone("UTC'; DROP TABLE messages; --");
    expect(hostil).toBe('UTC');

    // A consulta roda e a tabela continua de pé.
    await expect(
      messagingSeries(tenant.workspaceId, buildRange({ days: 7, timeZone: hostil })),
    ).resolves.toHaveLength(7);
    await expect(testPrisma().message.count()).resolves.toBe(0);
  });

  it('período absurdo cai no padrão em vez de varrer o banco inteiro', async () => {
    expect(parseRangeDays(100_000)).toBe(30);
    expect(parseRangeDays(-5)).toBe(30);
    expect(parseRangeDays('DROP')).toBe(30);
  });

  it('id de workspace forjado não traz dado de ninguém', async () => {
    const { tenant, channel } = await tenantWithChannel('rt-an2');
    const contactId = await seedContact(tenant.workspaceId, '+5585950000001');
    await testPrisma().message.create({
      data: {
        workspaceId: tenant.workspaceId,
        channelId: channel.id,
        contactId,
        direction: MessageDirection.OUTBOUND,
        status: MessageStatus.SENT,
      },
    });

    const totals = await messagingTotals("' OR 1=1 --", buildRange({ days: 7 }));
    expect(totals.sent).toBe(0);
    const growth = await audienceGrowth("' OR 1=1 --", buildRange({ days: 7 }));
    expect(growth.totals.created).toBe(0);
  });

  it('metadados de auditoria são texto, nunca marcação executável', async () => {
    const tenant = await seedTenant('rt-an3');
    await writeAuditLog({
      action: 'contact.created',
      resourceType: 'Contact',
      workspaceId: tenant.workspaceId,
      actorUserId: tenant.userId,
      metadata: { nome: '<script>alert(1)</script>' },
    });

    const page = await listAuditEntries(tenant.workspaceId);
    const metadata = page.entries[0]?.metadata as Record<string, unknown>;
    // Guardado exatamente como veio; quem escapa é a renderização, e a tabela
    // usa <pre> com interpolação do React.
    expect(metadata.nome).toBe('<script>alert(1)</script>');
  });

  it('exportação neutraliza fórmula de planilha', () => {
    // Sem vírgula nem aspas, a célula não precisa de envelope — basta o
    // apóstrofo que tira o poder de fórmula.
    expect(escapeCsvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(escapeCsvCell('+1234')).toBe("'+1234");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvCell('texto normal')).toBe('texto normal');
  });

  it('nome de contato com vírgula e aspas não quebra a linha do CSV', () => {
    expect(escapeCsvCell('Silva, "Zé"')).toBe('"Silva, ""Zé"""');
  });

  it('6 leituras simultâneas do mesmo relatório devolvem o mesmo número', async () => {
    const { tenant, channel } = await tenantWithChannel('rt-an4');
    const contactId = await seedContact(tenant.workspaceId, '+5585950000002');

    for (let index = 0; index < 5; index += 1) {
      await testPrisma().message.create({
        data: {
          workspaceId: tenant.workspaceId,
          channelId: channel.id,
          contactId,
          direction: MessageDirection.OUTBOUND,
          status: MessageStatus.SENT,
        },
      });
    }

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        messagingTotals(tenant.workspaceId, buildRange({ days: 7 })),
      ),
    );

    expect(new Set(results.map((result) => result.sent))).toEqual(new Set([5]));
  });

  it('50 leituras simultâneas não derrubam a agregação', async () => {
    const { tenant } = await tenantWithChannel('rt-an5');

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        messagingTotals(tenant.workspaceId, buildRange({ days: 7 })),
      ),
    );

    expect(results).toHaveLength(50);
    expect(results.every((result) => result.sent === 0)).toBe(true);
  }, 60_000);
});
