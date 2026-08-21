import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/auth/guards';
import { fetchInboundMedia } from '@/features/messaging/media-service';

/**
 * Serve uma mídia recebida, sob demanda.
 *
 * Autenticado e escopado ao workspace da sessão: o id da mensagem vem da URL,
 * mas o tenant vem da sessão — nunca do cliente.
 *
 * O binário passa pelo servidor porque a URL da Meta exige o token de acesso.
 * Nada é armazenado; cada visualização é uma busca nova.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> },
): Promise<NextResponse> {
  const context = await requireWorkspace();
  const { messageId } = await params;

  const outcome = await fetchInboundMedia({
    workspaceId: context.workspace.id,
    messageId,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.reason },
      { status: outcome.status, headers: { 'cache-control': 'no-store' } },
    );
  }

  return new NextResponse(Buffer.from(outcome.media.bytes), {
    status: 200,
    headers: {
      'content-type': outcome.mimeType,
      // `inline` com allowlist de tipo; `nosniff` impede o navegador de
      // adivinhar outro tipo e executar o que não deveria.
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      // Conteúdo de conversa não entra em cache compartilhado. `private` com
      // vida curta evita refazer a busca a cada rolagem.
      'cache-control': 'private, max-age=60',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}
