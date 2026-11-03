/* ==========================================================================
   Projeto 5, reposição - Testes de hipóteses em acórdãos criminais do TJSP.

   Para quem faltou à aula 18 (13/10). Abre às 13:00 e fecha às 19:00 do mesmo
   dia (`libera_em` e `entrega_em` em liberacao.json). Mesmo formato do Projeto
   5: cinco perguntas, e em cada uma o aluno escolhe a variável resposta, a
   explicativa e o método, roda a análise de verdade (scipy e statsmodels, no
   navegador) e responde aos itens da rubrica em campos curtos. Base e
   perguntas são outras (a base `criminal`, com os booleanos como "sim" e
   "não"), e o id é próprio (ex05b), para a submissão não se confundir com a
   da turma.

   Diferenças em relação ao app da turma, a pedido do professor:
   - não há feedback automático pela rubrica: a rubrica fica visível, mas quem
     avalia é o professor;
   - as violações valem nota. Cada saída da aba (contada uma vez por episódio,
     e não duas, como no contador de registro) e cada tentativa de copiar ou
     colar desconta `desconto_por_violacao` pontos, e o desconto vai escrito no
     arquivo da entrega e na submissão;
   - depois das 19:00 o app não abre e não gera entrega;
   - o trabalho é individual, e o que o aluno escreve fica salvo neste
     navegador (localStorage, por e-mail), porque recarregar a página sem
     querer não pode custar as cinco perguntas.
   ========================================================================== */

import { ativar } from "../_shared/guardrails.js";
import { exigirIdentificacao } from "../_shared/identidade.js";
import { registrarSubmissao } from "../_shared/firebase.js";
import { exigirLiberacao, formatarData } from "../_shared/liberacao.js";
import { painelRubrica } from "../_shared/rubrica.js";
import { carregar, rodar } from "../_shared/pyodide.js";
import {
  $, $$, el, limpar, aviso, montarTopo, montarPassos, baixar, sha256, tabela,
  contarPalavras, agora, toast,
} from "../_shared/ui.js";

const EXERCICIO = "ex05b";

const estado = {
  identidade: null,
  guarda: null,
  chave: null,
  prazo: null,
  py: null,
  config: null,
  meta: null,
  rubrica: null,
  pergunta: null, // a pergunta da aba ativa
  respostas: {}, // por id de pergunta: escolhas, análise e campos
  confirmarIncompleta: false,
  passos: null,
};

/* ---------- prazo e desconto -------------------------------------------- */

// `entrega_em` vem no fuso de Brasília, sem fuso escrito ("2026-10-13T19:00").
function paraData(texto) {
  return texto ? new Date(`${texto}:00-03:00`) : null;
}

function encerrado() {
  return Boolean(estado.prazo) && Date.now() > estado.prazo.getTime();
}

function descontoAtual() {
  const n = estado.guarda?.infracoes ?? 0;
  return { violacoes: n, pontos: n * estado.config.desconto_por_violacao };
}

function numero(x) {
  return String(Math.round(x * 100) / 100).replace(".", ",");
}

function montarAvisoViolacoes() {
  const d = numero(estado.config.desconto_por_violacao);
  const prazo = estado.prazo ? ` O exercício fecha às ${estado.prazo.toLocaleTimeString("pt-BR").slice(0, 5)}.` : "";
  limpar($("#aviso-violacoes")).append(
    el("strong", { texto: `Não saia desta tela enquanto faz o exercício: cada violação desconta ${d} ponto.` }),
    el("span", {
      texto:
        " Conta como violação sair desta aba ou desta janela (outra aba, outro programa, " +
        "minimizar), uma vez por saída, e cada tentativa de copiar ou colar. Baixar o arquivo " +
        "da entrega não conta. O contador fica no alto da página, e o desconto vai escrito no " +
        "arquivo da entrega." + prazo,
    })
  );
}

/* ---------- rascunho ---------------------------------------------------- */

