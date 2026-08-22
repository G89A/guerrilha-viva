import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/internal/worker/tick/route';
import { resetDatabase } from '../helpers/db';

/**
 * A rota de ciclo do worker.
 *
 * Existe porque um defeito passou despercebido justamente aqui: a rota só
 * aceitava POST, e o agendador da Vercel chama por GET. O cron declarado em
 * `vercel.json` respondia 405 — uma funcionalidade que existia no papel e nunca
 * rodou uma vez. Serviço testado, rota não testada, defeito invisível.
 */

const SEGREDO = 'segredo-de-teste-com-tamanho-suficiente';
const ORIGINAL_ENV = { ...process.env };

function requisicao(token?: string): NextRequest {
  return new NextRequest('http://localhost/api/internal/worker/tick', {
    method: 'GET',
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
}

describe('rota do ciclo do worker', () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('aceita GET, que é como o agendador da Vercel chama', async () => {
    process.env.WORKER_TOKEN = SEGREDO;

    const response = await GET(requisicao(SEGREDO));
    expect(response.status).toBe(200);

    const body = (await response.json()) as { leased: number };
    expect(body.leased).toBe(0);
  });

  it('aceita POST, que é como o worker próprio chama', async () => {
    process.env.WORKER_TOKEN = SEGREDO;

    const response = await POST(requisicao(SEGREDO));
    expect(response.status).toBe(200);
  });

  it('aceita o CRON_SECRET da Vercel quando é ele que está definido', async () => {
    delete process.env.WORKER_TOKEN;
    process.env.CRON_SECRET = SEGREDO;

    const response = await GET(requisicao(SEGREDO));
    expect(response.status).toBe(200);
  });

  it('RECUSA sem nenhum segredo configurado — não existe modo aberto', async () => {
    delete process.env.WORKER_TOKEN;
    delete process.env.CRON_SECRET;

    const response = await GET(requisicao(SEGREDO));
    expect(response.status).toBe(503);
  });

  it('RECUSA segredo errado', async () => {
    process.env.WORKER_TOKEN = SEGREDO;

    const response = await GET(requisicao('valor-errado-mas-do-mesmo-tamanho!!'));
    expect(response.status).toBe(401);
  });

  it('RECUSA sem cabeçalho de autorização', async () => {
    process.env.WORKER_TOKEN = SEGREDO;

    const response = await GET(requisicao());
    expect(response.status).toBe(401);
  });

  it('RECUSA segredo curto demais, mesmo que a chamada traga o mesmo valor', async () => {
    process.env.WORKER_TOKEN = 'curto';

    const response = await GET(requisicao('curto'));
    // 503, não 401: o problema é a configuração, não quem chamou.
    expect(response.status).toBe(503);
  });

  it('nunca devolve o segredo no corpo da resposta', async () => {
    process.env.WORKER_TOKEN = SEGREDO;

    const response = await GET(requisicao('valor-errado-mas-do-mesmo-tamanho!!'));
    const texto = await response.text();
    expect(texto).not.toContain(SEGREDO);
  });
});
