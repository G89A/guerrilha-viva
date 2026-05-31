function page(answer = "", error = "") {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guerrilha Viva Chat</title><style>body{margin:0;font-family:Arial;background:#070b16;color:#f8fafc;padding:20px}.wrap{max-width:900px;margin:auto}.card{border:1px solid #2b3852;background:#101827;border-radius:22px;padding:18px;margin:12px 0}textarea,select,button{width:100%;border:1px solid #2b3852;border-radius:14px;background:#0d1526;color:#f8fafc;padding:12px;font-size:16px}textarea{min-height:130px}button{background:#2563eb;font-weight:700;cursor:pointer}.mut{color:#9fb0ca;line-height:1.5;white-space:pre-wrap}.err{color:#fca5a5;white-space:pre-wrap}.ans{white-space:pre-wrap;line-height:1.5}</style></head><body><div class="wrap"><h1>Guerrilha Viva — Chat</h1><p class="mut">Escolha o modo, mande a missão e receba a resposta.</p><form method="GET" action="/api/ui"><div class="card"><select name="mode"><option value="pmma">PMMA — Cebraspe</option><option value="gcm">GCM — JK</option><option value="pmmaGenerator">Gerador PMMA</option><option value="gcmGenerator">Gerador GCM</option></select><br><br><textarea name="q" placeholder="Ex.: COMEÇAR PMMA"></textarea><br><br><button type="submit">Enviar para a Guerrilha</button></div></form>${error ? `<div class="card err">${escapeHtml(error)}</div>` : ""}${answer ? `<div class="card ans">${escapeHtml(answer)}</div>` : ""}<p class="mut"><a style="color:#93c5fd" href="/">Voltar</a></p></div></body></html>`;
}

function escapeHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

const prompts = {
  pmma: "Você é a Guerrilha PMMA do Gabriel. Foco em Soldado PMMA, banca Cebraspe, certo/errado, saldo, diagnóstico e antipegadinha. Responda em português, direto e tático.",
  gcm: "Você é a Guerrilha GCM do Gabriel. Foco em GCM São José de Ribamar/MA, área ostensiva, Instituto JK, manutenção, simulado e antipegadinha. Responda em português, direto e tático.",
  pmmaGenerator: "Você é o Gerador de Simulados PMMA Cebraspe do Gabriel. Gere questões certo/errado, sem gabarito salvo pedido, com matriz mental de correção.",
  gcmGenerator: "Você é o Gerador de Simulados GCM Instituto JK do Gabriel. Gere questões A-D, estilo municipal, sem gabarito salvo pedido."
};

export default async function handler(req, res) {
  const q = String(req.query.q || "").trim();
  const mode = String(req.query.mode || "pmma");
  if (!q) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(page());
    return;
  }
  try {
    const key = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-5.5";
    if (!key) throw new Error("A variável OPENAI_API_KEY não foi encontrada no servidor. Salve a variável no Vercel e faça Redeploy.");
    const r = await fetch("https://api.openai.com/v1/responses", {method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},body:JSON.stringify({model,input:[{role:"system",content:prompts[mode]||prompts.pmma},{role:"user",content:q}]})});
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data, null, 2));
    const text = data.output_text || (Array.isArray(data.output) ? data.output.flatMap(x=>x.content||[]).map(c=>c.text||"").join("\n") : "Sem texto retornado.");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(page(text));
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(page("", String(e.message || e)));
  }
}
