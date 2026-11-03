/* ==========================================================================
   Projeto 6, versão para casa (ex06b) - Do modelo ao corte: execução fiscal.

   O mesmo exercício do ex06 (apps/ex06-onde-colocar-o-corte), com outro tema e
   outros números, para quem faz o projeto em casa em 27/10, das 13:00 às 19:00.
   Este arquivo é uma cópia adaptada do app.js do ex06: mudam os textos do caso,
   os dados (scripts/gerar_dados_ex06b.py), a rubrica (rubricas/ex06b-modelos.json)
   e entra um contador de 1 hora.

   O caso: toda execução fiscal nova recebe a pesquisa automática de bens; o que
   se decide é quais recebem também a investigação patrimonial aprofundada, feita
   por um analista da Procuradoria (150 por mês, para 1.000 execuções).

   O contador: a hora começa quando o aluno se identifica, e o início fica
   guardado no navegador (por e-mail) e registrado no banco (etapa "inicio"),
   para valer mesmo que a página seja recarregada. Quando a hora acaba, ou às
   19:00, o que vier primeiro, os campos travam e a entrega é gerada sozinha.
   O feedback automático usa a mesma tarefa do ex06 no Worker (ex06_feedback).
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import { ativar } from "../_shared/guardrails.js";
import { exigirIdentificacao, chaveDoGrupo } from "../_shared/identidade.js";
import { registrarSubmissao } from "../_shared/firebase.js";
import { exigirLiberacao, formatarData } from "../_shared/liberacao.js";
import { carregar } from "../_shared/pyodide.js";
import {
  painelRubrica, contadorTentativas, avisoTentativasEsgotadas, painelFeedback,
} from "../_shared/rubrica.js";
import {
  chamar, rubricaEmTexto, criterioDaRubrica, ESQUEMA_FEEDBACK, SISTEMA_FEEDBACK,
} from "../_shared/llm.js";
import {
  $, $$, el, limpar, aviso, toast, montarTopo, montarPassos, tabela, baixar, sha256,
  paragrafos, contarPalavras, agora, pct,
} from "../_shared/ui.js";

const EXERCICIO = "ex06b";
const DURACAO_MS = 60 * 60 * 1000;   // 1 hora a partir de quando o aluno se identifica
// sem o limite de 1 hora, só o prazo final (combinado pelo professor em 03/11/2026);
// sha256 do e-mail, para o e-mail não ficar no site público
const SEM_LIMITE_DE_HORA = new Set(["8aabfa01efe234f74aa4a1a0211715a4a2b1624c2777ded1e2af7ce470fe1f39"]);

const estado = {
  identidade: null,
  guarda: null,
  config: null,
  cenario: null,
  saidas: null,
  rubrica: null,
  casos: [],          // {y, p}
  corte: 0.5,
  respostas: {},      // por etapa: campos, feedbacks, tentativas
  observacoes: "",    // discordâncias com o feedback automático, na entrega
  confirmarIncompleta: false,
  passos: null,
  fimEm: null,        // ms: o menor entre início + 1 hora e o prazo final
  encerrado: false,
  temporizador: null,
};

/* ---------- arranque ---------------------------------------------------- */