function salvar() {
  try {
    const dados = {};
    for (const [id, r] of Object.entries(estado.respostas)) {
      dados[id] = {
        y: r.y, x: r.x, metodo: r.metodo,
        analise: r.analise && { ...r.analise, png: null },
        campos: r.campos,
      };
    }
    localStorage.setItem(estado.chave, JSON.stringify({ salvo_em: agora(), respostas: dados }));
    $("#salvo").textContent = `salvo neste navegador às ${new Date().toLocaleTimeString("pt-BR").slice(0, 5)}`;
  } catch {
    $("#salvo").textContent = "não consegui salvar neste navegador";
  }
}

function recuperar() {
  try {
    const salvo = JSON.parse(localStorage.getItem(estado.chave) || "null");
    if (!salvo?.respostas) return false;
    for (const [id, r] of Object.entries(salvo.respostas)) {
      if (!estado.respostas[id]) continue;
      Object.assign(estado.respostas[id], {
        y: r.y || "", x: r.x || "", metodo: r.metodo || "", analise: r.analise || null,
      });
      Object.assign(estado.respostas[id].campos, r.campos || {});
    }
    return true;
  } catch {
    return false; // rascunho ilegível: começa do zero
  }
}

/* ---------- arranque ---------------------------------------------------- */

async function iniciar() {
  montarTopo({
    exercicio: "Projeto 5",
    aula: "reposição",
    titulo: "Testes de hipóteses em acórdãos criminais",
  });
  const liberacao = await exigirLiberacao(EXERCICIO);
  if (!liberacao.liberado) return;
  estado.prazo = paraData(liberacao.entrega_em);
  if (encerrado() && !liberacao.porProfessor) {
    limpar($("main")).append(
      aviso("atencao", "Exercício encerrado",
        `A reposição do Projeto 5 fechou em ${formatarData(liberacao.entrega_em)}.`)
    );
    return;
  }

  estado.passos = montarPassos(["ambiente", "perguntas", "método", "resultado", "interpretação", "entrega"]);
  estado.passos.ir(0);

  const [config, meta, rubrica] = await Promise.all([
    fetch("perguntas.json").then((r) => r.json()),
    fetch("criminal.json").then((r) => r.json()),
    fetch("../rubricas/ex05-interpretacao.json").then((r) => r.json()),
  ]);
  estado.config = config;
  estado.meta = meta;
  estado.rubrica = rubrica;

  estado.identidade = await exigirIdentificacao({
    exercicio: EXERCICIO,
    emGrupo: false,
    titulo: "Projeto 5 (reposição) · quem está fazendo",
    explicacao:
      "Trabalho individual. Use o seu e-mail do Insper: a entrega fica registrada no seu nome. " +
      "Não é permitido sair desta tela enquanto faz o exercício: cada saída e cada tentativa de " +
      `copiar ou colar desconta ${numero(config.desconto_por_violacao)} ponto da nota.`,
  });
  estado.guarda = ativar({
    exercicio: EXERCICIO,
    episodios: true,
    textoBanner:
      "Não saia desta tela: cada saída desta aba e cada tentativa de copiar ou colar desconta " +
      `${numero(config.desconto_por_violacao)} ponto da nota. Baixar o arquivo da entrega não conta.`,
    textoRegistro:
      `Cada uma desconta ${numero(config.desconto_por_violacao)} ponto da nota deste exercício.`,
  });
  montarAvisoViolacoes();

  for (const p of config.perguntas) {
    estado.respostas[p.id] = {
      y: "", x: "", metodo: "",
      analise: null,
      campos: Object.fromEntries(config.campos.map((c) => [c.id, ""])),
    };
  }
  estado.chave = `cdad2:${EXERCICIO}:${estado.identidade.email}`;
  const tinhaRascunho = recuperar();

  limpar($("#painel-rubrica")).append(painelRubrica(rubrica, { mostrarInstrucoes: false }));
  montarCampos();

  $("#b-carregar").addEventListener("click", carregarAmbiente);
  $("#b-rodar").addEventListener("click", rodarAnalise);
  $("#b-fechar").addEventListener("click", fechar);
  if (tinhaRascunho) toast("Recuperei o que estava salvo neste navegador.");
}

