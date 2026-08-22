import { describe, expect, it } from 'vitest';
import { isOptOutMessage, normalizeForMatch } from '@/features/protection/opt-out';

const KEYWORDS = ['PARAR', 'SAIR', 'CANCELAR', 'DESCADASTRAR', 'STOP', 'REMOVER'];
const match = (body: string): boolean => isOptOutMessage(body, KEYWORDS);

describe('normalização', () => {
  it('remove acento, caixa e pontuação', () => {
    expect(normalizeForMatch('Não!')).toBe('nao');
    expect(normalizeForMatch('  CANCELAR.  ')).toBe('cancelar');
    expect(normalizeForMatch('Descadastrar,,,')).toBe('descadastrar');
  });
});

describe('pedidos que DEVEM descadastrar', () => {
  it.each([
    'PARAR',
    'parar',
    'Parar.',
    'PARAR!!!',
    '  sair  ',
    'Cancelar',
    'descadastrar',
    'DESCADASTRAR!',
    'stop',
    'Remover',
    'quero sair',
    'por favor parar',
    'Por favor, cancelar',
    'me remover',
    'gostaria de sair',
    'sair por favor',
    'cancelar obrigado',
  ])('reconhece %s', (body) => {
    expect(match(body)).toBe(true);
  });
});

describe('mensagens que NÃO podem descadastrar', () => {
  it.each([
    ['negação explícita', 'não quero parar de receber'],
    ['frase com a palavra no meio', 'vocês podem parar de mandar às 3 da manhã? de dia tudo bem'],
    ['pergunta', 'como faço para cancelar meu pedido?'],
    ['contexto de produto', 'quero cancelar a compra que fiz ontem no site'],
    ['sair de outro lugar', 'preciso sair do grupo do condomínio'],
    ['texto longo', 'oi tudo bem? queria saber se tem em azul, e se puder me parar de enviar promoção de sapato seria ótimo'],
    ['vazio', ''],
    ['só espaço', '   '],
    ['emoji', '👍'],
    ['saudação', 'bom dia'],
    ['palavra parecida', 'pare'],
    ['parcial', 'cancel'],
  ])('não descadastra: %s', (_label, body) => {
    expect(match(body)).toBe(false);
  });

  it('mensagem nula ou ausente não descadastra', () => {
    expect(isOptOutMessage(null, KEYWORDS)).toBe(false);
    expect(isOptOutMessage(undefined, KEYWORDS)).toBe(false);
  });

  it('lista de palavras vazia nunca casa', () => {
    expect(isOptOutMessage('PARAR', [])).toBe(false);
  });

  it('palavra-chave vazia na política não casa com mensagem vazia', () => {
    expect(isOptOutMessage('oi', ['', '  '])).toBe(false);
  });
});

describe('palavras-chave personalizadas', () => {
  it('respeita o vocabulário configurado pelo operador', () => {
    expect(isOptOutMessage('CHEGA', ['CHEGA'])).toBe(true);
    expect(isOptOutMessage('chega!', ['CHEGA'])).toBe(true);
    expect(isOptOutMessage('PARAR', ['CHEGA'])).toBe(false);
  });

  it('acento na palavra-chave configurada também é normalizado', () => {
    expect(isOptOutMessage('nao quero', ['NÃO QUERO'])).toBe(true);
  });
});