async function iniciar() {
  montarTopo({
    exercicio: "Projeto 6",
    aula: "versão para casa",
    titulo: "Do modelo ao corte: execução fiscal",
  });
  const liberacao = await exigirLiberacao(EXERCICIO);
  if (!liberacao.liberado) return;
  const prazo = paraData(liberacao.entrega_em);
  if (prazo && Date.now() > prazo.getTime() && !liberacao.porProfessor) {
    limpar($("main")).append(
      aviso("atencao", "Exercício encerrado",
        `A versão para casa do Projeto 6 fechou em ${formatarData(liberacao.entrega_em)}.`)
    );
    return;
  }

  estado.passos = montarPassos(["base", "linear", "logística", "corte", "entrega"]);
  estado.passos.ir(0);

  estado.identidade = await exigirIdentificacao({
    exercicio: EXERCICIO,
    emGrupo: false,
    titulo: "Projeto 6 · quem está fazendo",
    explicacao:
      "Trabalho individual. Coloque o seu e-mail do Insper. A partir daqui, você tem 1 hora " +
      "(ou até as 19:00, o que vier antes). Cópia e cola estão bloqueados: as respostas têm " +
      "que ser escritas aqui.",
  });
  estado.guarda = ativar({ exercicio: EXERCICIO });
  await iniciarContador(prazo, liberacao.porProfessor);

  const [config, cenario, saidas, csv, rubrica] = await Promise.all([
    fetch("etapas.json").then((r) => r.json()),
    fetch("dados/cenario.json").then((r) => r.json()),
    fetch("dados/saidas.json").then((r) => r.json()),
    fetch("dados/triagem_pge.csv").then((r) => r.text()),
    fetch("../rubricas/ex06b-modelos.json").then((r) => r.json()),
  ]);
  estado.config = config;
  estado.cenario = cenario;
  estado.saidas = saidas;
  estado.rubrica = rubrica;
  estado.casos = lerCSV(csv);

  montarBase();
  for (const etapa of config.etapas) {
    estado.respostas[etapa.id] = {
      campos: Object.fromEntries(etapa.campos.map((c) => [c.id, ""])),
      feedbacks: [],
      tentativas: contadorTentativas(config.limites.max_avaliacoes_por_etapa),
    };
    montarEtapa(etapa);
  }
  $("#slider").addEventListener("input", (e) => {
    estado.corte = Number(e.target.value);
    atualizarCorte();
    atualizarProgresso();
  });
  $("#observacoes").addEventListener("input", (e) => { estado.observacoes = e.target.value; });
  $("#b-fechar").addEventListener("click", () => fechar());
  atualizarCorte();
  atualizarProgresso();
}

function lerCSV(texto) {
  const [cabecalho, ...linhas] = texto.trim().split(/\r?\n/);
  const colunas = cabecalho.split(",");
  const iY = colunas.indexOf("precisa_investigacao");
  const iP = colunas.indexOf("prob");
  return linhas.map((linha) => {
    const campos = linha.split(",");
    return { y: Number(campos[iY]), p: Number(campos[iP]) };
  });
}

/** Rubrica só com os critérios de uma etapa, mais o de correspondência. */
function rubricaDaEtapa(etapa) {
  return {
    ...estado.rubrica,
    criterios: estado.rubrica.criterios.filter((c) => c.etapa === etapa.id || c.etapa === "todas"),
  };
}

/* ---------- contador de 1 hora ------------------------------------------ */

/** "2026-10-27T19:00" (hora de Brasília) em Date, como no ex05b. */
function paraData(texto) {
  return texto ? new Date(`${texto}:00-03:00`) : null;
}

/**
 * O início fica no navegador, por e-mail, para que recarregar a página não
 * zere a hora, e vai para o banco na primeira vez, para o professor conferir.
 */
async function iniciarContador(prazo, porProfessor) {
  const chave = `cdad2:ex06b:inicio:${estado.identidade.email}`;
  let inicio = null;
  try { inicio = Number(localStorage.getItem(chave)) || null; } catch { /* sem armazenamento */ }
  if (!inicio) {
    inicio = Date.now();
    try { localStorage.setItem(chave, String(inicio)); } catch { /* sem armazenamento */ }
    registrarSubmissao({
      exercicio: EXERCICIO, etapa: "inicio", identificacao: estado.identidade,
      inicio: new Date(inicio).toISOString(),
    }).catch(() => {});
  }
  const semLimite = SEM_LIMITE_DE_HORA.has(await sha256(estado.identidade.email.trim().toLowerCase()));
  estado.fimEm = semLimite && prazo ? prazo.getTime() : inicio + DURACAO_MS;
  if (prazo && !porProfessor) estado.fimEm = Math.min(estado.fimEm, prazo.getTime());
  estado.temporizador = setInterval(tique, 1000);
  tique();
}

function tique() {
  const restante = estado.fimEm - Date.now();
  const relogio = $("#cronometro");
  if (restante <= 0) {
    relogio.textContent = "00:00";
    if (!estado.encerrado) encerrarPorTempo();
    return;
  }
  const min = Math.floor(restante / 60000);
  const seg = Math.floor((restante % 60000) / 1000);
  relogio.textContent = `${String(min).padStart(2, "0")}:${String(seg).padStart(2, "0")}`;
  relogio.classList.toggle("pouco", restante < 5 * 60000);
}

