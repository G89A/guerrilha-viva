'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Root error boundary. Next.js strips the message in production builds, so the
 * digest is the only usable correlation key — it is surfaced deliberately.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[ui.error_boundary]', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <main
      id="conteudo"
      className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <AlertTriangle className="size-8 text-destructive" aria-hidden="true" />
      <h1 className="text-2xl font-semibold">Algo deu errado</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        A operação não pôde ser concluída. Tente novamente; se o erro persistir, informe o código
        abaixo ao suporte.
      </p>
      {error.digest ? (
        <code className="rounded bg-muted px-2 py-1 font-mono text-xs">{error.digest}</code>
      ) : null}
      <Button onClick={reset}>Tentar novamente</Button>
    </main>
  );
}
