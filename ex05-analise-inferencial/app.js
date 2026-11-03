/* ==========================================================================
   Projeto 5 (aula 18) - Testes de hipóteses nas Câmaras Criminais do TJSP.

   O grupo responde às cinco perguntas de pesquisa. Em cada uma, escolhe a
   variável resposta, a explicativa e o método; o app roda a análise de verdade
   (scipy e statsmodels, no navegador), mostra o código e a saída, e avalia a
   interpretação pela rubrica.

   A interpretação é escrita em campos curtos, um para cada ponto da rubrica, e
   não num texto corrido: cada item é avaliado pelo campo correspondente, e a
   correspondência com a saída, por todos juntos.

   O app não avisa quando a combinação de tipos é incompatível com o método.
   Escolher o método pelos tipos das variáveis é parte do que se avalia.
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import { ativar } from "../_shared/guardrails.js";
import { exigirIdentificacao, chaveDoGrupo } from "../_shared/identidade.js";
import { registrarSubmissao } from "../_shared/firebase.js";
import { exigirLiberacao } from "../_shared/liberacao.js";
import {
  painelRubrica, contadorTentativas, avisoTentativasEsgotadas, painelFeedback,
} from "../_shared/rubrica.js";
import {
  chamar, rubricaEmTexto, criterioDaRubrica, ESQUEMA_FEEDBACK, SISTEMA_FEEDBACK,
} from "../_shared/llm.js";
import { carregar, rodar } from "../_shared/pyodide.js";
import {
  $, $$, el, limpar, aviso, toast, montarTopo, montarPassos, baixar, sha256, tabela,
  contarPalavras, agora,
} from "../_shared/ui.js";

const EXERCICIO = "ex05";

const estado = {
  identidade: null,
  guarda: null,
  py: null,
  config: null,
  meta: null,
  rubrica: null,
  primeiras: null,
  pergunta: null, // a pergunta da aba ativa
  respostas: {}, // por id de pergunta: escolhas, análise, campos e feedbacks
  confirmarIncompleta: false,
  passos: null,
};

/* ---------- arranque ---------------------------------------------------- */

