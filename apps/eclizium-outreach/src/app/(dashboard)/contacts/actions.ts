'use server';

import { revalidatePath } from 'next/cache';
import { ConsentChannel, ConsentSource, SuppressionReason } from '@prisma/client';
import {
  archiveContact,
  createContact,
  diffContact,
  getContactOrThrow,
  restoreContact,
  updateContact,
} from '@/features/contacts/service';
import {
  attachListSchema,
  attachTagSchema,
  batchActionSchema,
  consentUpdateSchema,
  contactIdSchema,
  createContactSchema,
  detachListSchema,
  detachTagSchema,
  suppressSchema,
  unsuppressSchema,
  updateContactSchema,
} from '@/features/contacts/schemas';
import { attachTag, detachTag, resolveTag } from '@/features/contacts/tags-service';
import { addToList, removeFromList, resolveList } from '@/features/contacts/lists-service';
import { setConsent } from '@/features/consent/service';
import { suppressContact, unsuppressContact } from '@/features/suppression/service';
import { writeAuditLog } from '@/lib/audit/audit-log';
import { prisma } from '@/lib/db/client';
import { requireWorkspaceRole } from '@/lib/auth/guards';
import { WorkspaceRole } from '@/lib/auth/roles';
import { runAction, type ActionResult } from '@/lib/errors/result';
import { assertSameOriginRequest } from '@/lib/security/request-context';
import { formDataToObject, parseOrThrow } from '@/lib/validation/parse';

/**
 * Toda ação deste módulo segue a mesma ordem, sem exceção:
 *   Origin → autenticação + workspace autorizado no servidor → validação Zod
 *   → serviço de domínio (sempre filtrando por workspaceId) → audit log.
 *
 * Nenhum `workspaceId` é lido do formulário. Ids de contato, tag e lista vindos
 * do cliente são tratados como alegação: o serviço só os encontra dentro do
 * workspace autorizado, e as foreign keys compostas recusam vínculos cruzados
 * mesmo que um serviço erre.
 */

/** MEMBER é o piso para escrever; VIEWER só lê. */
async function writeContext() {
  await assertSameOriginRequest();
  return requireWorkspaceRole(WorkspaceRole.MEMBER);
}

function revalidateContacts(contactId?: string): void {
  revalidatePath('/contacts');
  if (contactId) revalidatePath(`/contacts/${contactId}`);
}

export type ContactActionState = ActionResult<{ contactId: string }> | null;

export async function createContactAction(
  _previous: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  return runAction('contacts.create', async () => {
    const context = await writeContext();
    const input = parseOrThrow(createContactSchema, formDataToObject(formData));

    const contact = await createContact(context.workspace, input);

    await writeAuditLog({
      action: 'contact.created',
      resourceType: 'Contact',
      resourceId: contact.id,
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: { phoneE164: contact.phoneE164, source: contact.source },
    });

    revalidateContacts(contact.id);
    return { contactId: contact.id };
  });
}

export async function updateContactAction(
  _previous: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  return runAction('contacts.update', async () => {
    const context = await writeContext();
    const input = parseOrThrow(updateContactSchema, formDataToObject(formData));

    const before = await getContactOrThrow(context.workspace.id, input.contactId);
    const after = await updateContact(context.workspace, input.contactId, input);
    const changes = diffContact(before, after);

    if (Object.keys(changes).length > 0) {
      await writeAuditLog({
        action: 'contact.updated',
        resourceType: 'Contact',
        resourceId: input.contactId,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        metadata: { changes },
      });
    }

    revalidateContacts(input.contactId);
    return { contactId: input.contactId };
  });
}

export async function archiveContactAction(formData: FormData): Promise<ActionResult<null>> {
  return runAction('contacts.archive', async () => {
    const context = await writeContext();
    const { contactId } = parseOrThrow(contactIdSchema, formDataToObject(formData));

    const result = await archiveContact(context.workspace.id, contactId);

    // Arquivar duas vezes não é erro, mas também não gera um segundo registro
    // de auditoria: o log conta o que mudou, não o que foi clicado.
    if (result.changed) {
      await writeAuditLog({
        action: 'contact.archived',
        resourceType: 'Contact',
        resourceId: contactId,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
      });
    }

    revalidateContacts(contactId);
    return null;
  });
}