async function encerrarPorTempo() {
  estado.encerrado = true;
  clearInterval(estado.temporizador);
  toast("O tempo acabou. Gerando a entrega com o que está escrito.");
  // espera a montagem terminar, caso o tempo já tenha acabado ao abrir a página
  while (!estado.config) await new Promise((ok) => setTimeout(ok, 200));
  await new Promise((ok) => setTimeout(ok, 0));
  $$("textarea").forEach((t) => { t.disabled = true; });
  $$("button.principal").forEach((b) => { b.disabled = true; });
  $("#slider").disabled = true;
  await fechar({ forcado: true });
}

/* ---------- a base ------------------------------------------------------ */

function montarBase() {
  const c = estado.cenario;
  const cab = estado.saidas.cabeca;
  const descricao = el("div.rolagem", {}, [
    el("table", {}, [
      el("thead", {}, [el("tr", {}, ["coluna", "descrição"].map((t) => el("th", { texto: t })))]),
      el("tbody", {}, Object.entries(c.variaveis).map(([nome, texto]) =>
        el("tr", {}, [el("td", {}, [el("code", { texto: nome })]), el("td", { texto })])
      )),
    ]),
  ]);
  const linhas = cab.linhas.map((v) => Object.fromEntries(cab.colunas.map((col, i) => [col, v[i]])));
  const primeiras = el("div.primeiras-linhas", {}, [
    el("pre", {}, [el("code", { texto: "concluidas.head(8)" })]),
    tabela(cab.colunas, linhas, { numericas: cab.colunas.filter((col) => col !== "id") }),
  ]);

  const paineis = { descricao, primeiras };
  const corpo = el("div");
  const abas = el("div.abas", { role: "tablist" });
  const mostrar = (qual) => {
    $$("button", abas).forEach((b) => b.classList.toggle("ativa", b.dataset.aba === qual));
    corpo.replaceChildren(paineis[qual]);
  };
  for (const [id, rotulo] of [["descricao", "Descrição das colunas"], ["primeiras", "Primeiras linhas"]]) {
    abas.append(el("button", { type: "button", role: "tab", dataset: { aba: id }, texto: rotulo,
      onclick: () => mostrar(id) }));
  }
  mostrar("descricao");

  limpar($("#resumo-base")).append(
    el("p.enunciado", {
      html: paragrafos(
        `Duas bases com as mesmas colunas. **concluidas**: ${c.n_concluidas.toLocaleString("pt-BR")} ` +
          "execuções já encerradas, em que se sabe em quais a investigação aprofundada acharia bens; é nela " +
          `que os modelos das etapas 01 e 02 foram ajustados. **mês de referência**: ${c.n_processos_mes.toLocaleString("pt-BR")} ` +
          "execuções novas, que o modelo não viu; é nelas que o corte da etapa 03 é avaliado. " +
          `Em ${pct(c.prevalencia, 1)} das execuções do mês, a investigação aprofundada era necessária.`
      ),
    }),
    el("div.ficha", {}, [abas, corpo]),
    el("p.miudo", {
      texto:
        `${c.aviso} O rótulo "precisava de investigação aprofundada" é, por construção, o que o ` +
        "simulador definiu como verdade: na vida real, seria a opinião de alguém.",
    })
  );
}

/* ---------- uma etapa: pergunta, saída, itens e feedback ---------------- */

