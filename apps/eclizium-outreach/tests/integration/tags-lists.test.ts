import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { attachTag, detachTag, listTags, resolveTag } from '@/features/contacts/tags-service';
import {
  addToList,
  listContactLists,
  removeFromList,
  resolveList,
} from '@/features/contacts/lists-service';
import { isAppError } from '@/lib/errors/app-error';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../helpers/db';
import { seedContact, seedTenant, type SeededTenant } from '../helpers/factories';

const prisma = testPrisma();

describe('tags', () => {
  let tenant: SeededTenant;
  let contactId: string;

  beforeEach(async () => {
    await resetDatabase();
    tenant = await seedTenant('tags');
    contactId = await seedContact(tenant.workspaceId, '+5585999990001');
  });

  afterAll(disconnectTestPrisma);

  it('cria a tag na primeira vez e reaproveita depois', async () => {
    const first = await resolveTag(tenant.workspaceId, { tagName: 'VIP' });
    const second = await resolveTag(tenant.workspaceId, { tagName: 'VIP' });

    expect(second.id).toBe(first.id);
    await expect(prisma.tag.count({ where: { workspaceId: tenant.workspaceId } })).resolves.toBe(1);
  });

  it('aplica a tag e ignora a segunda aplicação', async () => {
    const tag = await resolveTag(tenant.workspaceId, { tagName: 'VIP' });

    const first = await attachTag(tenant.workspaceId, contactId, tag.id);
    const second = await attachTag(tenant.workspaceId, contactId, tag.id);

    expect(first.attached).toBe(true);
    expect(second.attached).toBe(false);
    await expect(prisma.contactTag.count({ where: { contactId } })).resolves.toBe(1);
  });

  it('remove a tag e reporta quando não havia nada a remover', async () => {
    const tag = await resolveTag(tenant.workspaceId, { tagName: 'VIP' });
    await attachTag(tenant.workspaceId, contactId, tag.id);

    expect((await detachTag(tenant.workspaceId, contactId, tag.id)).detached).toBe(true);
    expect((await detachTag(tenant.workspaceId, contactId, tag.id)).detached).toBe(false);
  });

  it('recusa tag de outro workspace por id', async () => {
    const other = await seedTenant('outro');
    const foreignTag = await resolveTag(other.workspaceId, { tagName: 'Alheia' });

    const attempt = await resolveTag(tenant.workspaceId, { tagId: foreignTag.id }).catch(
      (error: unknown) => error,
    );
    expect(isAppError(attempt) && attempt.code).toBe('NOT_FOUND');
  });

  it('o banco recusa vincular tag de outro workspace, mesmo passando por cima do serviço', async () => {
    const other = await seedTenant('outro');
    const foreignTag = await resolveTag(other.workspaceId, { tagName: 'Alheia' });

    // Foreign key composta (workspace_id, tag_id): não existe essa combinação.
    await expect(
      prisma.contactTag.create({
        data: { workspaceId: tenant.workspaceId, contactId, tagId: foreignTag.id },
      }),
    ).rejects.toThrow();
  });

  it('tags de mesmo nome coexistem em workspaces diferentes', async () => {
    const other = await seedTenant('outro');
    const mine = await resolveTag(tenant.workspaceId, { tagName: 'VIP' });
    const theirs = await resolveTag(other.workspaceId, { tagName: 'VIP' });

    expect(mine.id).not.toBe(theirs.id);
  });

  it('lista apenas as tags do workspace, com contagem', async () => {
    const other = await seedTenant('outro');
    await resolveTag(other.workspaceId, { tagName: 'Alheia' });

    const tag = await resolveTag(tenant.workspaceId, { tagName: 'VIP' });
    await attachTag(tenant.workspaceId, contactId, tag.id);

    const tags = await listTags(tenant.workspaceId);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ name: 'VIP', contactCount: 1 });
  });
});

describe('listas', () => {
  let tenant: SeededTenant;
  let contactId: string;

  beforeEach(async () => {
    await resetDatabase();
    tenant = await seedTenant('listas');
    contactId = await seedContact(tenant.workspaceId, '+5585999990002');
  });

  it('adiciona à lista e ignora a segunda adição', async () => {
    const list = await resolveList(tenant.workspaceId, { listName: 'Leads' });

    expect((await addToList(tenant.workspaceId, contactId, list.id)).added).toBe(true);
    expect((await addToList(tenant.workspaceId, contactId, list.id)).added).toBe(false);
    await expect(prisma.contactListMember.count({ where: { contactId } })).resolves.toBe(1);
  });

  it('remove da lista', async () => {
    const list = await resolveList(tenant.workspaceId, { listName: 'Leads' });
    await addToList(tenant.workspaceId, contactId, list.id);

    expect((await removeFromList(tenant.workspaceId, contactId, list.id)).removed).toBe(true);
    expect((await removeFromList(tenant.workspaceId, contactId, list.id)).removed).toBe(false);
  });

  it('recusa lista de outro workspace por id', async () => {
    const other = await seedTenant('outro');
    const foreignList = await resolveList(other.workspaceId, { listName: 'Alheia' });

    const attempt = await resolveList(tenant.workspaceId, { listId: foreignList.id }).catch(
      (error: unknown) => error,
    );
    expect(isAppError(attempt) && attempt.code).toBe('NOT_FOUND');
  });

  it('o banco recusa vincular lista de outro workspace', async () => {
    const other = await seedTenant('outro');
    const foreignList = await resolveList(other.workspaceId, { listName: 'Alheia' });

    await expect(
      prisma.contactListMember.create({
        data: { workspaceId: tenant.workspaceId, contactId, listId: foreignList.id },
      }),
    ).rejects.toThrow();
  });

  it('o banco recusa vincular contato de outro workspace a uma lista local', async () => {
    const other = await seedTenant('outro');
    const foreignContact = await seedContact(other.workspaceId, '+5585999990003');
    const list = await resolveList(tenant.workspaceId, { listName: 'Leads' });

    await expect(
      prisma.contactListMember.create({
        data: { workspaceId: tenant.workspaceId, contactId: foreignContact, listId: list.id },
      }),
    ).rejects.toThrow();
  });

  it('lista apenas listas do workspace, com contagem de membros', async () => {
    const other = await seedTenant('outro');
    await resolveList(other.workspaceId, { listName: 'Alheia' });

    const list = await resolveList(tenant.workspaceId, { listName: 'Leads' });
    await addToList(tenant.workspaceId, contactId, list.id);

    const lists = await listContactLists(tenant.workspaceId);
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: 'Leads', memberCount: 1 });
  });
});