async function carregarAmbiente() {
  const botao = $("#b-carregar");
  const status = $("#status-ambiente");
  botao.disabled = true;
  try {
    estado.py = await carregar({
      pacotes: ["pandas", "numpy", "scipy", "statsmodels", "matplotlib"],
      viaMicropip: ["plotnine"],
      aoProgresso: (msg, p) => {
        status.replaceChildren(el("span.carregando", { texto: msg }));
        $("#barra-ambiente").style.width = `${p * 100}%`;
      },
    });
    const csv = await fetch(estado.config.base.arquivo).then((r) => r.text());
    estado.py.FS.writeFile("/criminal.csv", csv);
    const info = await rodar(
      estado.py,
      `
import pandas as pd, numpy as np, matplotlib
matplotlib.use("agg")
from scipy import stats
import statsmodels.formula.api as smf
import statsmodels.api as sm
from plotnine import *
criminal = pd.read_csv("/criminal.csv")
_head = criminal.head(10)
# em texto, para sair como o pandas mostra: 6.5 e NaN, e não 6,5 e null
{"linhas": int(criminal.shape[0]), "colunas": int(criminal.shape[1]),
 "primeiras": {"columns": list(_head.columns),
               "data": _head.astype(str).replace("nan", "NaN").values.tolist(),
               "numericas": [c for c in _head.columns if pd.api.types.is_numeric_dtype(_head[c])]}}
`
    );
    status.replaceChildren(
      el("span.etiqueta.ok", { texto: `base com ${info.linhas} acórdãos` })
    );
    montarResumoBase(info);
    montarSelects();
    montarAbasPerguntas();
    $("#s-ambiente").classList.add("concluida");
    $("#s-pergunta").classList.remove("travada");
    $("#s-entrega").classList.remove("travada");
    irPara(estado.config.perguntas[0]);
  } catch (erro) {
    botao.disabled = false;
    status.replaceChildren(el("span.etiqueta.erro", { texto: "falhou" }));
    limpar($("#resumo-base")).append(
      aviso("erro", "Não consegui carregar o ambiente", String(erro.message || erro))
    );
  }
}

/** A base em duas abas: a descrição das colunas e as dez primeiras linhas. */
function montarResumoBase(info) {
  const descricao = el("div.rolagem.rolagem-dicionario", {}, [
    el("table", {}, [
      el("thead", {}, [el("tr", {}, ["coluna", "descrição"].map((t) => el("th", { texto: t })))]),
      el("tbody", {}, estado.meta.variaveis.map((v) =>
        el("tr", {}, [
          el("td", {}, [el("code", { texto: v.nome })]),
          el("td", { texto: v.descricao }),
        ])
      )),
    ]),
  ]);

  const { columns, data, numericas } = info.primeiras;
  const linhas = data.map((valores) => Object.fromEntries(columns.map((c, i) => [c, valores[i]])));
  const primeiras = el("div.primeiras-linhas", {}, [
    el("pre", {}, [el("code", { texto: "criminal.head(10)" })]),
    tabela(columns, linhas, { numericas }),
  ]);

  const paineis = { descricao, primeiras };
  const corpo = el("div");
  const abas = el("div.abas", { role: "tablist" });
  const mostrar = (qual) => {
    $$("button", abas).forEach((b) => b.classList.toggle("ativa", b.dataset.aba === qual));
    corpo.replaceChildren(paineis[qual]);
  };
  for (const [id, rotulo] of [["descricao", "Descrição das colunas"], ["primeiras", "Primeiras 10 linhas"]]) {
    abas.append(el("button", { type: "button", role: "tab", dataset: { aba: id }, texto: rotulo,
      onclick: () => mostrar(id) }));
  }
  mostrar("descricao");

  limpar($("#resumo-base")).append(
    el("div.ficha", {}, [
      el("span.rotulo", { texto: `${estado.meta.nome} · ${info.linhas} linhas` }),
      el("div.miudo", { style: "margin-bottom:.6rem", texto: estado.meta.fonte }),
      abas,
      corpo,
    ])
  );
}

