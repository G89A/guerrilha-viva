import { beforeEach, describe, expect, it } from 'vitest';
import { ConversationStatus } from '@prisma/client';
import {
  addConversationNote,
  assignConversation,
  MAX_NOTE_LENGTH,
} from '@/features/messaging/conversation-service';
import {
  assignableMembers,
  getConversationDetail,
  inboxCounters,
  listConversations,
  listOlderMessages,
  MESSAGES_PAGE_SIZE,
} from '@/features/messaging/inbox-query';
import {
  createQuickReply,
  deleteQuickReply,
  listQuickReplies,
  updateQuickReply,
} from '@/features/messaging/quick-reply-service';
import { resetDatabase, testPrisma } from '../helpers/db';
import { seedChannel, seedTenant } from '../helpers/factories';
import { PHONE_NUMBER_ID, textMessagePayload } from '../helpers/webhook-fixtures';
import { deliverPayload } from '../helpers/webhook-delivery';

async function tenantWithChannel(label: string) {
  const tenant = await seedTenant(label);
  const channel = await seedChannel(tenant.workspaceId, { phoneNumberId: PHONE_NUMBER_ID });
  return { tenant, channel };
}

async function conversationFor(label: string) {
  const context = await tenantWithChannel(label);
  await deliverPayload(textMessagePayload({ wamid: `wamid.${label}`, body: 'oi' }));
  const conversation = await testPrisma().conversation.findFirstOrThrow({
    where: { workspaceId: context.tenant.workspaceId },
  });
  return { ...context, conversation };
}

describe('responsável pela conversa', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('atribui a um membro do workspace e marca o momento', async () => {
    const { tenant, conversation } = await conversationFor('col1');

    const result = await assignConversation({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      assigneeId: tenant.userId,
    });

    expect(result.changed).toBe(true);
    const updated = await testPrisma().conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(updated.assigneeId).toBe(tenant.userId);
    expect(updated.assignedAt).not.toBeNull();
  });

  it('remover o responsável limpa também o momento', async () => {
    const { tenant, conversation } = await conversationFor('col2');
    await assignConversation({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      assigneeId: tenant.userId,
    });

    await assignConversation({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      assigneeId: null,
    });

    const updated = await testPrisma().conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(updated.assigneeId).toBeNull();
    expect(updated.assignedAt).toBeNull();
  });

  it('RECUSA atribuir a alguém de outro workspace', async () => {
    const { tenant, conversation } = await conversationFor('col3');
    const outsider = await seedTenant('col3-out');

    const result = await assignConversation({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      assigneeId: outsider.userId,
    });

    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/workspace/i);

    const updated = await testPrisma().conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(updated.assigneeId).toBeNull();
  });

  it('conversa de outro workspace não é alcançada', async () => {
    const { conversation } = await conversationFor('col4');
    const outsider = await seedTenant('col4-out');

    const result = await assignConversation({
      workspaceId: outsider.workspaceId,
      conversationId: conversation.id,
      assigneeId: outsider.userId,
    });

    expect(result.changed).toBe(false);
  });

  it('a lista de possíveis responsáveis só traz membros deste workspace', async () => {
    const { tenant } = await conversationFor('col5');
    const outsider = await seedTenant('col5-out');

    const members = await assignableMembers(tenant.workspaceId);
    expect(members.map((member) => member.id)).toContain(tenant.userId);
    expect(members.map((member) => member.id)).not.toContain(outsider.userId);
  });

  it('filtra por responsável e por "sem responsável"', async () => {
    const { tenant, conversation } = await conversationFor('col6');

    const semDono = await listConversations(tenant.workspaceId, { assigneeId: 'UNASSIGNED' });
    expect(semDono.items).toHaveLength(1);

    await assignConversation({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      assigneeId: tenant.userId,
    });

    const minhas = await listConversations(tenant.workspaceId, { assigneeId: tenant.userId });
    expect(minhas.items).toHaveLength(1);
    const aindaSemDono = await listConversations(tenant.workspaceId, { assigneeId: 'UNASSIGNED' });
    expect(aindaSemDono.items).toHaveLength(0);
  });

  it('20 atribuições simultâneas terminam num estado válido', async () => {
    const { tenant, conversation } = await conversationFor('col7');

    await Promise.all(
      Array.from({ length: 20 }, (_value, index) =>
        assignConversation({
          workspaceId: tenant.workspaceId,
          conversationId: conversation.id,
          assigneeId: index % 2 === 0 ? tenant.userId : null,
        }),
      ),
    );

    const updated = await testPrisma().conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    // Ou tem dono com data, ou não tem nenhum dos dois. Nunca meio-termo.
    expect(updated.assigneeId === null).toBe(updated.assignedAt === null);
  });
});

