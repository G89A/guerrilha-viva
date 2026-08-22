#!/usr/bin/env bash
# Preparação do Codespaces. Roda uma vez, quando o ambiente é criado.
set -euo pipefail

cd "$(dirname "$0")/../apps/eclizium-outreach"

echo "==> Gerando segredos locais"
# O .env é ignorado pelo Git. Os segredos nascem aleatórios aqui e nunca são
# versionados — nem os de desenvolvimento.
if [ ! -f .env ]; then
  gen() { node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"; }
  cat > .env <<ENV
DATABASE_URL="postgresql://postgres:postgres@db:5432/eclizium?schema=public"
DIRECT_DATABASE_URL="postgresql://postgres:postgres@db:5432/eclizium?schema=public"
TEST_DATABASE_URL="postgresql://postgres:postgres@db:5432/eclizium_test?schema=public"
AUTH_SECRET="$(gen)"
WORKER_TOKEN="$(gen)"

# Credenciais da Meta. Sem elas o produto reporta NOT_CONFIGURED e RECUSA
# enviar — nada aqui simula envio. Preencha pela tela de Integrações.
META_ACCESS_TOKEN=""
META_PHONE_NUMBER_ID=""
META_WABA_ID=""
META_GRAPH_API_VERSION="v21.0"
META_APP_SECRET=""
META_WEBHOOK_VERIFY_TOKEN=""
ENV
fi

echo "==> Instalando dependências"
npm ci

echo "==> Aplicando migrations"
npm run db:deploy

echo "==> Populando dados de demonstração"
npx tsx prisma/seed.ts || echo "   (seed já aplicado, seguindo)"

# Banco de teste: só serve para `npm test`. Se o cliente do Postgres não estiver
# na imagem, não vale travar a preparação por causa disso.
echo "==> Banco de teste (opcional)"
if command -v psql > /dev/null 2>&1; then
  PGPASSWORD=postgres psql -h db -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='eclizium_test'" \
    | grep -q 1 || PGPASSWORD=postgres psql -h db -U postgres -c "CREATE DATABASE eclizium_test"
  echo "   pronto — npm test disponível"
else
  echo "   psql ausente; para rodar os testes: sudo apt-get install -y postgresql-client"
fi

echo
echo "================================================"
echo " Pronto. Login: owner@acme.test / eclizium-dev-2026"
echo "================================================"