/* ---------- perguntas --------------------------------------------------- */

function completa(r) {
  return Boolean(r.analise) && estado.config.campos.every((c) => contarPalavras(r.campos[c.id]) > 0);
}

function montarAbasPerguntas() {
  const alvo = limpar($("#abas-perguntas"));
  estado.config.perguntas.forEach((p, i) => {
    alvo.append(
      el("button", { type: "button", role: "tab", dataset: { pergunta: p.id }, onclick: () => irPara(p) }, [
        `${i + 1}. ${p.titulo}`,
        el("span.estado"),
      ])
    );
  });
  atualizarProgresso();
}

function atualizarProgresso() {
  let feitas = 0;
  for (const botao of $$("#abas-perguntas button")) {
    const r = estado.respostas[botao.dataset.pergunta];
    const ok = completa(r);
    feitas += ok ? 1 : 0;
    const marca = $(".estado", botao);
    marca.textContent = ok ? "pronta" : r.analise ? "em andamento" : "";
    marca.className = `estado${ok ? " completa" : ""}`;
  }
  const total = estado.config.perguntas.length;
  $("#progresso-perguntas").textContent = `${feitas} de ${total} prontas`;
  limpar($("#resumo-entrega")).append(
    el("p.enunciado", {
      style: "margin:0",
      texto: feitas === total
        ? "As cinco perguntas estão prontas. Gere a entrega e envie o markdown no BlackBoard."
        : `${feitas} de ${total} perguntas prontas. Uma pergunta fica pronta quando a análise ` +
          "rodou e todos os itens da etapa 04 foram respondidos.",
    })
  );
  estado.confirmarIncompleta = false;
  $("#b-fechar").textContent = "Fechar e gerar a entrega";
  return feitas;
}

/** Troca a aba ativa e redesenha as etapas 02 a 04 com o que a pergunta já tem. */
function irPara(p) {
  estado.pergunta = p;
  const r = estado.respostas[p.id];
  $$("#abas-perguntas button").forEach((b) => b.classList.toggle("ativa", b.dataset.pergunta === p.id));
  $("#texto-pergunta").textContent = p.pergunta;
  $("#s-pergunta").classList.add("concluida");
  $("#s-analise").classList.remove("travada");
  estado.guarda.marco("ex05b_pergunta", p.id);

  $("#sel-y").value = r.y;
  $("#sel-x").value = r.x;
  $("#sel-metodo").value = r.metodo;
  atualizarEscolhas();
  $("#status-analise").replaceChildren();

  mostrarAnalise(r.analise);
  for (const c of estado.config.campos) $(`#c-${c.id}`).value = r.campos[c.id];
  estado.passos.ir(r.analise ? 4 : 2);
}

/* ---------- variáveis e método ------------------------------------------ */

function montarSelects() {
  const usaveis = estado.meta.variaveis.filter((v) => v.tipo !== "identificador");
  for (const [sel, rotulo] of [["#sel-y", "a variável resposta"], ["#sel-x", "a variável explicativa"]]) {
    const campo = limpar($(sel));
    campo.append(el("option", { value: "", texto: `escolha ${rotulo}` }));
    for (const v of usaveis) campo.append(el("option", { value: v.nome, texto: v.nome }));
    campo.addEventListener("change", () => { atualizarEscolhas(); salvar(); });
  }
  const metodo = limpar($("#sel-metodo"));
  metodo.append(el("option", { value: "", texto: "escolha o método" }));
  for (const m of estado.config.metodos) {
    metodo.append(el("option", { value: m.id, texto: m.rotulo }));
  }
  metodo.addEventListener("change", () => { atualizarEscolhas(); salvar(); });
}

