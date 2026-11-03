/* ==========================================================================
   Simulador de estratégia de acordo · a tela

   App estático: a simulação roda no navegador (simulacao.js), sem Worker,
   sem login e sem liberação. Feito para a aula convidada na Clínica 2
   (projeto BTG, 19/10/2026), e serve a qualquer aula sobre acordos.
   ========================================================================== */

import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.16/+esm";
import { el, $, limpar, montarTopo, baixar } from "../_shared/ui.js";
import { HORIZONTE, carteira, aceite, simular } from "./simulacao.js";

const VERMELHO = "#e50505";
const CINZA = "#9aa0a8";
const TURQUESA = "#1a9c78";
const LARANJA = "#e68a00";

const CONTROLES = [
  { id: "alcada", nome: "Alçada", ajuda: "fração do valor em risco oferecida no acordo",
    min: 0, max: 1, passo: 0.01, valor: 0.5, fmt: (v) => pct(v) },
  { id: "pmin", nome: "Probabilidade mínima de perda", ajuda: "só recebe proposta quem o modelo diz que perde com pelo menos esta chance",
    min: 0.1, max: 0.9, passo: 0.05, valor: 0.6, fmt: (v) => pct(v) },
  { id: "tentativas", nome: "Propostas por mês", ajuda: "acordo dá trabalho: a equipe só consegue negociar tantos por mês",
    min: 1, max: 50, passo: 1, valor: 30, fmt: (v) => String(v) },
  { id: "orcamento", nome: "Orçamento para acordos", ajuda: "o acordo antecipa o desembolso: quanto o caixa aguenta pagar em acordos",
    min: 1e5, max: 6e6, passo: 1e5, valor: 2e6, fmt: (v) => reais(v) },
];

const AVANCADOS = [
  { id: "juros", nome: "Atualização da condenação (ao ano)", ajuda: "correção mais juros sobre o valor em risco enquanto o processo corre",
    min: 0, max: 0.2, passo: 0.01, valor: 0.12, fmt: (v) => pct(v) },
  { id: "meio", nome: "Alçada em que metade aceita", ajuda: "o centro da curva de aceite",
    min: 0.2, max: 0.8, passo: 0.01, valor: 0.5, fmt: (v) => pct(v) },
  { id: "inclinacao", nome: "Sensibilidade do aceite à alçada", ajuda: "quanto maior, mais a curva parece um degrau",
    min: 2, max: 30, passo: 1, valor: 12, fmt: (v) => String(v) },
  { id: "informacao", nome: "Quanto o autor sabe sobre o próprio caso", ajuda: "0: nada além do modelo. 1: quem ganharia exige bem mais, quem perderia aceita bem menos",
    min: 0, max: 1, passo: 0.1, valor: 0, fmt: (v) => pct(v, 0) },
  { id: "simulacoes", nome: "Repetições da carteira", ajuda: "mais repetições, curvas mais lisas e conta mais lenta",
    min: 50, max: 600, passo: 50, valor: 200, fmt: (v) => String(v) },
];

const estado = { semente: 19, processos: null, resultado: null, varreduraAberta: false };
const params = {};

/* ---------- formatação --------------------------------------------------- */

/* fundo do cartão no tema atual (claro ou escuro), para o contorno dos pontos */
function corFundo() {
  return getComputedStyle(document.documentElement).getPropertyValue("--branco").trim() || "white";
}

function pct(v, casas = 0) {
  return `${(v * 100).toFixed(casas).replace(".", ",")}%`;
}

function reais(v) {
  const a = Math.abs(v);
  const sinal = v < 0 ? "-" : "";
  if (a >= 1e6) return `${sinal}R$ ${(a / 1e6).toFixed(2).replace(".", ",")} mi`;
  if (a >= 1e3) return `${sinal}R$ ${Math.round(a / 1e3)} mil`;
  return `${sinal}R$ ${Math.round(a)}`;
}

function reaisEixo(v) {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace(".", ",")} mi`;
  if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)} mil`;
  return String(v);
}

/* ---------- controles ---------------------------------------------------- */

function controle(c) {
  params[c.id] = c.valor;
  const saida = el("span.valor", { texto: c.fmt(c.valor) });
  const entrada = el("input", { type: "range", min: c.min, max: c.max, step: c.passo,
                               value: c.valor, "aria-label": c.nome });
  entrada.addEventListener("input", () => {
    params[c.id] = Number(entrada.value);
    saida.textContent = c.fmt(params[c.id]);
    agendar();
  });
  return el("div.controle", {}, [
    el("label", {}, [el("span", { texto: c.nome }), saida]),
    entrada,
    el("div.ajuda", { texto: c.ajuda }),
  ]);
}

