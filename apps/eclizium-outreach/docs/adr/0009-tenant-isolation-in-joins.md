# ADR 0009 — Foreign keys compostas nas tabelas de junção

- Status: aceito
- Data: 2026-08-20

## Contexto

`contact_tags`, `contact_list_members` e `contact_consents` ligam duas entidades
que pertencem, cada uma, a um workspace. Uma foreign key simples em `contact_id`
e outra em `tag_id` garantem que ambos existem — mas não que estão no **mesmo**
workspace.

O red team do SPRINT 1 explorou exatamente essa lacuna em
`contact_consents`, cuja unique key é `(contact_id, channel)`, sem workspace:
um serviço que recebesse o `contactId` de outro tenant atualizaria o registro
alheio via upsert.

## Decisão

`contacts`, `tags` e `contact_lists` ganharam `@@unique([workspaceId, id])`, e
as tabelas de junção passaram a referenciá-los por foreign key **composta**:

```sql
FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts(workspace_id, id)
FOREIGN KEY (workspace_id, tag_id)     REFERENCES tags(workspace_id, id)
```

Com isso, um vínculo entre workspaces diferentes não é apenas um bug de
aplicação: é uma linha que o PostgreSQL recusa a gravar.

## Exceção: `suppression_entries.contact_id`

Continua sendo uma FK simples, com `ON DELETE SET NULL`. Uma FK composta exigiria
anular `workspace_id` junto, e essa coluna é obrigatória. A supressão **precisa**
sobreviver à remoção do contato (ADR 0010), então a garantia de tenant ali vem do
serviço: `suppressContact` valida a posse com `getContactOrThrow` antes de
qualquer escrita, e há teste de red team cobrindo isso.

## Consequências

- Duas camadas independentes protegem o isolamento: o filtro de aplicação
  (`workspaceScope`) e a integridade referencial do banco.
- As tabelas de junção carregam `workspace_id`, com custo de uma coluna e um
  índice — barato pelo que entrega.
- Testes que provam a recusa no nível do banco vivem em
  `tests/integration/tags-lists.test.ts` e `contacts-tenancy.test.ts`.