function atualizarEscolhas() {
  const r = estado.respostas[estado.pergunta.id];
  r.y = $("#sel-y").value;
  r.x = $("#sel-x").value;
  r.metodo = $("#sel-metodo").value;
  const m = estado.config.metodos.find((mm) => mm.id === r.metodo);
  $("#ajuda-metodo").textContent = m ? `exige ${m.exige}` : "";
  $("#b-rodar").disabled = !(r.y && r.x && r.metodo);
}

/* ---------- análise no Python ------------------------------------------- */

/**
 * O código que o aluno vê e roda.
 *
 * Regra que vale para os quatro métodos: quem faz a conta é o pacote. Nada de
 * calcular erro padrão, intervalo ou tamanho de efeito na mão, porque isso
 * esconde o que o teste faz atrás de cinco linhas de aritmética e não é o que
 * o aluno vai escrever quando estiver sozinho no Colab.
 */
function codigoDaAnalise(y, x, metodo) {
  if (metodo === "quiquadrado") {
    return [
      "import pandas as pd",
      "from scipy import stats",
      "",
      `dados = criminal[['${y}', '${x}']].dropna()`,
      `tabela = pd.crosstab(dados['${x}'], dados['${y}'])`,
      "print(tabela)",
      "print()",
      "print('proporções por linha (%):')",
      "print((tabela.div(tabela.sum(axis=1), axis=0) * 100).round(1))",
      "print()",
      "teste = stats.chi2_contingency(tabela)",
      "print(f'qui-quadrado = {teste.statistic:.3f}   gl = {teste.dof}   valor-p = {teste.pvalue:.5f}')",
    ].join("\n");
  }

  if (metodo === "duas_proporcoes") {
    // A proporção é a de "sim" quando a variável resposta é sim/não, e a da
    // primeira categoria em ordem alfabética nos outros casos.
    return [
      "import pandas as pd",
      "from statsmodels.stats.proportion import proportions_ztest, confint_proportions_2indep",
      "",
      `dados = criminal[['${y}', '${x}']].dropna()`,
      `for coluna in ['${y}', '${x}']:`,
      "    if dados[coluna].nunique() != 2:",
      `        raise ValueError(f"{coluna} tem {dados[coluna].nunique()} níveis; o teste de duas proporções pede duas variáveis binárias.")`,
      "",
      `tabela = pd.crosstab(dados['${x}'], dados['${y}'])`,
      "print(tabela)",
      "print()",
      "categoria = 'sim' if 'sim' in tabela.columns else tabela.columns[0]",
      "sucessos = tabela[categoria]",
      "totais = tabela.sum(axis=1)",
      "print(f\"proporção de '{categoria}' em cada grupo (%):\")",
      "print((sucessos / totais * 100).round(1))",
      "print()",
      "a, b = tabela.index",
      "z, valor_p = proportions_ztest([sucessos[a], sucessos[b]], [totais[a], totais[b]])",
      "baixo, alto = confint_proportions_2indep(sucessos[a], totais[a], sucessos[b], totais[b], method='wald')",
      "print(f'diferença ({a} menos {b}): {(sucessos[a] / totais[a] - sucessos[b] / totais[b]) * 100:.1f} pontos percentuais')",
      "print(f'IC 95% da diferença: {baixo * 100:.1f} a {alto * 100:.1f} pontos percentuais')",
      "print(f'z = {z:.3f}   valor-p = {valor_p:.5f}')",
    ].join("\n");
  }

  if (metodo === "teste_t") {
    return [
      "import pandas as pd",
      "from statsmodels.stats.weightstats import CompareMeans",
      "",
      `dados = criminal[['${y}', '${x}']].dropna()`,
      `if dados['${x}'].nunique() != 2:`,
      `    raise ValueError(f"${x} tem {dados['${x}'].nunique()} níveis; o teste t compara dois grupos.")`,
      "",
      `print(dados.groupby('${x}')['${y}'].agg(['count', 'mean', 'std']).round(3))`,
      "print()",
      `grupo_a, grupo_b = [g['${y}'] for _, g in dados.groupby('${x}')]`,
      `print('diferença estimada:', ' menos '.join(sorted(dados['${x}'].unique())))`,
      "print(CompareMeans.from_data(grupo_a, grupo_b).summary(usevar='unequal'))",
    ].join("\n");
  }

  if (metodo === "anova") {
    return [
      "import pandas as pd",
      "import statsmodels.api as sm",
      "import statsmodels.formula.api as smf",
      "",
      `dados = criminal[['${y}', '${x}']].dropna()`,
      `print(dados.groupby('${x}')['${y}'].agg(['count', 'mean', 'std']).round(3))`,
      "print()",
      `modelo = smf.ols('${y} ~ C(${x})', data=dados).fit()`,
      "print(sm.stats.anova_lm(modelo, typ=2).round(4))",
      "print()",
      "print(f'R² = {modelo.rsquared:.4f}   n = {int(modelo.nobs)}')",
    ].join("\n");
  }

  return [
    "import pandas as pd",
    "import statsmodels.formula.api as smf",
    "",
    `dados = criminal[['${y}', '${x}']].dropna()`,
    `modelo = smf.ols('${y} ~ ${x}', data=dados).fit()`,
    "print(modelo.summary())",
  ].join("\n");
}