function montarEtapa(etapa) {
  const alvo = limpar($(`#etapa-${etapa.id}`));
  const r = estado.respostas[etapa.id];

  if (etapa.saida) {
    const s = estado.saidas[etapa.saida];
    alvo.append(
      el("p.pergunta-etapa", { texto: etapa.pergunta }),
      el("details.ficha", { style: "margin-bottom:.6rem" }, [
        el("summary", { texto: "código executado" }),
        el("pre", {}, [el("code", { texto: s.codigo })]),
      ]),
      el("span.rotulo", { texto: "saída do Python" }),
      el("pre.saida", {}, [el("code", { texto: s.texto })]),
      el("hr.regua")
    );
  } else {
    limpar($(`#pergunta-${etapa.id}`)).append(
      ...(etapa.contexto || []).map((t) => el("p.enunciado", { html: paragrafos(t) })),
      el("p.pergunta-etapa", { texto: etapa.pergunta })
    );
  }

  const campos = el("div.campos");
  for (const c of etapa.campos) {
    const area = el("textarea", {
      id: `c-${etapa.id}-${c.id}`,
      rows: "3",
      maxlength: String(estado.config.limites.max_caracteres_campo),
      spellcheck: "true",
    });
    area.addEventListener("input", () => {
      r.campos[c.id] = area.value;
      atualizarProgresso();
    });
    campos.append(
      el("div.campo", {}, [
        el("label.rotulo", { for: area.id, texto: c.rotulo }),
        el("p.miudo", { texto: c.ajuda }),
        area,
        c.calculadora ? montarCalculadora() : null,
      ])
    );
  }

  const botao = el("button.principal", { type: "button", texto: "Pedir feedback desta etapa" });
  const status = el("span.miudo");
  const painel = el("div", { style: "margin-top:1rem" });
  botao.addEventListener("click", () => {
    if (!estado.encerrado) pedirFeedback(etapa, { botao, status, painel });
  });

  alvo.append(
    el("div", {}, [painelRubrica(rubricaDaEtapa(etapa), { mostrarInstrucoes: false })]),
    campos,
    el("div.acoes", { style: "margin-top:.3rem" }, [botao, status]),
    painel
  );
  r.tentativas.aplicar($(`#contador-${etapa.id}`), botao);
}

function completa(etapa) {
  const r = estado.respostas[etapa.id];
  return etapa.campos.every((c) => contarPalavras(r.campos[c.id]) > 0);
}

function atualizarProgresso() {
  const etapas = estado.config.etapas;
  const prontas = etapas.filter(completa).length;
  limpar($("#resumo-entrega")).append(
    el("p.enunciado", {
      style: "margin:0",
      texto: prontas === etapas.length
        ? `As três etapas estão respondidas, com o corte em ${virgula(estado.corte)}. ` +
          "Gere a entrega e envie o markdown no BlackBoard."
        : `${prontas} de ${etapas.length} etapas com todos os itens respondidos. O corte que ` +
          `vai na entrega é o que estiver no slider da etapa 03 (agora, ${virgula(estado.corte)}).`,
    })
  );
  estado.confirmarIncompleta = false;
  $("#b-fechar").textContent = "Fechar e gerar a entrega";
}

const virgula = (v) => v.toFixed(2).replace(".", ",");

/* ---------- calculadora em Python (item 3b) ------------------------------ */

/**
 * Uma célula de Python para fazer contas, como no Colab. Antes de cada rodada,
 * vp, fp, fn e vn recebem os números do corte que está no slider. Mostra o
 * que for impresso e, como no notebook, o valor da última linha.
 */
function montarCalculadora() {
  const codigo = el("textarea.codigo", {
    rows: "4", spellcheck: "false", autocapitalize: "off", "aria-label": "código Python",
  });
  codigo.value = "# vp, fp, fn e vn já valem os números do corte escolhido\nvp / (vp + fp)";
  const saida = el("pre.saida.calc", {}, [el("code", { texto: "(aperte Rodar ou Ctrl+Enter)" })]);
  const status = el("span.miudo");
  const botao = el("button", { type: "button", texto: "Rodar" });

  const rodarCelula = async () => {
    botao.disabled = true;
    status.replaceChildren(el("span.carregando", { texto: "rodando" }));
    try {
      const py = await carregar({
        aoProgresso: (texto) => status.replaceChildren(el("span.carregando", { texto })),
      });
      const c = confusao(estado.corte);
      py.globals.set("_codigo", codigo.value);
      for (const k of ["vp", "fp", "fn", "vn"]) py.globals.set(k, c[k]);
      const texto = await py.runPythonAsync(`
import io, contextlib, traceback
from pyodide.code import eval_code
_buf = io.StringIO()
try:
    with contextlib.redirect_stdout(_buf):
        _valor = eval_code(_codigo, globals())
    if _valor is not None:
        print(repr(_valor), file=_buf)
except Exception:
    _buf.write(traceback.format_exc(limit=0))
_buf.getvalue()
`);
      saida.firstChild.textContent = texto || "(nada para mostrar: escreva uma conta ou use print)";
      status.replaceChildren(el("span.miudo", {
        texto: `corte ${virgula(c.corte)}: vp=${c.vp}, fp=${c.fp}, fn=${c.fn}, vn=${c.vn}`,
      }));
    } catch (erro) {
      saida.firstChild.textContent = String(erro.message || erro);
      status.replaceChildren(el("span.etiqueta.erro", { texto: "erro" }));
    } finally {
      botao.disabled = false;
    }
  };
  botao.addEventListener("click", rodarCelula);
  codigo.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      rodarCelula();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      codigo.setRangeText("    ", codigo.selectionStart, codigo.selectionEnd, "end");
    }
  });

  return el("details.ficha.calculadora", {}, [
    el("summary", { texto: "calculadora em Python" }),
    el("p.miudo", {
      html: paragrafos(
        "Escreva contas como no Colab: `vp / (vp + fn)`, `150 - (vp + fp)`, `print(...)`. As variáveis " +
          "`vp`, `fp`, `fn` e `vn` já valem os números da matriz no corte escolhido. Na primeira vez, o " +
          "Python do navegador leva alguns segundos para carregar."
      ),
    }),
    codigo,
    el("div.acoes", { style: "margin-top:.3rem" }, [botao, status]),
    saida,
  ]);
}