function montarControles() {
  const caixa = limpar($("#controles"));
  CONTROLES.forEach((c) => caixa.append(controle(c)));
  const det = el("details.avancado", {}, [el("summary", { texto: "Parâmetros avançados" })]);
  AVANCADOS.forEach((c) => det.append(controle(c)));
  caixa.append(det);
}

/* ---------- recalcular sem travar o arrasto ------------------------------ */

let pendente = false;
function agendar() {
  if (pendente) return;
  pendente = true;
  requestAnimationFrame(() => {
    pendente = false;
    calcular();
  });
}

function calcular() {
  estado.resultado = simular(estado.processos, params);
  desenharIndicadores();
  desenharAceite();
  desenharEconomia();
  desenharGastos();
  desenharTabela();
  if (estado.varreduraAberta) desenharVarredura();
}

/* ---------- indicadores -------------------------------------------------- */

function indicador(rotulo, numero, nota, tipo) {
  return el(`div.indicador.${tipo}`, {}, [
    el("div.rotulo", { texto: rotulo }),
    el("div.numero", { texto: numero }),
    el("div.nota", { texto: nota }),
  ]);
}

function desenharIndicadores() {
  const r = estado.resultado;
  const caixa = limpar($("#indicadores"));
  caixa.append(
    indicador("economia em 60 meses", reais(r.final),
      r.final >= 0 ? "a estratégia compensa no horizonte" : "a estratégia dá prejuízo no horizonte",
      r.final >= 0 ? "bom" : "ruim"),
    indicador("pior momento", r.vale.economia < 0 ? reais(r.vale.economia) : "nenhum",
      r.vale.economia < 0 ? `no mês ${r.vale.mes}: o desembolso antecipado` : "a economia nunca fica negativa",
      r.vale.economia < 0 ? "ruim" : "bom"),
    indicador("payback", r.payback ? `mês ${r.payback.mes}` : (r.vale.economia < 0 ? "não chega" : "imediato"),
      "quando a economia acumulada volta a zero", r.payback || r.vale.economia >= 0 ? "neutro" : "ruim"),
    indicador("acordos fechados", `${Math.round(r.acordos)} de ${r.alvo.length}`,
      `${reais(r.gastoAcordo)} pagos em acordos, em média`, "neutro"),
  );
}

/* ---------- gráficos ----------------------------------------------------- */

function largura(id) {
  return Math.max(320, Math.min(980, $(id).clientWidth || 640));
}

function desenharAceite() {
  const curva = [];
  for (let a = 0; a <= 1.0001; a += 0.01) {
    curva.push({ alcada: a, p: aceite(a, params.meio, params.inclinacao) });
  }
  const atual = { alcada: params.alcada, p: aceite(params.alcada, params.meio, params.inclinacao) };
  const g = Plot.plot({
    width: largura("#g-aceite"), height: 200, marginLeft: 44,
    x: { label: "alçada (fração do valor em risco)", tickFormat: (v) => pct(v), domain: [0, 1] },
    y: { label: "chance de aceite", tickFormat: (v) => pct(v), domain: [0, 1], grid: true },
    marks: [
      Plot.line(curva, { x: "alcada", y: "p", stroke: CINZA, strokeWidth: 2 }),
      Plot.ruleX([atual], { x: "alcada", y1: 0, y2: "p", stroke: VERMELHO, strokeDasharray: "3 3" }),
      Plot.dot([atual], { x: "alcada", y: "p", r: 6, fill: VERMELHO, stroke: corFundo(), strokeWidth: 2 }),
      Plot.text([atual], { x: "alcada", y: "p", text: (d) => `${pct(d.p)} aceitam`,
                           dx: 10, textAnchor: "start", fontSize: 12, fontWeight: 700 }),
    ],
  });
  limpar($("#g-aceite")).append(g);
}