function codigoDoGrafico(y, x, metodo) {
  if (metodo === "quiquadrado" || metodo === "duas_proporcoes") {
    return [
      "from plotnine import *",
      `_g = (ggplot(dados, aes(x='${x}', fill='${y}'))`,
      "      + geom_bar(position='fill')",
      "      + coord_flip()",
      `      + labs(x='${x}', y='proporção', fill='${y}'))`,
    ].join("\n");
  }
  if (metodo === "regressao") {
    return [
      "from plotnine import *",
      `_g = (ggplot(dados, aes(x='${x}', y='${y}'))`,
      "      + geom_point(alpha=.25, size=1)",
      "      + geom_smooth(method='lm', color='#e50505')",
      `      + labs(x='${x}', y='${y}'))`,
    ].join("\n");
  }
  return [
    "from plotnine import *",
    `_g = (ggplot(dados, aes(x='${x}', y='${y}'))`,
    "      + geom_boxplot(fill='#dcdcdc')",
    "      + coord_flip()",
    `      + labs(x='${x}', y='${y}'))`,
  ].join("\n");
}

/** Mostra a análise guardada da pergunta, ou esconde a etapa 03 se não houver. */
function mostrarAnalise(analise) {
  limpar($("#saida-texto"));
  if (!analise) {
    $("#s-saida").classList.add("travada");
    $("#s-interpretacao").classList.add("travada");
    $("#codigo").textContent = "";
    $("#saida-bruta").textContent = "";
    $("#figura").removeAttribute("src");
    return;
  }
  $("#s-saida").classList.remove("travada");
  $("#s-interpretacao").classList.remove("travada");
  $("#codigo").textContent = analise.codigo;
  $("#saida-bruta").textContent = analise.texto || "";
  if (analise.png) $("#figura").src = `data:image/png;base64,${analise.png}`;
  else $("#figura").removeAttribute("src");
}

