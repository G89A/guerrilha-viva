# ADR 0008 — Identidade do contato e deduplicação

- Status: aceito
- Data: 2026-08-20

## Contexto

Um contato precisa de uma identidade estável dentro do workspace. O mesmo
número chega escrito de formas diferentes (`85999999999`, `(85) 99999-9999`,
`+55 85 99999-9999`), por formulário e por importação.

## Decisão

**A identidade do contato é `(workspaceId, phoneE164)`.**

1. `phoneE164` é obrigatório e produzido por um módulo único,
   `features/contacts/phone.ts`, apoiado em `libphonenumber-js`.
2. `phone` guarda o texto exatamente como informado, para conferência humana.
   Ele nunca participa de busca por identidade nem de deduplicação.
3. A região usada para números sem DDI é `workspaces.default_phone_region`
   (padrão `BR`), não uma constante global: workspaces diferentes operam em
   países diferentes.
4. A constraint `contacts_workspace_id_phone_e164_key` é a autoridade final.
   Os serviços tentam a escrita e traduzem a violação para `CONFLICT` com uma
   mensagem de negócio — nunca deixam o erro do Prisma vazar para a UI.

## Consequências

- Contato sem telefone não existe nesta fase. Isso simplifica identidade e
  deduplicação e está alinhado com um produto de WhatsApp. Contatos apenas com
  e-mail exigiriam repensar a chave — e não são necessários agora.
- Deduplicação por telefone é decidida no E.164, então formatos diferentes do
  mesmo número colidem corretamente, no formulário e na importação.
- Corridas (duplo clique, importações simultâneas) terminam na constraint, e a
  perdedora vira `CONFLICT`. Testado em `contacts-redteam.test.ts`.

## Por que `libphonenumber-js`

Normalizar E.164 à mão significa reimplementar planos de numeração nacionais —
comprimento por DDD, nono dígito, prefixos móveis. É a classe de código que
parece funcionar em testes e falha com números reais. A biblioteca é o padrão
de fato, é pequena o suficiente e roda igual no servidor e no navegador, o que
permite ao preview do CSV mostrar exatamente o que a importação vai gravar.
