#!/usr/bin/env bash
# Sobe aplicação e worker toda vez que o Codespaces é aberto.
#
# Os dois ficam em segundo plano: um processo em primeiro plano aqui travaria o
# anexo do editor. O worker vai junto de propósito — sem ele, campanha enfileira
# e nada sai, e quem está avaliando concluiria que o produto está quebrado.
set -euo pipefail

cd "$(dirname "$0")/../apps/eclizium-outreach"

if [ ! -d node_modules ]; then
  echo "Dependências ainda não instaladas. Rode: bash .devcontainer/setup.sh"
  exit 0
fi

# Não sobe duas vezes se o editor reanexar.
if pgrep -f "next dev" > /dev/null 2>&1; then
  echo "Aplicação já está rodando em http://localhost:3000"
  exit 0
fi

nohup npx tsx scripts/worker.ts > /tmp/worker.log 2>&1 &
nohup npx next dev -H 0.0.0.0 -p 3000 > /tmp/app.log 2>&1 &

echo "==> Aplicação subindo em http://localhost:3000"
echo "    Login:  owner@acme.test / eclizium-dev-2026"
echo "    Logs:   /tmp/app.log e /tmp/worker.log"
echo
echo "    A aba PORTAS mostra o endereço público quando estiver de pé."
