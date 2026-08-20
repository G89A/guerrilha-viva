# ADR 0003 — Hash de senha com scrypt

- Status: aceito
- Data: 2026-08-20

## Contexto

O produto usa autenticação por e-mail e senha. É preciso um KDF resistente a
hardware dedicado, que funcione no runtime Node.js da Vercel.

## Decisão

`node:crypto.scrypt`, com `N=2^15`, `r=8`, `p=1`, salt aleatório de 16 bytes e
chave de 64 bytes. Formato armazenado:

```
scrypt$<N>$<r>$<p>$<salt-base64>$<hash-base64>
```

O custo (~32 MiB por hash) fica no servidor, e `verifyPassword` compara em tempo
constante.

## Justificativa

- **Sem dependência nativa.** `argon2` e `@node-rs/argon2` exigem binários
  compilados por plataforma — um risco real de build em ambiente serverless.
  scrypt vem no Node.
- **Memory-hard.** scrypt é reconhecido como KDF de senha (RFC 7914) e é a opção
  memory-hard disponível sem dependências.
- **Parâmetros versionados no próprio hash.** `needsRehash()` detecta hashes
  antigos, então elevar o custo depois não quebra logins existentes.

## Consequências

- Cada verificação custa ~50–100 ms de CPU: o limite de tentativas de login é
  necessário também por capacidade, não só por segurança.
- Senhas acima de 256 caracteres são recusadas antes do hash, para que um corpo
  de requisição grande não vire negação de serviço por CPU.
- Parâmetros absurdos vindos de uma linha corrompida são recusados antes de
  chamar o KDF, para que um registro envenenado não estoure a memória.

## Revisão futura

Migrar para argon2id assim que houver um caminho de build confiável. O formato
com prefixo já permite conviver com os dois durante a transição.
