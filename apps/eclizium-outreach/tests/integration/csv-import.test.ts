/** Casos obrigatórios 7 e 8, mais o red team de CSV. */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConsentChannel, ConsentStatus } from '@prisma/client';
import { importContactsFromCsv } from '@/features/contacts/csv/import-service';
import { createContact } from '@/features/contacts/service';
import { suppressContact } from '@/features/suppression/service';
import { isAppError } from '@/lib/errors/app-error';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedTenant, workspaceRef, type SeededTenant } from '../helpers/factories';

const prisma = testPrisma();

const MAPPING = { phone: 0, firstName: 1, email: 2, company: 3 } as const;

async function runImport(
  tenant: SeededTenant,
  csv: string,
  overrides: Partial<{ mapping: Record<string, number>; consent: ConsentStatus }> = {},
) {
  return importContactsFromCsv({
    workspaceId: tenant.workspaceId,
    phoneRegion: 'BR',
    csv,
    mapping: overrides.mapping ?? MAPPING,
    source: 'planilha-teste',
    whatsappConsent: overrides.consent ?? ConsentStatus.UNKNOWN,
  });
}

describe('importContactsFromCsv', () => {
  let tenant: SeededTenant;

  beforeEach(async () => {
    await resetDatabase();
    tenant = await seedTenant('import');
  });

  afterAll(disconnectTestPrisma);

  it('importa linhas válidas com origem e consentimento declarados', async () => {
    const report = await runImport(
      tenant,
      [
        'telefone,nome,email,empresa',
        '85 99999-0001,João,joao@example.com,ACME',
        '85 99999-0002,Maria,maria@example.com,Contoso',
      ].join('\n'),
      { consent: ConsentStatus.GRANTED },
    );

    expect(report.imported).toBe(2);
    expect(report.summary.valid).toBe(2);

    const contacts = await prisma.contact.findMany({
      where: { workspaceId: tenant.workspaceId },
      orderBy: { phoneE164: 'asc' },
    });
    expect(contacts.map((contact) => contact.phoneE164)).toEqual([
      '+5585999990001',
      '+5585999990002',
    ]);
    expect(contacts[0]?.source).toBe('planilha-teste');

    const consent = await prisma.contactConsent.findFirstOrThrow({
      where: { contactId: contacts[0]?.id, channel: ConsentChannel.WHATSAPP },
    });
    expect(consent.status).toBe(ConsentStatus.GRANTED);
    expect(consent.source).toBe('CSV_IMPORT');
  });

  it('nunca presume GRANTED: o padrão declarado é respeitado', async () => {
    await runImport(tenant, 'telefone,nome\n85 99999-0001,João', {
      mapping: { phone: 0, firstName: 1 },
    });

    const consent = await prisma.contactConsent.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(consent.status).toBe(ConsentStatus.UNKNOWN);
  });

  // CASO 7
  it('classifica duplicados no arquivo e importa só a primeira ocorrência', async () => {
    const report = await runImport(
      tenant,
      [
        'telefone,nome,email,empresa',
        '85 99999-0001,João,,',
        '(85) 99999-0001,João de novo,,',
        '+5585999990001,João terceira vez,,',
      ].join('\n'),
    );

    expect(report.imported).toBe(1);
    expect(report.summary.duplicateInFile).toBe(2);
    await expect(
      prisma.contact.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(1);
  });

  it('classifica duplicados já existentes no banco sem sobrescrever', async () => {
    await createContact(workspaceRef(tenant.workspaceId), {
      phone: '85 99999-0001',
      firstName: 'Original',
      lastName: null,
      email: null,
      company: null,
      segment: null,
      city: null,
      state: null,
      country: null,
      source: 'manual',
      notes: null,
    });

    const report = await runImport(
      tenant,
      'telefone,nome,email,empresa\n85 99999-0001,Sobrescrito,,',
    );

    expect(report.imported).toBe(0);
    expect(report.summary.duplicateInDatabase).toBe(1);

    const contact = await prisma.contact.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(contact.firstName).toBe('Original');
  });

  // CASO 8
  it('rejeita linha com telefone inválido e importa o resto', async () => {
    const report = await runImport(
      tenant,
      [
        'telefone,nome,email,empresa',
        'não é telefone,Inválido,,',
        '85 99999-0002,Válido,,',
        ',Sem telefone,,',
      ].join('\n'),
    );

    expect(report.imported).toBe(1);
    expect(report.summary.invalid).toBe(2);
    expect(report.rejected.map((row) => row.lineNumber).sort()).toEqual([2, 4]);
    expect(report.rejected[0]?.reason).toBeTruthy();
  });

  it('rejeita linha com e-mail inválido sem descartar em silêncio', async () => {
    const report = await runImport(
      tenant,
      'telefone,nome,email,empresa\n85 99999-0001,João,email-quebrado,',
    );

    expect(report.imported).toBe(0);
    expect(report.summary.invalid).toBe(1);
    expect(report.rejected[0]?.reason).toContain('E-mail');
  });

  it('o relatório sempre fecha a conta: total = importados + rejeitados + falhas', async () => {
    const report = await runImport(
      tenant,
      [
        'telefone,nome,email,empresa',
        '85 99999-0001,ok,,',
        'lixo,inválida,,',
        '85 99999-0001,dup,,',
      ].join('\n'),
    );

    expect(report.summary.total).toBe(3);
    expect(report.imported + report.skipped + report.failed).toBe(report.summary.total);
  });

  it('exige o mapeamento de telefone', async () => {
    const attempt = await runImport(tenant, 'nome\nJoão', {
      mapping: { firstName: 0 },
    }).catch((error: unknown) => error);

    expect(isAppError(attempt) && attempt.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['CSV vazio', ''],
    ['só cabeçalho', 'telefone,nome'],
    ['cabeçalhos duplicados', 'telefone,telefone\n1,2'],
  ])('rejeita %s com erro de validação', async (_label, csv) => {
    const attempt = await runImport(tenant, csv).catch((error: unknown) => error);
    expect(isAppError(attempt) && attempt.code).toBe('VALIDATION_ERROR');
  });

  it('não executa fórmula: conteúdo perigoso é gravado como texto', async () => {
    await runImport(tenant, 'telefone,nome,email,empresa\n85 99999-0001,=SUM(A1:A9),,');

    const contact = await prisma.contact.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(contact.firstName).toBe('=SUM(A1:A9)');
  });

  it('preserva acentuação e separador dentro de aspas', async () => {
    await runImport(
      tenant,
      'telefone,nome,email,empresa\n85 99999-0001,José Ção,,"ACME, Ltda"',
    );

    const contact = await prisma.contact.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
    });
    expect(contact.firstName).toBe('José Ção');
    expect(contact.company).toBe('ACME, Ltda');
  });

  it('aceita ponto e vírgula como separador', async () => {
    const report = await runImport(tenant, 'telefone;nome;email;empresa\n85 99999-0001;João;;');
    expect(report.imported).toBe(1);
  });

  it('importa em lotes acima do tamanho do chunk sem perder linhas', async () => {
    const lines = ['telefone,nome,email,empresa'];
    for (let index = 0; index < 250; index += 1) {
      lines.push(`8599${String(index).padStart(6, '0')},Contato ${index},,`);
    }

    const report = await runImport(tenant, lines.join('\n'));
    expect(report.imported + report.skipped).toBe(250);
    await expect(
      prisma.contact.count({ where: { workspaceId: tenant.workspaceId } }),
    ).resolves.toBe(report.imported);
  });

  it('mantém o isolamento: importar em um workspace não toca o outro', async () => {
    const other = await seedTenant('outro');
    await runImport(tenant, 'telefone,nome,email,empresa\n85 99999-0001,João,,');

    await expect(
      prisma.contact.count({ where: { workspaceId: other.workspaceId } }),
    ).resolves.toBe(0);
  });

  it('um telefone suprimido reimportado permanece suprimido', async () => {
    const contact = await createContact(workspaceRef(tenant.workspaceId), {
      phone: '85 99999-0001',
      firstName: 'Original',
      lastName: null,
      email: null,
      company: null,
      segment: null,
      city: null,
      state: null,
      country: null,
      source: 'manual',
      notes: null,
    });
    await suppressContact({
      workspaceId: tenant.workspaceId,
      contactId: contact.id,
      actorUserId: tenant.userId,
    });
    await prisma.contact.delete({ where: { id: contact.id } });

    await runImport(tenant, 'telefone,nome,email,empresa\n85 99999-0001,Reimportado,,');

    const reimported = await prisma.contact.findFirstOrThrow({
      where: { workspaceId: tenant.workspaceId },
      include: { suppressions: true },
    });
    expect(reimported.suppressions).toHaveLength(1);
  });
});
