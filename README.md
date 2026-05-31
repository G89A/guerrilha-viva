# Guerrilha Viva Online — Gabriel

Este projeto transforma a Guerrilha GCM/PMMA em um app online com chatbot real usando OpenAI API.

## O que ele faz

- Chat vivo com IA
- Modos: GCM JK, PMMA Cebraspe, Gerador GCM e Gerador PMMA
- Banco de erros no navegador
- Exportação da sessão
- Botão de usar web search
- Backend serverless em `/api/chat`
- Chave protegida por variável de ambiente no servidor

## Publicar no Vercel

1. Crie/entre na conta em Vercel.
2. Clique em Add New Project.
3. Importe este repositório do GitHub.
4. Em Environment Variables, configure a chave da OpenAI e o modelo.
5. Faça deploy.

## Segurança

Nunca coloque chave secreta dentro do `public/index.html`.
A chave deve ficar somente no painel do Vercel, em Environment Variables.
O navegador chama `/api/chat`; o backend chama a OpenAI.

## Limite importante

O app só terá internet se a opção Usar web estiver ativada e se a conta/modelo/API suportar a ferramenta de web search.