async function rodarAnalise() {
  const p = estado.pergunta;
  const r = estado.respostas[p.id];
  const { y, x, metodo } = r;
  const status = $("#status-analise");
  status.replaceChildren(el("span.carregando", { texto: "rodando" }));

  const codigo = codigoDaAnalise(y, x, metodo);
  const grafico = codigoDoGrafico(y, x, metodo);
  const script = `
import io, base64, traceback, contextlib
saida = {"erro": None, "texto": None, "png": None}
# Cada rodada roda no mesmo intérprete. Sem limpar, a tabela da rodada anterior
# apareceria como se fosse desta.
for _nome in ("dados", "modelo", "tabela", "teste", "grupo_a", "grupo_b", "sucessos", "totais", "_g"):
    globals().pop(_nome, None)
_buf = io.StringIO()
try:
    with contextlib.redirect_stdout(_buf):
${codigo.split("\n").map((l) => "        " + l).join("\n")}
    saida["texto"] = _buf.getvalue()
    try:
${grafico.split("\n").map((l) => "        " + l).join("\n")}
        _b = io.BytesIO()
        _g.save(_b, format="png", width=7, height=4.2, dpi=105, verbose=False)
        saida["png"] = base64.b64encode(_b.getvalue()).decode()
    except Exception as e:
        saida["aviso_grafico"] = str(e)
except Exception:
    saida["erro"] = traceback.format_exc(limit=2)
    saida["texto"] = _buf.getvalue()
saida
`;

  let resultado;
  try {
    resultado = await rodar(estado.py, script);
  } catch (erro) {
    status.replaceChildren(el("span.etiqueta.erro", { texto: "erro" }));
    return;
  }
  // o aluno pode ter trocado de pergunta enquanto o Python rodava
  if (estado.pergunta !== p) return;

  if (resultado.erro) {
    r.analise = null;
    mostrarAnalise(null);
    status.replaceChildren(el("span.etiqueta.erro", { texto: "o Python recusou" }));
    $("#s-saida").classList.remove("travada");
    $("#codigo").textContent = `${codigo}\n\n${grafico}`;
    $("#saida-bruta").textContent = resultado.texto || "";
    $("#saida-texto").append(
      aviso("erro", "A análise não rodou", "Leia a mensagem do Python:"),
      el("pre", {}, [el("code", { texto: resultado.erro })])
    );
    atualizarProgresso();
    return;
  }

  status.replaceChildren(el("span.etiqueta.ok", { texto: "análise concluída" }));
  r.analise = {
    y, x, metodo,
    codigo: `${codigo}\n\n${grafico}`,
    texto: resultado.texto,
    png: resultado.png || null,
  };
  mostrarAnalise(r.analise);
  estado.passos.ir(3);
  atualizarProgresso();
  salvar();

  await registrarSubmissao({
    exercicio: EXERCICIO,
    etapa: "analise",
    identificacao: estado.identidade,
    pergunta_id: p.id,
    escolha: { y, x, metodo },
    escolha_esperada: p.esperado,
    combinacao_esperada: metodo === p.esperado.metodo && y === p.esperado.y && x === p.esperado.x,
    monitoramento: estado.guarda.resumo(),
  });
}

/* ---------- interpretação ----------------------------------------------- */

/** Um campo curto por ponto da rubrica, o mesmo conjunto para as cinco perguntas. */
function montarCampos() {
  const alvo = limpar($("#campos-interpretacao"));
  for (const c of estado.config.campos) {
    const area = el("textarea", {
      id: `c-${c.id}`,
      rows: "2",
      maxlength: String(estado.config.limites.max_caracteres_campo),
      spellcheck: "true",
    });
    area.addEventListener("input", () => {
      estado.respostas[estado.pergunta.id].campos[c.id] = area.value;
      atualizarProgresso();
      salvar();
    });
    alvo.append(
      el("div.campo", {}, [
        el("label.rotulo", { for: `c-${c.id}`, texto: c.rotulo }),
        el("p.miudo", { texto: c.ajuda }),
        area,
      ])
    );
  }
}

/* ---------- entrega ----------------------------------------------------- */