export async function restoreContactAction(formData: FormData): Promise<ActionResult<null>> {
  return runAction('contacts.restore', async () => {
    const context = await writeContext();
    const { contactId } = parseOrThrow(contactIdSchema, formDataToObject(formData));

    const result = await restoreContact(context.workspace.id, contactId);
    if (result.changed) {
      await writeAuditLog({
        action: 'contact.restored',
        resourceType: 'Contact',
        resourceId: contactId,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
      });
    }

    revalidateContacts(contactId);
    return null;
  });
}

export async function addTagAction(formData: FormData): Promise<ActionResult<null>> {
  return runAction('contacts.add_tag', async () => {
    const context = await writeContext();
    const input = parseOrThrow(attachTagSchema, formDataToObject(formData));

    await getContactOrThrow(context.workspace.id, input.contactId);
    const tag = await resolveTag(context.workspace.id, input);
    const { attached } = await attachTag(context.workspace.id, input.contactId, tag.id);

    if (attached) {
      await writeAuditLog({
        action: 'contact.tag_added',
        resourceType: 'Contact',
        resourceId: input.contactId,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        metadata: { tagId: tag.id, tagName: tag.name },
      });
    }

    revalidateContacts(input.contactId);
    return null;
  });
}

export async function removeTagAction(formData: FormData): Promise<ActionResult<null>> {
  return runAction('contacts.remove_tag', async () => {
    const context = await writeContext();
    const input = parseOrThrow(detachTagSchema, formDataToObject(formData));

    await getContactOrThrow(context.workspace.id, input.contactId);
    const { detached } = await detachTag(context.workspace.id, input.contactId, input.tagId);

    if (detached) {
      await writeAuditLog({
        action: 'contact.tag_removed',
        resourceType: 'Contact',
        resourceId: input.contactId,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        metadata: { tagId: input.tagId },
      });
    }

    revalidateContacts(input.contactId);
    return null;
  });
}

export async function addToListAction(formData: FormData): Promise<ActionResult<null>> {
  return runAction('contacts.add_to_list', async () => {
    const context = await writeContext();
    const input = parseOrThrow(attachListSchema, formDataToObject(formData));

    await getContactOrThrow(context.workspace.id, input.contactId);
    const list = await resolveList(context.workspace.id, input);
    const { added } = await addToList(context.workspace.id, input.contactId, list.id);

    if (added) {
      await writeAuditLog({
        action: 'contact.list_member_added',
        resourceType: 'Contact',
        resourceId: input.contactId,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        metadata: { listId: list.id, listName: list.name },
      });
    }

    revalidateContacts(input.contactId);
    return null;
  });
}

export async function removeFromListAction(formData: FormData): Promise<ActionResult<null>> {
  return runAction('contacts.remove_from_list', async () => {
    const context = await writeContext();
    const input = parseOrThrow(detachListSchema, formDataToObject(formData));

    await getContactOrThrow(context.workspace.id, input.contactId);
    const { removed } = await removeFromList(context.workspace.id, input.contactId, input.listId);

    if (removed) {
      await writeAuditLog({
        action: 'contact.list_member_removed',
        resourceType: 'Contact',
        resourceId: input.contactId,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        metadata: { listId: input.listId },
      });
    }

    revalidateContacts(input.contactId);
    return null;
  });
}

export async function updateConsentAction(formData: FormData): Promise<ActionResult<null>> {
  return runAction('contacts.update_consent', async () => {
    const context = await writeContext();
    const input = parseOrThrow(consentUpdateSchema, formDataToObject(formData));

    await getContactOrThrow(context.workspace.id, input.contactId);
    const result = await setConsent({
      workspaceId: context.workspace.id,
      contactId: input.contactId,
      channel: input.channel,
      status: input.status,
      source: ConsentSource.MANUAL,
      proofReference: input.proofReference ?? null,
    });

    if (result.changed) {
      await writeAuditLog({
        action: 'contact.consent_updated',
        resourceType: 'Contact',
        resourceId: input.contactId,
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        metadata: {
          channel: input.channel,
          from: result.previousStatus,
          to: input.status,
        },
      });
    }

    revalidateContacts(input.contactId);
    return null;
  });
}

