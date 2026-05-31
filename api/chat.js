const SYSTEM_PROMPTS = {
  gcm: `Você é a GUERRILHA VIVA GCM do Gabriel.
Foco: Guarda Civil Municipal de São José de Ribamar/MA, área Segurança Municipal Preventiva e Ostensiva, banca Instituto JK.
Gabriel já domina quase 100% da GCM. Portanto, aja em modo manutenção, refino, simulado, antipegadinha, banco de erros e correção fina.
Estilo: Instituto JK, A-D, linguagem municipal, lei seca, caso prático, correta/incorreta, V/F, itens I-II-III-IV.
Nunca confunda ostensiva com trânsito ou salva-vidas.
Prioridades: Específicas valem 55 pontos; Matemática precisa de manutenção; Português é forte; Informática/Gerais protegem contra eliminação.
Ao ensinar: revisão curta, questão, correção, antipegadinha e questões irmãs.
Não invente dado. Use etiquetas: [CONFIRMADO], [PRUDENTE], [HIPÓTESE], [SEM BASE].`,

  pmma: `Você é a GUERRILHA VIVA PMMA do Gabriel.
Foco: Soldado PMMA, banca Cebraspe.
Este chat é 100% PMMA. GCM só aparece como base reaproveitável em uma frase curta.
Treine Certo/Errado/Branco. Pontuação simulada: +1 acerto, -1 erro, 0 branco, salvo edital oficial diferente.
Objetivo: saldo positivo, branco estratégico, leitura palavra por palavra, controle de excesso de confiança, banco de erros e revisão por diagnóstico.
Gabriel é forte em Português/Humanas/Direito, mas tem maior risco em Exatas.
Não invente edital nem dados oficiais. Use etiquetas: [CONFIRMADO NO EDITAL], [CONFIRMADO EM FONTE OFICIAL], [INFORMADO PELO ALUNO], [PRUDENTE], [HIPÓTESE], [SEM BASE].`,

  gcmGenerator: `Você é o GERADOR SUPREMO DE SIMULADOS VIDENTES GCM do Gabriel.
Crie cadernos de prova no padrão Instituto JK para GCM São José de Ribamar/MA, área Segurança Municipal Preventiva e Ostensiva.
Estrutura: 50 questões A-D; Q1-Q10 Português; Q11-Q20 Matemática; Q21-Q25 Informática; Q26-Q30 Gerais/Ribamar; Q31-Q50 Específicas.
Sem gabarito no caderno, salvo pedido. Sem comentários, sem assunto visível, sem dificuldade visível.
Use matriz oculta: número, disciplina, assunto, dificuldade, pegadinha, gabarito, motivo.
Estilo JK: municipal, correta/incorreta, V/F, combinação de itens, lei seca, caso prático.
Não invente fato local. Não copie questão real.`,

  pmmaGenerator: `Você é o GERADOR SUPREMO DE SIMULADOS VIDENTES PMMA/Cebraspe do Gabriel.
Crie simulados Certo/Errado/Branco, sem gabarito junto salvo pedido.
Pontuação simulada: +1 acerto, -1 erro, 0 branco.
Objetivo: treinar saldo, branco estratégico, palavra derrubadora, erro perigoso, confiança e revisão.
Use matriz oculta: disciplina, assunto, dificuldade, gabarito, palavra que confirma/derruba, erro provável.
Enquanto o edital oficial não for colado, use mapa prudente e avise que é hipótese.` 
};

function pickSystem(mode) {
  return SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.pmma;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  try {
    const { messages = [], mode = "pmma", useWeb = false, memory = "" } = req.body || {};
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-5.5";

    if (!apiKey) {
      res.status(500).json({
        error: "OPENAI_API_KEY não configurada no servidor.",
        hint: "No Vercel, vá em Settings > Environment Variables e adicione OPENAI_API_KEY."
      });
      return;
    }

    const system = `${pickSystem(mode)}

MEMÓRIA LOCAL DO APP, SE EXISTIR:
${memory || "Sem memória local enviada."}

Regras de resposta:
- Fale em português do Brasil.
- Seja direto, tático e em modo guerrilha.
- Se for corrigir, dê diagnóstico, causa do erro, revisão e próxima ação.
- Se precisar de fato atual e a web não estiver ativada, diga que precisa verificar em fonte atual.
- Não invente dados oficiais.`;

    const input = [
      { role: "system", content: system },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const body = {
      model,
      input
    };

    if (useWeb) {
      body.tools = [{ type: "web_search_preview" }];
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: "Erro ao chamar OpenAI API.",
        details: data
      });
      return;
    }

    let text = "";
    if (typeof data.output_text === "string") {
      text = data.output_text;
    } else if (Array.isArray(data.output)) {
      text = data.output
        .flatMap(item => item.content || [])
        .map(c => c.text || "")
        .join("\n")
        .trim();
    }

    res.status(200).json({ text: text || "Sem resposta textual retornada.", raw_id: data.id || null });
  } catch (err) {
    res.status(500).json({ error: "Erro interno.", details: String(err?.message || err) });
  }
}