function desenharEconomia() {
  const r = estado.resultado;
  const dados = r.meses;
  const marcos = [];
  if (r.vale.economia < 0) marcos.push({ ...r.vale, nome: `pior momento, mês ${r.vale.mes}`, cor: VERMELHO });
  if (r.payback) marcos.push({ ...r.payback, nome: `payback, mês ${r.payback.mes}`, cor: LARANJA });
  marcos.push({ ...dados[dados.length - 1], nome: `final: ${reais(r.final)}`, cor: TURQUESA });

  const g = Plot.plot({
    width: largura("#g-economia"), height: 330, marginLeft: 60, marginRight: 24,
    x: { label: "meses desde o início da estratégia", domain: [1, HORIZONTE] },
    y: { label: "economia acumulada (R$)", tickFormat: reaisEixo, grid: true, insetBottom: 26 },
    marks: [
      Plot.areaY(dados, { x: "mes", y: (d) => Math.min(0, d.economia), fill: VERMELHO, fillOpacity: 0.12 }),
      Plot.areaY(dados, { x: "mes", y: (d) => Math.max(0, d.economia), fill: TURQUESA, fillOpacity: 0.15 }),
      Plot.ruleY([0], { stroke: "currentColor" }),
      Plot.line(dados, { x: "mes", y: "economia", stroke: "currentColor", strokeWidth: 2.5 }),
      Plot.dot(marcos, { x: "mes", y: "economia", r: 6, fill: "cor", stroke: corFundo(), strokeWidth: 2 }),
      ...marcos.map((d) => Plot.text([d], { x: "mes", y: "economia", text: "nome", fill: d.cor,
        fontSize: 12, fontWeight: 700, dx: d.mes > 50 ? -10 : 10, dy: 16,
        textAnchor: d.mes > 50 ? "end" : "start", stroke: corFundo(), strokeWidth: 4, paintOrder: "stroke" })),
      Plot.tip(dados, Plot.pointerX({ x: "mes", y: "economia",
        title: (d) => `mês ${d.mes}\neconomia acumulada: ${reais(d.economia)}\nsem acordo: ${reais(d.sem)}\ncom acordo: ${reais(d.com)}` })),
    ],
  });
  limpar($("#g-economia")).append(g);

  const caixa = limpar($("#marcos"));
  caixa.append(
    el("div.marco", { style: `--c:${VERMELHO}` }, [
      el("strong", { texto: "Prejuízo no início" }),
      el("span", { texto: "Os acordos são pagos já, e as condenações evitadas só venceriam depois: a economia começa negativa." }),
    ]),
    el("div.marco", { style: `--c:${LARANJA}` }, [
      el("strong", { texto: "Break-even e payback" }),
      el("span", { texto: "No pior momento a curva vira e passa a subir (break-even). No payback, o que foi evitado já cobre o que foi antecipado." }),
    ]),
    el("div.marco", { style: `--c:${TURQUESA}` }, [
      el("strong", { texto: "Economia final" }),
      el("span", { texto: "Depois que todos os processos da carteira terminam, o que sobra é o ganho (ou a perda) da estratégia." }),
    ]),
  );
}

function desenharGastos() {
  const longo = estado.resultado.meses.flatMap((d) => [
    { mes: d.mes, gasto: d.sem, cenario: "sem acordo" },
    { mes: d.mes, gasto: d.com, cenario: "com a estratégia de acordo" },
  ]);
  const g = Plot.plot({
    width: largura("#g-gastos"), height: 260, marginLeft: 60,
    x: { label: "meses", domain: [1, HORIZONTE] },
    y: { label: "gasto acumulado (R$)", tickFormat: reaisEixo, grid: true },
    color: { domain: ["sem acordo", "com a estratégia de acordo"], range: [CINZA, VERMELHO] },
    marks: [
      Plot.line(longo, { x: "mes", y: "gasto", stroke: "cenario", strokeWidth: 2.5 }),
      Plot.tip(longo, Plot.pointerX({ x: "mes", y: "gasto", stroke: "cenario",
        title: (d) => `${d.cenario}\nmês ${d.mes}: ${reais(d.gasto)}` })),
    ],
  });
  limpar($("#g-gastos")).append(g);
}