/* ---------- métricas do corte ------------------------------------------- */

function confusao(corte) {
  let vp = 0, fp = 0, vn = 0, fn = 0;
  for (const caso of estado.casos) {
    const aprofundado = caso.p >= corte;
    if (aprofundado && caso.y === 1) vp += 1;
    else if (aprofundado && caso.y === 0) fp += 1;
    else if (!aprofundado && caso.y === 1) fn += 1;
    else vn += 1;
  }
  const n = vp + fp + vn + fn;
  return {
    corte, vp, fp, vn, fn, n,
    acuracia: (vp + vn) / n,
    precisao: vp + fp ? vp / (vp + fp) : null,
    sensibilidade: vp + fn ? vp / (vp + fn) : null,
    especificidade: vn + fp ? vn / (vn + fp) : null,
    aprofundados: vp + fp,
  };
}

function textoMetricas(c) {
  const ou = (v) => (v == null ? "indefinida" : pct(v, 1));
  return [
    `- corte: ${virgula(c.corte)} (vão à investigação aprofundada as execuções com probabilidade igual ou acima disso)`,
    `- verdadeiros positivos: ${c.vp} (precisavam e foram à investigação aprofundada)`,
    `- falsos positivos: ${c.fp} (foram à investigação aprofundada sem precisar)`,
    `- falsos negativos: ${c.fn} (precisavam e ficaram só com a pesquisa automática)`,
    `- verdadeiros negativos: ${c.vn}`,
    `- acurácia: ${pct(c.acuracia, 1)}`,
    `- precisão: ${ou(c.precisao)}`,
    `- sensibilidade (recall): ${ou(c.sensibilidade)}`,
    `- especificidade: ${ou(c.especificidade)}`,
    `- investigações aprofundadas no mês: ${c.aprofundados}, para uma capacidade de ${estado.cenario.capacidade_analise_mes}`,
  ].join("\n");
}