export async function suppressContactAction(formData: FormData): Promise<ActionResult<null>> {
  return runAction('contacts.suppress', async () => {
    const context = await writeContext();
    const input = parseOrThrow(suppressSchema, formDataToObject(formData));

    await suppressContact({
      workspaceId: context.workspace.id,
      contactId: input.contactId,
      channel: input.channel,
      reason: input.reason,
      notes: input.notes ?? null,
      actorUserId: context.user.id,
    });

    revalidateContacts(input.contactId);
    return null;
  });
}

/** Retirar da supressão é decisão de compliance: exige ADMIN e justificativa. */
export async function unsuppressContactAction(formData: FormData): Promise<ActionResult<null>> {
  return runAction('contacts.unsuppress', async () => {
    await assertSameOriginRequest();
    const context = await requireWorkspaceRole(WorkspaceRole.ADMIN);
    const input = parseOrThrow(unsuppressSchema, formDataToObject(formData));

    await unsuppressContact({
      workspaceId: context.workspace.id,
      contactId: input.contactId,
      channel: input.channel,
      reason: input.reason,
      actorUserId: context.user.id,
    });

    revalidateContacts(input.contactId);
    return null;
  });
}

export interface BatchOutcome {
  requested: number;
  succeeded: number;
  skipped: number;
  failed: number;
}

/**
 * Operações em lote. Os ids vêm do cliente, então cada um é reconfirmado
 * dentro do workspace: contatos de outro tenant simplesmente não são
 * encontrados e entram na contagem de falhas.
 */
export async function batchContactAction(
  formData: FormData,
): Promise<ActionResult<BatchOutcome>> {
  return runAction('contacts.batch', async () => {
    const context = await writeContext();
    const raw = formDataToObject(formData);
    const input = parseOrThrow(batchActionSchema, {
      ...raw,
      contactIds: formData.getAll('contactIds'),
    });

    // Uma única consulta resolve quais ids realmente pertencem ao workspace.
    const owned = await ownedContactIds(context.workspace.id, input.contactIds);
    const outcome: BatchOutcome = {
      requested: input.contactIds.length,
      succeeded: 0,
      skipped: 0,
      failed: input.contactIds.length - owned.length,
    };

    const tag =
      input.action === 'tag' && input.tagName
        ? await resolveTag(context.workspace.id, { tagName: input.tagName })
        : null;
    const list =
      input.action === 'list' && input.listName
        ? await resolveList(context.workspace.id, { listName: input.listName })
        : null;

    for (const contactId of owned) {
      try {
        let applied: boolean;

        if (input.action === 'tag' && tag) {
          applied = (await attachTag(context.workspace.id, contactId, tag.id)).attached;
        } else if (input.action === 'list' && list) {
          applied = (await addToList(context.workspace.id, contactId, list.id)).added;
        } else if (input.action === 'archive') {
          applied = (await archiveContact(context.workspace.id, contactId)).changed;
        } else if (input.action === 'suppress') {
          applied = (
            await suppressContact({
              workspaceId: context.workspace.id,
              contactId,
              channel: ConsentChannel.WHATSAPP,
              reason: SuppressionReason.MANUAL,
              actorUserId: context.user.id,
            })
          ).created;
        } else {
          outcome.failed += 1;
          continue;
        }

        // `applied: false` significa "já estava assim": não é sucesso nem erro.
        if (applied) outcome.succeeded += 1;
        else outcome.skipped += 1;
      } catch {
        outcome.failed += 1;
      }
    }

    await writeAuditLog({
      action: 'contact.batch_action',
      resourceType: 'Contact',
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      metadata: {
        operation: input.action,
        ...outcome,
        ...(tag ? { tagName: tag.name } : {}),
        ...(list ? { listName: list.name } : {}),
      },
    });

    revalidateContacts();
    return outcome;
  });
}

/** Filtra os ids recebidos, devolvendo apenas os que existem no workspace. */
async function ownedContactIds(workspaceId: string, ids: string[]): Promise<string[]> {
  const rows = await prisma.contact.findMany({
    where: { workspaceId, id: { in: ids } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