function desenharVarredura() {
  const pontos = [];
  for (let a = 0.2; a <= 1.0001; a += 0.05) {
    const r = simular(estado.processos, { ...params, alcada: a, simulacoes: Math.min(120, params.simulacoes) });
    pontos.push({ alcada: Math.round(a * 100) / 100, final: r.final });
  }
  const melhor = pontos.reduce((m, x) => (x.final > m.final ? x : m));
  const atual = { alcada: params.alcada, final: estado.resultado.final };
  const g = Plot.plot({
    width: largura("#g-varredura"), height: 280, marginLeft: 60,
    x: { label: "alçada", tickFormat: (v) => pct(v), domain: [0.2, 1] },
    y: { label: "economia em 60 meses (R$)", tickFormat: reaisEixo, grid: true },
    marks: [
      Plot.ruleY([0], { stroke: "currentColor" }),
      Plot.line(pontos, { x: "alcada", y: "final", stroke: CINZA, strokeWidth: 2, curve: "monotone-x" }),
      Plot.dot(pontos, { x: "alcada", y: "final", r: 3.5, fill: CINZA }),
      Plot.dot([melhor], { x: "alcada", y: "final", r: 7, fill: TURQUESA, stroke: corFundo(), strokeWidth: 2 }),
      Plot.text([melhor], { x: "alcada", y: "final", text: (d) => `melhor: ${pct(d.alcada)}`, dy: -14,
                            fill: TURQUESA, fontWeight: 700, fontSize: 12 }),
      Plot.dot([atual], { x: "alcada", y: "final", r: 6, fill: VERMELHO, stroke: corFundo(), strokeWidth: 2 }),
      Plot.text([atual], { x: "alcada", y: "final", text: () => "sua alçada", dy: 16, fill: VERMELHO, fontSize: 11 }),
      Plot.tip(pontos, Plot.pointerX({ x: "alcada", y: "final",
        title: (d) => `alçada ${pct(d.alcada)}\neconomia: ${reais(d.final)}` })),
    ],
  });
  limpar($("#g-varredura")).append(g);
}

/* ---------- tabela e CSV ------------------------------------------------- */

function desenharTabela() {
  const alvo = estado.resultado.alvo;
  $("#dica-processos").textContent = `${alvo.length} de ${estado.processos.length} processos`;
  const linhas = alvo.slice(0, 12).map((x) =>
    el("tr", {}, [
      el("td", { texto: x.id }),
      el("td", {}, [el("span.barra-p", { style: `width:${Math.round(x.p * 60)}px` }), document.createTextNode(pct(x.p))]),
      el("td", { texto: reais(x.valor) }),
      el("td", { texto: reais(x.valor * params.alcada) }),
      el("td", { texto: `mês ${x.mes}` }),
    ]));
  const tabela = el("table.processos", {}, [
    el("thead", {}, [el("tr", {}, ["processo", "prob. de perda", "valor em risco", "proposta", "decisão final sem acordo"]
      .map((t) => el("th", { texto: t })))]),
    el("tbody", {}, linhas),
  ]);
  const caixa = limpar($("#tabela"));
  caixa.append(tabela);
  if (alvo.length > 12) caixa.append(el("p.miudo", { texto: `e mais ${alvo.length - 12} no CSV.` }));
  $("#semente").textContent = `carteira nº ${estado.semente}`;
}

function csv() {
  const linhas = [["processo", "prob_perda", "valor_em_risco", "proposta", "mes_decisao_sem_acordo"]];
  for (const x of estado.resultado.alvo) {
    linhas.push([x.id, x.p.toFixed(3), x.valor.toFixed(2), (x.valor * params.alcada).toFixed(2), x.mes]);
  }
  baixar(`estrategia_acordo_carteira${estado.semente}.csv`, linhas.map((l) => l.join(",")).join("\n"),
         "text/csv;charset=utf-8", true);
}

/* ---------- arranque ----------------------------------------------------- */

montarTopo({ exercicio: "Clínica BTG", aula: "19/10", titulo: "Simulador de estratégia de acordo" });
montarControles();
estado.processos = carteira(estado.semente);

$("#b-varredura").addEventListener("click", () => {
  estado.varreduraAberta = !estado.varreduraAberta;
  $("#g-varredura").classList.toggle("oculto", !estado.varreduraAberta);
  $("#b-varredura").textContent = estado.varreduraAberta
    ? "Esconder a curva" : "Mostrar a economia para todas as alçadas";
  if (estado.varreduraAberta) desenharVarredura();
});
$("#b-csv").addEventListener("click", csv);
$("#b-carteira").addEventListener("click", () => {
  estado.semente = 1 + Math.floor(Math.random() * 9999);
  estado.processos = carteira(estado.semente);
  calcular();
});
window.addEventListener("resize", () => agendar());
window.addEventListener("tema", () => agendar());

calcular();