function atualizarCorte() {
  const c = confusao(estado.corte);
  $("#valor-corte").textContent = virgula(estado.corte);
  $("#nota-corte").textContent =
    `${c.aprofundados} de ${c.n} execuções vão à investigação aprofundada: ${c.vp} + ${c.fp}, ` +
    'a linha "foi à investigação aprofundada" da matriz';

  limpar($("#matriz")).append(
    el("thead", {}, [
      el("tr", {}, [
        el("th", { texto: "" }),
        el("th", { texto: "precisava de investigação aprofundada" }),
        el("th", { texto: "não precisava" }),
      ]),
    ]),
    el("tbody", {}, [
      el("tr", {}, [
        el("th", { texto: "foi à investigação aprofundada" }),
        el("td.celula.vp", { html: `${c.vp}<span class="cod">verdadeiro positivo</span>` }),
        el("td.celula.fp", { html: `${c.fp}<span class="cod">falso positivo</span>` }),
      ]),
      el("tr", {}, [
        el("th", { texto: "ficou só com a pesquisa automática" }),
        el("td.celula.fn", { html: `${c.fn}<span class="cod">falso negativo</span>` }),
        el("td.celula.vn", { html: `${c.vn}<span class="cod">verdadeiro negativo</span>` }),
      ]),
    ])
  );

  const capacidade = estado.cenario.capacidade_analise_mes;
  const excedente = c.aprofundados - capacidade;
  const traducao = limpar($("#traducao"));
  // Sem verde e vermelho: a cor diria ao aluno qual corte é o certo.
  for (const [valor, texto] of [
    [c.fn, "execuções precisavam da investigação e ficaram só com a pesquisa automática (FN)"],
    [c.fp, "investigações aprofundadas feitas sem achar nada novo, consumindo horas de analista (FP)"],
    [
      c.aprofundados,
      `investigações aprofundadas no mês (VP + FP = ${c.vp} + ${c.fp}), para uma capacidade de ${capacidade}` +
        (excedente > 0 ? ` (passa ${excedente} da capacidade)` : ` (sobram ${-excedente} vagas)`),
    ],
  ]) {
    traducao.append(el("div.linha", {}, [el("span.valor", { texto: String(valor) }), el("span", { texto })]));
  }
  desenharDistribuicao();
}

/**
 * Faixa alinhada ao slider. Sem ela, o corte 0,50 parece uma escolha neutra,
 * quando está fora da massa de probabilidades que o modelo produz.
 */
function desenharDistribuicao() {
  const canvas = $("#distribuicao");
  const ctx = canvas.getContext("2d");
  const L = 8, R = 8, T = 8, B = 32;
  const largura = canvas.width - L - R;
  const altura = canvas.height - T - B;
  const nCaixas = 50;
  const caixas = new Array(nCaixas).fill(0);
  const positivas = new Array(nCaixas).fill(0);
  for (const caso of estado.casos) {
    const i = Math.min(nCaixas - 1, Math.floor(caso.p * nCaixas));
    caixas[i] += 1;
    if (caso.y === 1) positivas[i] += 1;
  }
  const maior = Math.max(...caixas) || 1;
  // cores do tema atual (claro ou escuro), lidas da folha de estilo
  const css = getComputedStyle(document.documentElement);
  const cor = (nome, padrao) => css.getPropertyValue(nome).trim() || padrao;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const larguraCaixa = largura / nCaixas;
  for (let i = 0; i < nCaixas; i += 1) {
    const x = L + i * larguraCaixa;
    const h = (caixas[i] / maior) * altura;
    ctx.fillStyle = cor("--cinza-200", "#dcdcdc");
    ctx.fillRect(x, T + altura - h, larguraCaixa - 0.7, h);
    const hp = (positivas[i] / maior) * altura;
    ctx.fillStyle = cor("--vermelho-escuro", "#7a1020");
    ctx.fillRect(x, T + altura - hp, larguraCaixa - 0.7, hp);
  }
  const xCorte = L + estado.corte * largura;
  ctx.strokeStyle = cor("--vermelho", "#e50505");
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(xCorte, T);
  ctx.lineTo(xCorte, T + altura);
  ctx.stroke();

  ctx.fillStyle = cor("--cinza-600", "#808080");
  ctx.font = "10px ui-monospace, Consolas, monospace";
  for (const marca of [0, 0.25, 0.5, 0.75, 1]) {
    ctx.fillText(marca.toFixed(2).replace(".", ","), L + marca * largura - 10, canvas.height - 20);
  }
  ctx.fillStyle = cor("--grafite", "#3f3f3f");
  ctx.fillText("cinza: todas as execuções · vinho: as que precisavam da investigação", L, canvas.height - 5);
}

/* ---------- feedback ---------------------------------------------------- */