async function iniciar() {
  montarTopo({
    exercicio: "Projeto 5",
    aula: "aula 18",
    titulo: "Testes de hipóteses nas Câmaras Criminais",
  });
  const liberacao = await exigirLiberacao(EXERCICIO);
  if (!liberacao.liberado) return;

  estado.passos = montarPassos(["ambiente", "perguntas", "método", "resultado", "interpretação", "entrega"]);
  estado.passos.ir(0);

  estado.identidade = await exigirIdentificacao({
    exercicio: EXERCICIO,
    emGrupo: true,
    titulo: "Projeto 5 · quem está fazendo",
    explicacao:
      "Trabalho em grupo. Coloque o seu e-mail e os e-mails do grupo. Cópia e cola estão " +
      "bloqueados: as respostas têm que ser escritas aqui.",
  });
  estado.guarda = ativar({ exercicio: EXERCICIO });

  const [config, meta, rubrica] = await Promise.all([
    fetch("perguntas.json").then((r) => r.json()),
    fetch("../_shared/dados/camaras.json").then((r) => r.json()),
    fetch("../rubricas/ex05-interpretacao.json").then((r) => r.json()),
  ]);
  estado.config = config;
  estado.meta = meta;
  estado.rubrica = rubrica;
  for (const p of config.perguntas) {
    estado.respostas[p.id] = {
      y: "", x: "", metodo: "",
      analise: null,
      campos: Object.fromEntries(config.campos.map((c) => [c.id, ""])),
      feedbacks: [],
      tentativas: contadorTentativas(config.limites.max_avaliacoes_por_pergunta),
    };
  }
  limpar($("#painel-rubrica")).append(painelRubrica(rubrica, { mostrarInstrucoes: false }));
  montarCampos();

  $("#b-carregar").addEventListener("click", carregarAmbiente);
  $("#b-rodar").addEventListener("click", rodarAnalise);
  $("#b-feedback").addEventListener("click", pedirFeedback);
  $("#b-fechar").addEventListener("click", fechar);
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
    estado.py.FS.writeFile("/camaras.csv", csv);
    const info = await rodar(
      estado.py,
      `
import pandas as pd, numpy as np, matplotlib
matplotlib.use("agg")
from scipy import stats
import statsmodels.formula.api as smf
import statsmodels.api as sm
from plotnine import *
camaras = pd.read_csv("/camaras.csv")
_head = camaras.head(10)
# em texto, para sair como o pandas mostra: 60.0 e NaN, e não 60 e null
{"linhas": int(camaras.shape[0]), "colunas": int(camaras.shape[1]),
 "primeiras": {"columns": list(_head.columns),
               "data": _head.astype(str).replace("nan", "NaN").values.tolist(),
               "numericas": [c for c in _head.columns
                             if pd.api.types.is_numeric_dtype(_head[c]) and c != "processo"]}}
`
    );
    status.replaceChildren(
      el("span.etiqueta.ok", { texto: `base com ${info.linhas} recursos` })
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

/**
 * A base em duas abas: a descrição das colunas e as dez primeiras linhas, como
 * sairiam de `camaras.head(10)`. O tipo de cada variável não aparece: decidir
 * o tipo olhando os valores faz parte de escolher o método.
 */
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
    el("pre", {}, [el("code", { texto: "camaras.head(10)" })]),
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
  estado.guarda.marco("ex05_pergunta", p.id);

  $("#sel-y").value = r.y;
  $("#sel-x").value = r.x;
  $("#sel-metodo").value = r.metodo;
  atualizarEscolhas();
  $("#status-analise").replaceChildren();

  mostrarAnalise(r.analise);
  for (const c of estado.config.campos) $(`#c-${c.id}`).value = r.campos[c.id];

  limpar($("#painel-feedback"));
  const ultimo = r.feedbacks.at(-1);
  if (ultimo) {
    $("#painel-feedback").append(
      painelFeedback({ feedback: ultimo, rubrica: estado.rubrica, iteracao: r.feedbacks.length, criterioDaRubrica }),
      r.tentativas.esgotou ? avisoTentativasEsgotadas(r.tentativas.maximo) : null
    );
  }
  r.tentativas.aplicar($("#contador-feedback"), $("#b-feedback"));
  $("#status-feedback").replaceChildren();
  estado.passos.ir(r.feedbacks.length ? 4 : r.analise ? 3 : 2);
}

/* ---------- variáveis e método ------------------------------------------ */

function montarSelects() {
  const usaveis = estado.meta.variaveis.filter((v) => v.tipo !== "identificador");
  for (const [sel, rotulo] of [["#sel-y", "a variável resposta"], ["#sel-x", "a variável explicativa"]]) {
    const campo = limpar($(sel));
    campo.append(el("option", { value: "", texto: `escolha ${rotulo}` }));
    for (const v of usaveis) campo.append(el("option", { value: v.nome, texto: v.nome }));
    campo.addEventListener("change", atualizarEscolhas);
  }
  const metodo = limpar($("#sel-metodo"));
  metodo.append(el("option", { value: "", texto: "escolha o método" }));
  for (const m of estado.config.metodos) {
    metodo.append(el("option", { value: m.id, texto: m.rotulo }));
  }
  metodo.addEventListener("change", atualizarEscolhas);
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
      `dados = camaras[['${y}', '${x}']].dropna()`,
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
    // A proporção é a da primeira categoria da variável resposta, em ordem
    // alfabética. Na unanimidade, é a de decisões por maioria.
    return [
      "import pandas as pd",
      "from statsmodels.stats.proportion import proportions_ztest, confint_proportions_2indep",
      "",
      `dados = camaras[['${y}', '${x}']].dropna()`,
      `for coluna in ['${y}', '${x}']:`,
      "    if dados[coluna].nunique() != 2:",
      `        raise ValueError(f"{coluna} tem {dados[coluna].nunique()} níveis; o teste de duas proporções pede duas variáveis binárias.")`,
      "",
      `tabela = pd.crosstab(dados['${x}'], dados['${y}'])`,
      "print(tabela)",
      "print()",
      "categoria = tabela.columns[0]",
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
      `dados = camaras[['${y}', '${x}']].dropna()`,
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
      `dados = camaras[['${y}', '${x}']].dropna()`,
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
    `dados = camaras[['${y}', '${x}']].dropna()`,
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
  // o grupo pode ter trocado de aba enquanto o Python rodava
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

/* ---------- interpretação e feedback ------------------------------------ */

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

async function pedirFeedback() {
  const p = estado.pergunta;
  const r = estado.respostas[p.id];
  const pendencias = [];
  if (!r.analise) pendencias.push("rodar uma análise que funcione (etapa 02)");
  const vazios = estado.config.campos.filter((c) => !contarPalavras(r.campos[c.id]));
  if (vazios.length) pendencias.push(`responder: ${vazios.map((c) => c.rotulo.toLowerCase()).join("; ")}`);
  if (r.tentativas.esgotou) {
    limpar($("#painel-feedback")).append(avisoTentativasEsgotadas(r.tentativas.maximo));
    return;
  }
  if (pendencias.length) {
    limpar($("#painel-feedback")).append(
      aviso("atencao", "Falta isto antes de pedir feedback:", pendencias.map((t) => `- ${t}`).join("\n"))
    );
    toast("Veja o que falta, logo abaixo do botão.");
    return;
  }

  const botao = $("#b-feedback");
  const status = $("#status-feedback");
  botao.disabled = true;
  status.replaceChildren(el("span.carregando", { texto: "avaliando" }));

  const nomeCriterio = (id) => criterioDaRubrica(estado.rubrica, id)?.nome || id;
  const usuario = [
    `PERGUNTA DE PESQUISA: ${p.pergunta}`,
    "",
    "ESCOLHAS DO GRUPO:",
    `- variável resposta: ${r.analise.y} (tipo ${tipoDe(r.analise.y)})`,
    `- variável explicativa: ${r.analise.x} (tipo ${tipoDe(r.analise.x)})`,
    `- método: ${r.analise.metodo}`,
    "",
    "CÓDIGO EXECUTADO:",
    r.analise.codigo,
    "",
    "SAÍDA DA ANÁLISE (é contra estes números que você deve conferir as respostas):",
    r.analise.texto,
    "",
    "RESPOSTAS DO GRUPO, dirigidas a uma pessoa do Direito, item a item (entre colchetes, o critério " +
      "da rubrica que cada item atende):",
    ...estado.config.campos.map(
      (c) => `- ${c.rotulo} [${c.criterio}: ${nomeCriterio(c.criterio)}]: ${r.campos[c.id].trim()}`
    ),
    "",
    r.feedbacks.length
      ? `Avaliação ${r.feedbacks.length + 1} de ${r.tentativas.maximo} desta pergunta. ` +
        "Antes você apontou: " + r.feedbacks.map((f) => f.proximo_passo).join(" | ")
      : `Primeira avaliação desta pergunta (de ${r.tentativas.maximo}).`,
    "",
    rubricaEmTexto(estado.rubrica),
    "",
    "Devolva JSON com criterios (id, nivel, comentario, evidencia, sugestao), resumo, " +
      "proximo_passo e pontos_fortes. Em 'correspondencia', cite o número da saída que " +
      "contraria as respostas, se houver.",
  ].join("\n");

  try {
    const resposta = await chamar({
      tarefa: "ex05_feedback",
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
    if (estado.pergunta === p) {
      limpar($("#painel-feedback")).append(
        painelFeedback({
          feedback: resposta.dados,
          rubrica: estado.rubrica,
          iteracao: r.feedbacks.length,
          criterioDaRubrica,
        }),
        r.tentativas.esgotou ? avisoTentativasEsgotadas(r.tentativas.maximo) : null
      );
      status.replaceChildren(el("span.etiqueta", { texto: r.tentativas.texto() }));
      estado.passos.ir(4);
    }
    await registrarSubmissao({
      exercicio: EXERCICIO,
      etapa: "feedback",
      identificacao: estado.identidade,
      pergunta_id: p.id,
      escolha: { y: r.analise.y, x: r.analise.x, metodo: r.analise.metodo },
      iteracao: r.feedbacks.length,
      respostas: { ...r.campos },
      feedback: resposta.dados,
      modelo: resposta.modelo,
      monitoramento: estado.guarda.resumo(),
    });
  } catch (erro) {
    if (estado.pergunta === p) {
      status.replaceChildren(el("span.etiqueta.erro", { texto: "falhou" }));
      limpar($("#painel-feedback")).append(
        aviso("erro", "Não consegui avaliar agora", String(erro.message || erro))
      );
    }
  } finally {
    if (estado.pergunta === p) r.tentativas.aplicar($("#contador-feedback"), botao);
  }
}

function tipoDe(nome) {
  return estado.meta.variaveis.find((v) => v.nome === nome)?.tipo || null;
}

/* ---------- entrega ----------------------------------------------------- */

async function fechar() {
  const perguntas = estado.config.perguntas;
  const faltam = perguntas
    .map((p, i) => ({ p, i, r: estado.respostas[p.id] }))
    .filter(({ r }) => !completa(r));

  // Entregar incompleto é permitido, porque o prazo é o fim da aula, mas pede um
  // segundo clique: o grupo precisa saber que está deixando pergunta de fora.
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
      `- Iterações de feedback: ${r.feedbacks.length}`,
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
    "# Projeto 5 - Testes de hipóteses nas Câmaras Criminais do TJSP",
    "CDAD II · 2026/2 · Insper",
    "",
    `- Integrantes: ${estado.identidade.integrantes.join(", ")}`,
    `- Fechado em: ${agora()}`,
    `- Perguntas prontas: ${perguntas.length - faltam.length} de ${perguntas.length}`,
    "",
    ...perguntas.flatMap(secao),
  ].join("\n");

  const hash = await sha256(conteudo);
  const nome = `ex05_${chaveDoGrupo(estado.identidade).replace(/\+/g, "-")}.md`;
  baixar(nome, conteudo, "text/markdown;charset=utf-8");

  const resultado = await registrarSubmissao({
    exercicio: EXERCICIO,
    etapa: "final",
    identificacao: estado.identidade,
    respostas: Object.fromEntries(perguntas.map((p) => {
      const r = estado.respostas[p.id];
      return [p.id, {
        escolha: r.analise ? { y: r.analise.y, x: r.analise.x, metodo: r.analise.metodo } : null,
        campos: { ...r.campos },
        iteracoes_de_feedback: r.feedbacks.length,
      }];
    })),
    perguntas_prontas: perguntas.length - faltam.length,
    hash_arquivo: hash,
    monitoramento: estado.guarda.resumo(),
  });

  estado.passos.ir(5);
  $("#s-entrega").classList.add("concluida");
  limpar($("#painel-entrega")).append(
    aviso(
      resultado.ok ? "ok" : "atencao",
      "Entrega gerada",
      "Baixamos o arquivo markdown com as análises e as respostas. Entregue esse arquivo no BlackBoard."
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