describe('notas internas', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('grava a nota com autor e conversa', async () => {
    const { tenant, conversation } = await conversationFor('nota1');

    const result = await addConversationNote({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      authorId: tenant.userId,
      body: '  cliente pediu retorno na terça  ',
    });

    expect(result.created).toBe(true);
    const note = await testPrisma().conversationNote.findFirstOrThrow({});
    expect(note.body).toBe('cliente pediu retorno na terça');
    expect(note.authorId).toBe(tenant.userId);
  });

  it('nota NUNCA vira mensagem', async () => {
    const { tenant, conversation } = await conversationFor('nota2');
    const antes = await testPrisma().message.count();

    await addConversationNote({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      authorId: tenant.userId,
      body: 'isto é interno',
    });

    await expect(testPrisma().message.count()).resolves.toBe(antes);
  });

  it('recusa nota vazia e nota longa demais', async () => {
    const { tenant, conversation } = await conversationFor('nota3');

    await expect(
      addConversationNote({
        workspaceId: tenant.workspaceId,
        conversationId: conversation.id,
        authorId: tenant.userId,
        body: '   ',
      }),
    ).resolves.toMatchObject({ created: false });

    await expect(
      addConversationNote({
        workspaceId: tenant.workspaceId,
        conversationId: conversation.id,
        authorId: tenant.userId,
        body: 'x'.repeat(MAX_NOTE_LENGTH + 1),
      }),
    ).resolves.toMatchObject({ created: false });

    await expect(testPrisma().conversationNote.count()).resolves.toBe(0);
  });

  it('conversa de outro workspace não recebe nota', async () => {
    const { conversation } = await conversationFor('nota4');
    const outsider = await seedTenant('nota4-out');

    const result = await addConversationNote({
      workspaceId: outsider.workspaceId,
      conversationId: conversation.id,
      authorId: outsider.userId,
      body: 'invadindo',
    });

    expect(result.created).toBe(false);
    await expect(testPrisma().conversationNote.count()).resolves.toBe(0);
  });

  it('as notas aparecem no detalhe da conversa, mais recentes primeiro', async () => {
    const { tenant, conversation } = await conversationFor('nota5');

    await addConversationNote({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      authorId: tenant.userId,
      body: 'primeira',
    });
    await addConversationNote({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      authorId: tenant.userId,
      body: 'segunda',
    });

    const detail = await getConversationDetail(tenant.workspaceId, conversation.id);
    expect(detail?.notes.map((note) => note.body)).toEqual(['segunda', 'primeira']);
  });

  it('6 notas simultâneas gravam as 6', async () => {
    const { tenant, conversation } = await conversationFor('nota6');

    await Promise.all(
      Array.from({ length: 6 }, (_value, index) =>
        addConversationNote({
          workspaceId: tenant.workspaceId,
          conversationId: conversation.id,
          authorId: tenant.userId,
          body: `nota ${index}`,
        }),
      ),
    );

    await expect(testPrisma().conversationNote.count()).resolves.toBe(6);
  });
});