async function pedirFeedback(etapa, { botao, status, painel }) {
  const r = estado.respostas[etapa.id];
  const rubrica = rubricaDaEtapa(etapa);
  if (r.tentativas.esgotou) {
    limpar(painel).append(avisoTentativasEsgotadas(r.tentativas.maximo));
    return;
  }
  const vazios = etapa.campos.filter((c) => !contarPalavras(r.campos[c.id]));
  if (vazios.length) {
    limpar(painel).append(
      aviso("atencao", "Falta responder antes de pedir feedback:", vazios.map((c) => `- ${c.rotulo}`).join("\n"))
    );
    toast("Veja o que falta, logo abaixo do botão.");
    return;
  }

  botao.disabled = true;
  status.replaceChildren(el("span.carregando", { texto: "avaliando" }));
  estado.passos.ir(estado.config.etapas.indexOf(etapa) + 1);

  const nomeCriterio = (id) => criterioDaRubrica(rubrica, id)?.nome || id;
  const evidencia = etapa.saida
    ? ["SAÍDA DO PYTHON (é contra estes números que você deve conferir as respostas):",
       estado.saidas[etapa.saida].texto]
    : ["MÉTRICAS NO CORTE ESCOLHIDO (é contra estes números que você deve conferir as respostas):",
       textoMetricas(confusao(estado.corte)),
       "",
       `CONTEXTO: das ${estado.casos.length} execuções do mês, ` +
         `${estado.casos.filter((c) => c.y === 1).length} precisavam de investigação aprofundada. ` +
         'O modelo trivial "nunca aprofunda" (slider em 1,00) tem a matriz ' +
         `VP 0, FP 0, FN ${confusao(1).fn}, VN ${confusao(1).vn}, acurácia de ` +
         `${pct(estado.cenario.acuracia_modelo_trivial, 1)} e sensibilidade 0%. O app NÃO mostra as métricas: ` +
         "o aluno as calcula a partir da matriz."];
  const usuario = [
    `ETAPA: ${etapa.titulo}`,
    `PERGUNTA: ${etapa.pergunta}`,
    "",
    ...evidencia,
    "",
    "RESPOSTAS DO ALUNO, dirigidas a uma pessoa do Direito, item a item (entre colchetes, o critério " +
      "da rubrica que cada item atende):",
    ...etapa.campos.map((c) => `- ${c.rotulo} [${c.criterio}: ${nomeCriterio(c.criterio)}]: ${r.campos[c.id].trim()}`),
    "",
    r.feedbacks.length
      ? `Avaliação ${r.feedbacks.length + 1} de ${r.tentativas.maximo} desta etapa. ` +
        "Antes você apontou: " + r.feedbacks.map((f) => f.proximo_passo).join(" | ")
      : `Primeira avaliação desta etapa (de ${r.tentativas.maximo}).`,
    "",
    rubricaEmTexto(rubrica),
    "",
    "Devolva JSON com criterios (id, nivel, comentario, evidencia, sugestao), resumo, proximo_passo " +
      "e pontos_fortes. Avalie só os critérios listados acima.",
  ].join("\n");

  try {
    const resposta = await chamar({
      tarefa: "ex06_feedback",
      modelo: CONFIG.modelos.complexo,
      sistema: SISTEMA_FEEDBACK,
      usuario,
      json: true,
      esquema: ESQUEMA_FEEDBACK,
      maxTokens: 2500,
      temperatura: 0.3,
    });
    r.tentativas.usar();
    r.feedbacks.push(resposta.dados);
    limpar(painel).append(
      painelFeedback({ feedback: resposta.dados, rubrica, iteracao: r.feedbacks.length, criterioDaRubrica }),
      r.tentativas.esgotou ? avisoTentativasEsgotadas(r.tentativas.maximo) : null
    );
    status.replaceChildren(el("span.etiqueta", { texto: r.tentativas.texto() }));
    await registrarSubmissao({
      exercicio: EXERCICIO,
      etapa: `feedback_${etapa.id}`,
      identificacao: estado.identidade,
      respostas: { ...r.campos },
      corte: etapa.id === "corte" ? estado.corte : null,
      metricas: etapa.id === "corte" ? confusao(estado.corte) : null,
      iteracao: r.feedbacks.length,
      feedback: resposta.dados,
      modelo: resposta.modelo,
      monitoramento: estado.guarda.resumo(),
    });
  } catch (erro) {
    status.replaceChildren(el("span.etiqueta.erro", { texto: "falhou" }));
    limpar(painel).append(aviso("erro", "Não consegui avaliar agora", String(erro.message || erro)));
  } finally {
    r.tentativas.aplicar($(`#contador-${etapa.id}`), botao);
  }
}

/* ---------- entrega ----------------------------------------------------- */

