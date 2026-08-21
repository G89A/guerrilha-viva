# ADR 0011 — Onde vive o access token da Meta

Status: aceito (Sprint 2)

## Contexto

A integração com a Meta pertence a um workspace: cada cliente tem sua própria
WABA e seu próprio número. Ao mesmo tempo, a orientação do produto é preferir o
gerenciamento de segredos da infraestrutura a guardar credencial em banco.

As duas coisas não coincidem. Um único `META_ACCESS_TOKEN` de ambiente serve um
deploy de um cliente só; não serve um SaaS multi-tenant, onde o token de cada
workspace é diferente e não pode ser lido pelos outros.

## Decisão

`MessagingChannel.credentialSource` escolhe, por workspace, entre dois modos:

- **`ENVIRONMENT`** — o token vem de `META_ACCESS_TOKEN`. É o modo certo para um
  deploy dedicado a um cliente e para desenvolvimento. Nada de segredo toca o
  banco.
- **`ENCRYPTED`** — o token é cifrado com AES-256-GCM e guardado em
  `accessTokenCipher`. É o modo necessário quando o mesmo deploy atende vários
  clientes com contas distintas na Meta.

A chave de cifragem vem de `META_CREDENTIAL_KEY` (32 bytes base64) quando
definida. Sem ela, é derivada de `AUTH_SECRET` por HKDF-SHA256 com o rótulo
`eclizium:meta-credential:v1`. HKDF com rótulo próprio existe exatamente para
separar usos de um mesmo segredo mestre: a chave de cifragem não é o
`AUTH_SECRET`, e conhecer uma não dá a outra. Isso evita tornar mais uma
variável obrigatória sem cair em reúso de chave.

O ciphertext carrega versão no prefixo (`v1.<iv>.<tag>.<ciphertext>`), para que
trocar de algoritmo depois não vire adivinhação.

## Consequências

- Identificadores (WABA ID, Phone Number ID) ficam em claro: são dados de
  administração, não segredos.
- O token nunca sai de `credentials.ts` a não ser para dentro do provider. A UI
  vê apenas `fingerprintSecret()` — derivado de hash, sem nenhum caractere do
  segredo.
- GCM é autenticado: um ciphertext adulterado falha na verificação da tag em vez
  de decifrar em lixo. Um registro corrompido (ou chave trocada) vira
  `NOT_CONFIGURED` com instrução de reconfigurar, não um erro cru.
- Rotacionar `AUTH_SECRET` invalida os tokens cifrados que dependiam dele. Quem
  precisar rotacionar sessão sem mexer em credencial deve definir
  `META_CREDENTIAL_KEY` explicitamente. Está documentado no `.env.example`.
