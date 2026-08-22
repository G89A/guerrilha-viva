import { Database } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Tela de "falta o banco".
 *
 * Aparece quando a aplicação subiu mas nenhum banco foi conectado — situação
 * normal logo depois do primeiro deploy. É deliberadamente uma tela explicativa,
 * e não um erro: a aplicação NÃO está quebrada, está esperando uma peça.
 *
 * Não mostra endereço, variável de ambiente com valor, nem detalhe interno:
 * qualquer pessoa com o link chega aqui antes de existir login.
 */
export function DatabaseMissing() {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-muted">
          <Database aria-hidden="true" className="size-5 text-muted-foreground" />
        </div>
        <CardTitle>Falta conectar o banco de dados</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          A aplicação subiu e está funcionando. O que ainda não existe é o lugar
          onde os contatos, campanhas e mensagens ficam guardados — sem ele não
          dá nem para criar a sua conta.
        </p>

        <Alert>
          <AlertTitle>O que fazer</AlertTitle>
          <AlertDescription>
            <ol className="ml-4 list-decimal space-y-1.5">
              <li>
                No painel da hospedagem, crie um banco <strong>Postgres</strong> e
                ligue-o a este projeto. Na Vercel isso fica na aba{' '}
                <em>Storage</em>, em <em>Create Database</em>.
              </li>
              <li>
                Publique de novo (<em>Redeploy</em>). As tabelas são criadas
                sozinhas nesse momento.
              </li>
              <li>Recarregue esta página e crie a sua conta.</li>
            </ol>
          </AlertDescription>
        </Alert>

        <p className="text-xs text-muted-foreground">
          Enquanto o banco não existir, nada é gravado e nenhuma mensagem é
          enviada. Nada aqui é simulado.
        </p>
      </CardContent>
    </Card>
  );
}