async function fechar({ forcado = false } = {}) {
  const etapas = estado.config.etapas;
  const faltam = etapas.filter((e) => !completa(e));
  // Entregar incompleto é permitido, porque o prazo é a hora do contador, mas
  // pede um segundo clique. Quando o tempo acaba, a entrega sai sem perguntar.
  if (faltam.length && !estado.confirmarIncompleta && !forcado) {
    estado.confirmarIncompleta = true;
    $("#b-fechar").textContent = "Gerar a entrega mesmo assim";
    limpar($("#painel-entrega")).append(
      aviso(
        "atencao",
        "Ainda há itens sem resposta em:",
        faltam.map((e) => `- ${e.n}. ${e.titulo}`).join("\n") + "\n\nSe quiser entregar assim mesmo, clique de novo."
      )
    );
    return;
  }

  const c = confusao(estado.corte);
  const secao = (etapa) => {
    const r = estado.respostas[etapa.id];
    const linhas = [`## ${etapa.n}. ${etapa.titulo}`, "", etapa.pergunta, "", `- Iterações de feedback: ${r.feedbacks.length}`, ""];
    if (etapa.id === "corte") {
      linhas.push(
        "| | precisava da investigação | não precisava |",
        "|---|---|---|",
        `| investigação aprofundada | ${c.vp} | ${c.fp} |`,
        `| só pesquisa automática | ${c.fn} | ${c.vn} |`,
        "",
        textoMetricas(c),
        ""
      );
    }
    return [...linhas, ...etapa.campos.flatMap((cp) => [`### ${cp.rotulo}`, r.campos[cp.id].trim() || "_Sem resposta._", ""])];
  };

  const conteudo = [
    "# Projeto 6 (versão para casa) - Do modelo ao corte: execução fiscal",
    "CDAD II · 2026/2 · Insper",
    "",
    `- Aluno: ${estado.identidade.email}`,
    `- Fechado em: ${agora()}`,
    `- Início: ${new Date(estado.fimEm - DURACAO_MS).toLocaleString("pt-BR")}` +
      (estado.encerrado ? " (entrega gerada pelo fim do tempo)" : ""),
    `- Corte escolhido: ${virgula(estado.corte)}`,
    `- Etapas completas: ${etapas.length - faltam.length} de ${etapas.length}`,
    "",
    ...etapas.flatMap(secao),
    "## Observações",
    "",
    estado.observacoes.trim() || "_Sem observações._",
    "",
  ].join("\n");

  const hash = await sha256(conteudo);
  const nome = `ex06b_${chaveDoGrupo(estado.identidade).replace(/\+/g, "-")}.md`;
  baixar(nome, conteudo, "text/markdown;charset=utf-8");

  const resultado = await registrarSubmissao({
    exercicio: EXERCICIO,
    etapa: "final",
    identificacao: estado.identidade,
    respostas: Object.fromEntries(etapas.map((e) => [e.id, {
      campos: { ...estado.respostas[e.id].campos },
      iteracoes_de_feedback: estado.respostas[e.id].feedbacks.length,
    }])),
    corte: estado.corte,
    metricas: c,
    etapas_completas: etapas.length - faltam.length,
    observacoes: estado.observacoes.trim(),
    inicio: new Date(estado.fimEm - DURACAO_MS).toISOString(),
    fim_do_tempo: estado.encerrado,
    hash_arquivo: hash,
    monitoramento: estado.guarda.resumo(),
  });

  estado.passos.ir(4);
  $("#s-entrega").classList.add("concluida");
  limpar($("#painel-entrega")).append(
    aviso(
      resultado.ok ? "ok" : "atencao",
      "Entrega gerada",
      "Baixamos o arquivo markdown com as respostas e o corte. Entregue esse arquivo no BlackBoard."
    ),
    el("div.ficha.destaque", {}, [
      el("span.rotulo", { texto: "hash do arquivo (SHA-256)" }),
      el("div.mono", { texto: hash }),
    ])
  );
}

iniciar().catch((erro) => {
  document.body.prepend(aviso("erro", "Erro ao iniciar", String(erro.message || erro)));
});

// No escuro e no claro a faixa usa as cores do tema: redesenha quando ele muda.
window.addEventListener("tema", () => { if (estado.casos) desenharDistribuicao(); });