describe('respostas rápidas', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('cria, lista, edita e remove', async () => {
    const tenant = await seedTenant('qr1');

    const created = await createQuickReply({
      workspaceId: tenant.workspaceId,
      title: 'Horário',
      body: 'Atendemos das 9h às 18h.',
      createdById: tenant.userId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(listQuickReplies(tenant.workspaceId)).resolves.toHaveLength(1);

    await updateQuickReply({
      workspaceId: tenant.workspaceId,
      id: created.id,
      title: 'Horário',
      body: 'Atendemos das 8h às 18h.',
    });
    const [updated] = await listQuickReplies(tenant.workspaceId);
    expect(updated?.body).toContain('8h');

    await deleteQuickReply(tenant.workspaceId, created.id);
    await expect(listQuickReplies(tenant.workspaceId)).resolves.toHaveLength(0);
  });

  it('título duplicado no mesmo workspace é recusado pelo banco', async () => {
    const tenant = await seedTenant('qr2');
    const input = {
      workspaceId: tenant.workspaceId,
      title: 'Bem-vindo',
      body: 'Olá!',
      createdById: tenant.userId,
    };

    await createQuickReply(input);
    const second = await createQuickReply(input);

    expect(second.ok).toBe(false);
    await expect(listQuickReplies(tenant.workspaceId)).resolves.toHaveLength(1);
  });

  it('o mesmo título em workspaces diferentes convive', async () => {
    const a = await seedTenant('qr3a');
    const b = await seedTenant('qr3b');

    const first = await createQuickReply({
      workspaceId: a.workspaceId,
      title: 'Bem-vindo',
      body: 'Olá A',
      createdById: a.userId,
    });
    const second = await createQuickReply({
      workspaceId: b.workspaceId,
      title: 'Bem-vindo',
      body: 'Olá B',
      createdById: b.userId,
    });

    expect(first.ok && second.ok).toBe(true);
  });

  it('20 criações simultâneas do mesmo título criam uma só', async () => {
    const tenant = await seedTenant('qr4');

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        createQuickReply({
          workspaceId: tenant.workspaceId,
          title: 'Concorrente',
          body: 'texto',
          createdById: tenant.userId,
        }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    await expect(listQuickReplies(tenant.workspaceId)).resolves.toHaveLength(1);
  });

  it('editar e apagar não alcançam outro workspace', async () => {
    const a = await seedTenant('qr5a');
    const b = await seedTenant('qr5b');
    const created = await createQuickReply({
      workspaceId: a.workspaceId,
      title: 'Só de A',
      body: 'texto',
      createdById: a.userId,
    });
    if (!created.ok) throw new Error('não criou');

    const updated = await updateQuickReply({
      workspaceId: b.workspaceId,
      id: created.id,
      title: 'Sequestrada',
      body: 'invadida',
    });
    expect(updated.ok).toBe(false);

    const deleted = await deleteQuickReply(b.workspaceId, created.id);
    expect(deleted.deleted).toBe(false);

    const [survivor] = await listQuickReplies(a.workspaceId);
    expect(survivor?.title).toBe('Só de A');
  });
});

describe('paginação e contadores', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('a lista pagina por cursor sem repetir nem pular conversa', async () => {
    const { tenant, channel } = await tenantWithChannel('pag1');

    for (let index = 0; index < 7; index += 1) {
      const contact = await testPrisma().contact.create({
        data: {
          workspaceId: tenant.workspaceId,
          phoneE164: `+55859000000${index}`,
          firstName: `Contato ${index}`,
        },
      });
      await testPrisma().conversation.create({
        data: {
          workspaceId: tenant.workspaceId,
          channelId: channel.id,
          contactId: contact.id,
          lastMessageAt: new Date(Date.now() - index * 1000),
        },
      });
    }

    const first = await listConversations(tenant.workspaceId, {}, { take: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();

    const second = await listConversations(
      tenant.workspaceId,
      {},
      { take: 3, cursor: first.nextCursor ?? undefined },
    );
    const third = await listConversations(
      tenant.workspaceId,
      {},
      { take: 3, cursor: second.nextCursor ?? undefined },
    );

    const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(third.nextCursor).toBeNull();
  });

  it('o histórico traz as últimas mensagens e abre as anteriores por cursor', async () => {
    const { tenant, channel } = await tenantWithChannel('pag2');
    const contact = await testPrisma().contact.create({
      data: { workspaceId: tenant.workspaceId, phoneE164: '+5585911112222', firstName: 'Hist' },
    });
    const conversation = await testPrisma().conversation.create({
      data: { workspaceId: tenant.workspaceId, channelId: channel.id, contactId: contact.id },
    });

    const total = MESSAGES_PAGE_SIZE + 10;
    for (let index = 0; index < total; index += 1) {
      await testPrisma().message.create({
        data: {
          workspaceId: tenant.workspaceId,
          channelId: channel.id,
          contactId: contact.id,
          conversationId: conversation.id,
          direction: 'INBOUND',
          body: `msg ${index}`,
          createdAt: new Date(Date.now() - (total - index) * 1000),
        },
      });
    }

    const detail = await getConversationDetail(tenant.workspaceId, conversation.id);
    expect(detail?.messages).toHaveLength(MESSAGES_PAGE_SIZE);
    // Ordem cronológica na tela: a última da lista é a mais recente.
    expect(detail?.messages.at(-1)?.body).toBe(`msg ${total - 1}`);
    expect(detail?.olderCursor).not.toBeNull();

    const older = await listOlderMessages(
      tenant.workspaceId,
      conversation.id,
      detail?.olderCursor ?? '',
    );
    expect(older.messages).toHaveLength(10);
    expect(older.olderCursor).toBeNull();

    const allIds = [...older.messages, ...(detail?.messages ?? [])].map((message) => message.id);
    expect(new Set(allIds).size).toBe(total);
  });

  it('histórico de conversa de outro workspace volta vazio', async () => {
    const { tenant, conversation } = await conversationFor('pag3');
    const outsider = await seedTenant('pag3-out');
    const detail = await getConversationDetail(tenant.workspaceId, conversation.id);

    const older = await listOlderMessages(
      outsider.workspaceId,
      conversation.id,
      detail?.messages[0]?.id ?? 'cmxxxxxxxxxxxxxxxxxxxxxx',
    );
    expect(older.messages).toHaveLength(0);
  });

  it('os contadores batem com o estado real', async () => {
    const { tenant, conversation } = await conversationFor('cont1');

    let counters = await inboxCounters(tenant.workspaceId, tenant.userId);
    expect(counters).toMatchObject({ open: 1, unread: 1, mine: 0, unassigned: 1 });

    await assignConversation({
      workspaceId: tenant.workspaceId,
      conversationId: conversation.id,
      assigneeId: tenant.userId,
    });
    await testPrisma().conversation.update({
      where: { id: conversation.id },
      data: { status: ConversationStatus.CLOSED, unreadCount: 0 },
    });

    counters = await inboxCounters(tenant.workspaceId, tenant.userId);
    expect(counters).toMatchObject({ open: 0, closed: 1, unread: 0, mine: 1, unassigned: 0 });
  });

  it('os contadores de um workspace ignoram o outro', async () => {
    const { tenant } = await conversationFor('cont2');
    const outsider = await seedTenant('cont2-out');

    const counters = await inboxCounters(outsider.workspaceId, outsider.userId);
    expect(counters).toMatchObject({ open: 0, unread: 0, mine: 0, unassigned: 0 });
    expect(tenant.workspaceId).not.toBe(outsider.workspaceId);
  });
});
