/* ==========================================================================
   Quest do planejamento · as respostas de exemplo, para a prévia do professor.

   A prévia (index.html?previa=1&prof=1) mostra cada etapa como o grupo vê, e
   embaixo o gabarito do tema. Para ver as respostas acumuladas e os slides do
   fim, falta o que um grupo teria escrito: este módulo monta isso a partir do
   gabarito (a pergunta boa de exemplo, a busca conferida, o caso real
   consultado, as variáveis de exemplo). O app e a página dos slides usam as
   mesmas funções.
   ========================================================================== */

const pyValor = (v) =>
  typeof v === "boolean"
    ? (v ? "True" : "False")
    : Array.isArray(v)
    ? `[${v.map(pyValor).join(", ")}]`
    : typeof v === "number"
    ? String(v)
    : JSON.stringify(v);

/** O código Python que o juscraper-app geraria para a busca conferida no gabarito. */
export function codigoExemplo(fonte) {
  if (!fonte?.parametros) return "";
  const p = { ...fonte.parametros };
  const datajud = /datajud/i.test(fonte.aba || "");
  const sentencas = /senten/i.test(fonte.aba || "");
  const tribunal = String(p.tribunal || fonte.tribunal || "tjsp");
  const raspador = datajud ? "datajud" : tribunal.toLowerCase();
  const funcao = datajud ? "listar_processos" : sentencas ? "cjpg" : "cjsg";
  if (!datajud) delete p.tribunal;
  const pesquisa = p.pesquisa;
  delete p.pesquisa;
  const argumentos = [
    ...(pesquisa ? [JSON.stringify(pesquisa)] : []),
    ...Object.entries(p).map(([k, v]) => `${k}=${pyValor(v)}`),
  ];
  return [
    "# pip install juscraper",
    "import juscraper as jus",
    "",
    `scraper = jus.scraper("${raspador}")`,
    `df = scraper.${funcao}(`,
    ...argumentos.map((a) => `    ${a},`),
    ")",
  ].join("\n");
}

const primeiraFrase = (s) => String(s || "").split(/\.\s/)[0];

/** O caso real do gabarito, no formato dos três campos da etapa da consulta. */
function consultaExemplo(t) {
  const c = t.caso_exemplo;
  if (!c) {
    return { numero: "", encontrado: t.consulta || "", acesso: t.extracao_ia || "" };
  }
  const valores = Object.entries(c.valores || {}).map(([k, v]) => `${k} = ${v}`).join("; ");
  const segundoGrau = (c.links || []).some((l) => l.includes("cposg"));
  const onde = segundoGrau
    ? "A ementa veio na aba Jurisprudência do juscraper-app; as partes e o resultado, no e-SAJ de 2º grau; o inteiro teor, no PDF do acórdão. Tudo aberto, sem login."
    : "As datas e os códigos vieram do DataJud (juscraper-app); o texto das decisões, das movimentações do e-SAJ de 1º grau. Tudo aberto, sem login; as petições só quem atua no processo vê.";
  return {
    numero: c.numero || "",
    encontrado: [c.o_que_se_ve, valores ? `Valores: ${valores}.` : ""].filter(Boolean).join(" "),
    acesso: [onde, t.extracao_ia || ""].filter(Boolean).join(" "),
  };
}

/** As respostas que um grupo teria dado em cada etapa, tiradas do gabarito do tema. */
export function respostasExemplo(t) {
  if (!t) return {};
  return {
    diagnostico: (t.defeitos_da_pergunta_errada || []).join(" "),
    pergunta: t.exemplo_pergunta_boa || "",
    fonte: {
      codigo: codigoExemplo(t.fonte_no_app),
      quantidade: primeiraFrase(t.fonte_no_app?.contagem_verificada),
      explicacao: [
        `O estudo é ${t.desenho || ""}.`,
        t.fonte_no_app?.ruido_observado || "",
        t.fonte_no_app?.nao_ve ? `A lista não vê ${t.fonte_no_app.nao_ve}` : "",
      ].filter(Boolean).join(" "),
    },
    consulta: consultaExemplo(t),
    variaveis: t.variaveis_exemplo || [],
    hipotese: t.hipotese_exemplo || "",
    limites: (t.limites_exemplo || []).map((l, i) => `${i + 1}. ${l}`).join("\n"),
  };
}

const corta = (t, n = 240) => {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** Os slides do fim, montados direto das respostas, sem IA: é o que a prévia mostra. */
export function slidesDoPlano(tema, r) {
  const fonte = r.fonte && typeof r.fonte === "object" ? r.fonte : { explicacao: r.fonte };
  const consulta = r.consulta && typeof r.consulta === "object" ? r.consulta : { encontrado: r.consulta };
  return {
    titulo: corta(r.pergunta, 160),
    slides: [
      { titulo: "O problema e a pergunta", itens: [corta(tema?.problema, 220), corta(r.pergunta, 220)] },
      {
        titulo: "De onde vêm os processos",
        itens: [corta(fonte.explicacao, 220), fonte.quantidade ? `Voltaram: ${corta(fonte.quantidade, 120)}` : null].filter(Boolean),
      },
      {
        titulo: "Um caso real da lista",
        itens: [consulta.numero ? `Processo ${consulta.numero}` : null, corta(consulta.encontrado, 260)].filter(Boolean),
      },
      {
        titulo: "As variáveis",
        itens: (r.variaveis || []).map((v) => `${v.nome} (${v.tipo}, ${v.papel}): ${corta(v.como_medir, 90)}`),
      },
      { titulo: "Hipóteses e análise", itens: String(r.hipotese || "").split(/\s(?=H1:)/).map((h) => corta(h, 240)) },
      { titulo: "Limitações", itens: String(r.limites || "").split("\n").filter(Boolean).map((l) => corta(l, 200)) },
    ],
  };
}