async function fechar() {
  if (encerrado()) {
    limpar($("#painel-entrega")).append(
      aviso("atencao", "Exercício encerrado", "O prazo desta reposição já passou, e a entrega não é mais gerada.")
    );
    return;
  }
  const perguntas = estado.config.perguntas;
  const faltam = perguntas
    .map((p, i) => ({ p, i, r: estado.respostas[p.id] }))
    .filter(({ r }) => !completa(r));

  // Entregar incompleto é permitido, mas pede um segundo clique: o aluno
  // precisa saber que está deixando pergunta de fora.
  if (faltam.length && !estado.confirmarIncompleta) {
    estado.confirmarIncompleta = true;
    $("#b-fechar").textContent = "Gerar a entrega mesmo assim";
    limpar($("#painel-entrega")).append(
      aviso(
        "atencao",
        "Ainda falta responder:",
        faltam.map(({ p, i }) => `- ${i + 1}. ${p.titulo}`).join("\n") +
          "\n\nSe quiser entregar assim mesmo, clique de novo."
      )
    );
    return;
  }

  // O desconto é o do momento do fechamento. O registro continua depois
  // (ver `entregar` no guardrails), e o que vier depois fica marcado como
  // posterior à entrega.
  const desconto = descontoAtual();
  estado.guarda.entregar(`${perguntas.length - faltam.length} de ${perguntas.length} perguntas`);

  const secao = (p, i) => {
    const r = estado.respostas[p.id];
    const linhas = [`## ${i + 1}. ${p.titulo}`, "", p.pergunta, ""];
    if (!r.analise) return [...linhas, "_Sem análise._", ""];
    const metodo = estado.config.metodos.find((m) => m.id === r.analise.metodo)?.rotulo || r.analise.metodo;
    return [
      ...linhas,
      `- Variável resposta: ${r.analise.y}`,
      `- Variável explicativa: ${r.analise.x}`,
      `- Método: ${metodo}`,
      "",
      "### Código executado",
      "```python",
      r.analise.codigo,
      "```",
      "",
      "### Saída",
      "```",
      r.analise.texto,
      "```",
      "",
      ...estado.config.campos.flatMap((c) => [`### ${c.rotulo}`, r.campos[c.id].trim() || "_Sem resposta._", ""]),
    ];
  };

  const conteudo = [
    "# Projeto 5 (reposição) - Testes de hipóteses em acórdãos criminais do TJSP",
    "CDAD II · 2026/2 · Insper",
    "",
    `- Aluno: ${estado.identidade.email}`,
    `- Fechado em: ${agora()}`,
    `- Perguntas prontas: ${perguntas.length - faltam.length} de ${perguntas.length}`,
    `- Violações até o fechamento: ${desconto.violacoes} ` +
      `(saídas da aba e tentativas de copiar ou colar)`,
    `- Desconto na nota: ${numero(desconto.pontos)} ponto(s), ` +
      `${numero(estado.config.desconto_por_violacao)} por violação`,
    "",
    ...perguntas.flatMap(secao),
  ].join("\n");

  const hash = await sha256(conteudo);
  const nome = `ex05b_${estado.identidade.email.split("@")[0]}.md`;
  baixar(nome, conteudo, "text/markdown;charset=utf-8");

  const resultado = await registrarSubmissao({
    exercicio: EXERCICIO,
    etapa: "final",
    identificacao: estado.identidade,
    respostas: Object.fromEntries(perguntas.map((p) => {
      const r = estado.respostas[p.id];
      return [p.id, {
        escolha: r.analise ? { y: r.analise.y, x: r.analise.x, metodo: r.analise.metodo } : null,
        saida: r.analise?.texto ?? null,
        campos: { ...r.campos },
      }];
    })),
    perguntas_prontas: perguntas.length - faltam.length,
    violacoes_para_nota: desconto.violacoes,
    desconto_na_nota: desconto.pontos,
    hash_arquivo: hash,
    monitoramento: estado.guarda.resumo(),
  });

  estado.passos.ir(5);
  $("#s-entrega").classList.add("concluida");
  limpar($("#painel-entrega")).append(
    aviso(
      resultado.ok ? "ok" : "atencao",
      "Entrega gerada",
      "Baixamos o arquivo markdown com as análises e as respostas. Entregue esse arquivo no " +
        `BlackBoard. Violações até aqui: ${desconto.violacoes}, com desconto de ` +
        `${numero(desconto.pontos)} ponto(s).`
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
