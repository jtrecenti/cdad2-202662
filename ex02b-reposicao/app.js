/* ==========================================================================
   Projeto 2, reposição (aula 06) - Montar o gráfico na ordem certa.

   Mesma mecânica e mesma rubrica do ex02, com quatro desafios diferentes sobre
   a mesma base. Existe para quem não pôde fazer o projeto na data da turma, e
   fica com id próprio (ex02b) para a submissão não se confundir com a original.

   O aluno leva blocos de pandas e de plotnine para duas esteiras, na ordem em
   que devem rodar. O código aparece montado ao lado enquanto ele monta (não só
   depois de rodar), e o gráfico produzido fica ao lado do gráfico pedido, para
   comparação direta.

   Duas regras de correção, diferentes de propósito:
   - pandas: a ordem exata importa, porque filtrar antes ou depois de agrupar dá
     números diferentes;
   - plotnine: depois do ggplot(), qualquer ordem serve, porque labs() antes ou
     depois de coord_flip() produz o mesmo gráfico. Exigir ordem ali seria cobrar
     uma regra que a biblioteca não tem.
   ========================================================================== */

import { ativar } from "../_shared/guardrails.js";
import { exigirIdentificacao } from "../_shared/identidade.js";
import { registrarSubmissao } from "../_shared/firebase.js";
import { exigirLiberacao } from "../_shared/liberacao.js";
import { carregar, rodar } from "../_shared/pyodide.js";
import { painelRubrica } from "../_shared/rubrica.js";
import {
  $, $$, el, limpar, aviso, toast, montarTopo, montarPassos, tabela, baixar, sha256, agora,
  embaralharCom,
} from "../_shared/ui.js";

const EXERCICIO = "ex02b";

const estado = {
  identidade: null,
  guarda: null,
  py: null,
  config: null,
  meta: null,
  rubrica: null,
  indice: 0,
  desafio: null,
  pandas: [],
  plot: [],
  tentativas: 0,
  // tentativas erradas somadas em TODOS os desafios: é sobre elas que incide o
  // desconto, e por isso o contador não zera ao trocar de desafio
  errosTotal: 0,
  // ordem em que os blocos aparecem no banco, sorteada uma vez por desafio
  blocos: [],
  resolvidos: [],
  passos: null,
};

// Os quatro desafios valem o mesmo, somando 10, e cada tentativa errada custa
// PENALIDADE. É diferente do projeto 2 da turma, que soma 11 pontos possíveis e
// limita a nota a 10: lá a folga vem de os desafios terem pesos desiguais. Aqui
// os pontos possíveis já são a nota máxima, então não há folga.
const PENALIDADE = 0.25;
const NOTA_MAXIMA = 10;

function pontosPorDesafio() {
  return NOTA_MAXIMA / estado.config.desafios.length;
}

function pontosGanhos() {
  return estado.resolvidos.length * pontosPorDesafio();
}

function desconto() {
  return estado.errosTotal * PENALIDADE;
}

function nota() {
  return Math.max(0, Math.min(NOTA_MAXIMA, pontosGanhos() - desconto()));
}

/** 7 vira "7", 6,75 vira "6,75": nota com vírgula e sem zero à toa. */
function comVirgula(n) {
  return String(Number(n.toFixed(2))).replace(".", ",");
}

/* ---------- arranque ----------------------------------------------------- */

async function iniciar() {
  montarTopo({
    exercicio: "Projeto 2 · reposição",
    aula: "aula 06",
    titulo: "Montar o gráfico na ordem certa",
  });
  const liberacao = await exigirLiberacao(EXERCICIO);
  if (!liberacao.liberado) return;

  estado.passos = montarPassos(["ambiente", "desafio 1", "desafio 2", "desafio 3", "desafio 4", "fechar"]);
  estado.passos.ir(0);

  estado.identidade = await exigirIdentificacao({
    exercicio: EXERCICIO,
    emGrupo: false,
    titulo: "Projeto 2 (reposição) · quem está fazendo",
    explicacao:
      "Projeto individual. Cópia e cola estão bloqueados: o objetivo é ordenar as operações, " +
      "não digitar código de fora.",
  });
  estado.guarda = ativar({ exercicio: EXERCICIO });

  [estado.config, estado.rubrica] = await Promise.all([
    fetch("desafios.json").then((r) => r.json()),
    fetch("../rubricas/ex02-graficos.json").then((r) => r.json()),
  ]);
  estado.meta = await fetch(estado.config.base.meta).then((r) => r.json());
  limpar($("#painel-rubrica")).append(painelRubrica(estado.rubrica));

  $("#b-carregar").addEventListener("click", carregarAmbiente);
  $("#b-rodar").addEventListener("click", rodarPipeline);
  $("#b-limpar").addEventListener("click", () => {
    estado.pandas = [];
    estado.plot = [];
    desenharBlocos();
  });
  $("#b-proximo").addEventListener("click", proximoDesafio);
  $("#b-fechar").addEventListener("click", fechar);
}

async function carregarAmbiente() {
  const botao = $("#b-carregar");
  const status = $("#status-ambiente");
  botao.disabled = true;
  try {
    estado.py = await carregar({
      pacotes: ["pandas", "matplotlib", "scipy", "statsmodels"],
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
import pandas as pd, matplotlib
matplotlib.use("agg")
import plotnine
camaras = pd.read_csv("/camaras.csv")
{"linhas": int(camaras.shape[0]), "colunas": int(camaras.shape[1]),
 "plotnine": plotnine.__version__, "pandas": pd.__version__}
`
    );
    status.replaceChildren(
      el("span.etiqueta.ok", { texto: `pandas ${info.pandas} · plotnine ${info.plotnine}` })
    );
    mostrarResumoBase(info);
    $("#s-ambiente").classList.add("concluida");
    $("#s-desafio").classList.remove("travada");
    carregarDesafio(0);
  } catch (erro) {
    botao.disabled = false;
    status.replaceChildren(el("span.etiqueta.erro", { texto: "falhou" }));
    limpar($("#resumo-base")).append(
      aviso("erro", "Não consegui carregar o ambiente", String(erro.message || erro))
    );
  }
}

function classeTipo(tipo) {
  if (tipo.startsWith("numerica")) return "tipo-num";
  if (tipo === "identificador") return "tipo-id";
  return "tipo-cat";
}

function mostrarResumoBase(info) {
  limpar($("#resumo-base")).append(
    el("div.ficha", {}, [
      el("span.rotulo", { texto: `base camaras · ${info.linhas} recursos · ${info.colunas} colunas` }),
      el("div.miudo", { texto: estado.meta.fonte }),
      el("div.rolagem", { style: "margin-top:.6rem;max-height:30rem" }, [
        el("table", {}, [
          el("thead", {}, [
            el("tr", {}, ["variável", "tipo", "descrição"].map((t) => el("th", { texto: t }))),
          ]),
          el("tbody", {}, estado.meta.variaveis.map((v) =>
            el("tr", {}, [
              el("td", {}, [el("code", { texto: v.nome })]),
              el("td", {}, [el(`span.etiqueta.${classeTipo(v.tipo)}`, { texto: v.tipo.replace(/_/g, " ") })]),
              el("td", { texto: v.descricao }),
            ])
          )),
        ]),
      ]),
    ])
  );
}

/* ---------- desafios ----------------------------------------------------- */

function carregarDesafio(indice) {
  estado.indice = indice;
  estado.desafio = estado.config.desafios[indice];
  estado.pandas = [];
  estado.plot = [];
  estado.tentativas = 0;
  estado.blocos = sortearBanco(estado.desafio);
  estado.passos.ir(indice + 1);

  $("#titulo-desafio").textContent =
    `Desafio ${indice + 1} de ${estado.config.desafios.length}: ${estado.desafio.titulo}`;
  limpar($("#enunciado-desafio")).append(
    el("p.enunciado", {}, [el("strong", { texto: "Pergunta: " }), estado.desafio.pergunta]),
    aviso("atencao", "O gráfico esperado", estado.desafio.grafico_esperado)
  );
  $("#figura-esperada").src = estado.desafio.imagem;
  $("#figura-esperada-2").src = estado.desafio.imagem;
  esconderMeuGrafico();
  limpar($("#avaliacao"));
  limpar($("#tabela-dados"));
  // sem isso, o "é isso" do desafio anterior continua no alto do desafio novo,
  // dizendo que está certo algo que ainda nem foi montado
  limpar($("#status-rodada"));
  // dá para seguir sem resolver: travar o avanço só transformaria um desafio
  // difícil em desistência do projeto inteiro
  $("#b-proximo").disabled = estado.indice + 1 >= estado.config.desafios.length;
  atualizarPlacar();
  desenharBlocos();
}

function esconderMeuGrafico() {
  $("#figura").style.display = "none";
  $("#figura").removeAttribute("src");
  $("#aguardando-figura").style.display = "";
  $("#aguardando-figura").textContent = "clique em Rodar para ver";
}

function atualizarPlacar() {
  const alvo = limpar($("#placar"));
  alvo.append(
    el("span.etiqueta", {
      texto: `resolvidos: ${estado.resolvidos.length}/${estado.config.desafios.length}`,
    }),
    el("span.etiqueta", {
      texto: `pontos: ${comVirgula(pontosGanhos())}/${NOTA_MAXIMA}`,
    })
  );
  if (estado.errosTotal) {
    alvo.append(el("span.etiqueta.alerta", {
      texto: `${estado.errosTotal} erro${estado.errosTotal > 1 ? "s" : ""}: −${comVirgula(desconto())}`,
    }));
  }
  alvo.append(el("span.etiqueta.ok", { texto: `nota: ${comVirgula(nota())}` }));
}

/**
 * A ordem dos blocos no banco, sorteada uma vez por desafio.
 *
 * No JSON os blocos certos vêm primeiro, porque é assim que se escreve e se
 * confere o arquivo. Mostrar nessa ordem entrega metade da resposta: bastava
 * pegar os de cima. O sorteio é semeado pelo e-mail e pelo id do desafio, e não
 * aleatório de verdade, porque `desenharBlocos()` roda a cada movimento: com
 * `Math.random()` os blocos dançariam na tela a cada clique.
 *
 * Pandas e plotnine continuam separados, cada grupo embaralhado por dentro: são
 * duas esteiras diferentes, e misturar os dois no banco só atrapalharia a
 * leitura sem dificultar a escolha.
 */
function sortearBanco(desafio) {
  const semente = `${estado.identidade?.email || "anon"}:${desafio.id}`;
  return [
    ...embaralharCom(`${semente}:pandas`, desafio.blocos_pandas)
      .map((b) => ({ ...b, tipo: "pandas" })),
    ...embaralharCom(`${semente}:plotnine`, desafio.blocos_plotnine)
      .map((b) => ({ ...b, tipo: "plotnine" })),
  ];
}

function todosBlocos() {
  return estado.blocos;
}

function blocoDe(tipo, id) {
  return todosBlocos().find((b) => b.tipo === tipo && b.id === id);
}

/* ---------- desenho dos blocos ------------------------------------------ */

function desenharBlocos() {
  const banco = limpar($("#banco"));
  const usados = new Set([
    ...estado.pandas.map((id) => `pandas:${id}`),
    ...estado.plot.map((id) => `plotnine:${id}`),
  ]);
  const disponiveis = todosBlocos().filter((b) => !usados.has(`${b.tipo}:${b.id}`));
  if (!disponiveis.length) banco.append(el("p.miudo", { texto: "todos os blocos estão em uso" }));
  for (const b of disponiveis) banco.append(cartaoBloco(b, null));

  desenharZona("#zona-pandas", "pandas", estado.pandas);
  desenharZona("#zona-plotnine", "plotnine", estado.plot);
  atualizarCodigo();
}

function desenharZona(seletor, tipo, lista) {
  const zona = limpar($(seletor));
  zona.classList.toggle("vazia", lista.length === 0);
  if (!lista.length) {
    zona.append(el("span.bloco"));
    return;
  }
  lista.forEach((id, posicao) => {
    const b = blocoDe(tipo, id);
    if (b) zona.append(cartaoBloco(b, posicao));
  });
}

function cartaoBloco(b, posicao) {
  const naEsteira = posicao != null;
  const cartao = el(`div.bloco.${b.tipo}`, { dataset: { id: b.id, tipo: b.tipo } });

  const controles = el("div.mover");
  if (naEsteira) {
    controles.append(
      el("button.secundario", { type: "button", texto: "↑", title: "subir", onclick: () => mover(b.tipo, posicao, -1) }),
      el("button.secundario", { type: "button", texto: "↓", title: "descer", onclick: () => mover(b.tipo, posicao, +1) }),
      el("button.secundario", { type: "button", texto: "×", title: "devolver", onclick: () => remover(b.tipo, posicao) })
    );
  } else {
    controles.append(
      el("button.secundario", { type: "button", texto: "→", title: "usar", onclick: () => adicionar(b.tipo, b.id) })
    );
  }

  cartao.append(
    el("span.ordem", { texto: naEsteira ? String(posicao + 1) : "" }),
    el("code", { texto: b.codigo }),
    controles
  );
  return cartao;
}

function lista(tipo) {
  return tipo === "pandas" ? estado.pandas : estado.plot;
}

function adicionar(tipo, id, posicao = null) {
  const alvo = lista(tipo);
  if (alvo.includes(id)) return;
  if (posicao == null) alvo.push(id);
  else alvo.splice(posicao, 0, id);
  desenharBlocos();
}

function remover(tipo, posicao) {
  lista(tipo).splice(posicao, 1);
  desenharBlocos();
}

function mover(tipo, posicao, delta) {
  const alvo = lista(tipo);
  const nova = posicao + delta;
  if (nova < 0 || nova >= alvo.length) return;
  [alvo[posicao], alvo[nova]] = [alvo[nova], alvo[posicao]];
  desenharBlocos();
}

/* ---------- código montado (ao vivo) ------------------------------------ */

function montarCodigo() {
  const linhasPandas = estado.pandas.map((id) => `    ${blocoDe("pandas", id).codigo}`);
  const linhasPlot = estado.plot.map((id) => `    ${blocoDe("plotnine", id).codigo}`);
  return [
    "import pandas as pd",
    "from plotnine import *",
    "",
    "dados = (",
    "    camaras",
    ...(linhasPandas.length ? linhasPandas : ["    # adicionar as operações"]),
    ")",
    "",
    "g = (",
    ...(linhasPlot.length ? linhasPlot : ["    # ggplot aqui"]),
    ")",
  ].join("\n");
}

/**
 * O painel mostra o esqueleto desde o começo, com comentários no lugar dos
 * blocos que faltam. Assim o aluno vê onde cada bloco vai entrar antes de
 * escolher o primeiro, e o painel não muda de tamanho quando ele escolhe.
 */
function atualizarCodigo() {
  const alvo = $("#codigo-montado");
  alvo.classList.toggle("vazio", !estado.pandas.length && !estado.plot.length);
  alvo.textContent = montarCodigo();
}

/* ---------- execução ---------------------------------------------------- */

async function rodarPipeline() {
  if (!estado.py) return toast("Carregue o ambiente primeiro.");
  if (!estado.pandas.length && !estado.plot.length) {
    return toast("Leve blocos para as esteiras antes de rodar.");
  }
  const codigo = montarCodigo();
  const status = $("#status-rodada");
  status.replaceChildren(el("span.carregando", { texto: "rodando" }));
  estado.tentativas += 1;
  atualizarPlacar();

  const script = `
import io, base64, traceback
import pandas as pd
saida = {"erro": None, "png": None, "verificacao": None, "cabeca": None, "colunas": None, "linhas": None}
try:
${codigo.split("\n").map((l) => "    " + l).join("\n")}
    saida["linhas"] = int(dados.shape[0])
    saida["colunas"] = list(map(str, dados.columns))
    saida["cabeca"] = dados.head(8).astype(str).to_dict(orient="records")
    buf = io.BytesIO()
    g.save(buf, format="png", width=7, height=4.5, dpi=110, verbose=False)
    saida["png"] = base64.b64encode(buf.getvalue()).decode()
    try:
        saida["verificacao"] = bool(${estado.desafio.verificacao})
    except Exception as e:
        saida["verificacao"] = False
        saida["erro_verificacao"] = str(e)
except Exception:
    saida["erro"] = traceback.format_exc(limit=2)
saida
`;

  let saida;
  try {
    saida = await rodar(estado.py, script);
  } catch (erro) {
    status.replaceChildren(el("span.etiqueta.erro", { texto: "erro" }));
    limpar($("#avaliacao")).append(aviso("erro", "Erro ao rodar", String(erro.message || erro)));
    return;
  }

  if (saida.png) {
    $("#figura").src = `data:image/png;base64,${saida.png}`;
    $("#figura").style.display = "";
    $("#aguardando-figura").style.display = "none";
  } else {
    esconderMeuGrafico();
    $("#aguardando-figura").textContent = "o código não chegou a produzir gráfico";
  }

  limpar($("#tabela-dados"));
  if (saida.cabeca?.length) {
    $("#tabela-dados").append(
      el("span.rotulo", { texto: `tabela resultante (${saida.linhas} linhas)` }),
      tabela(saida.colunas, saida.cabeca)
    );
  }

  if (saida.erro) {
    status.replaceChildren(el("span.etiqueta.erro", { texto: "o Python reclamou" }));
    limpar($("#avaliacao")).append(
      aviso("erro", "Erro no seu código", "Leia a última linha do traceback: é ela que diz o que faltou."),
      el("pre", {}, [el("code", { texto: saida.erro })]),
      diagnostico()
    );
    penalizar();
    atualizarPlacar();
    registrarTentativa(false, codigo, saida.erro);
    return;
  }

  const certo = Boolean(saida.verificacao) && ordemCorreta();
  status.replaceChildren(
    el(`span.etiqueta.${certo ? "ok" : "alerta"}`, {
      texto: certo ? "é isso" : "rodou, mas não é o gráfico pedido",
    })
  );
  limpar($("#avaliacao")).append(
    certo
      ? aviso("ok", "É isso 🎉", "Compare os dois gráficos e repare no que cada bloco fez antes de seguir.")
      : aviso(
          "atencao",
          "Rodou, mas não é o que a pergunta pede",
          "Compare o seu gráfico com o esperado, ao lado. A diferença aponta o bloco que falta ou sobra."
        ),
    diagnostico()
  );

  if (certo) {
    if (!estado.resolvidos.some((r) => r.desafio === estado.desafio.id)) {
      estado.resolvidos.push({
        desafio: estado.desafio.id,
        tentativas: estado.tentativas,
        codigo,
      });
    }
    if (estado.resolvidos.length === estado.config.desafios.length) {
      estado.passos.ir(estado.config.desafios.length + 1);
    }
  } else {
    penalizar();
  }
  atualizarPlacar();
  registrarTentativa(certo, codigo, null);
}

/**
 * Conta mais uma tentativa errada e avisa quanto ela custou.
 *
 * O desconto aparece na hora, e não só no fim: uma penalidade que o aluno
 * descobre depois não muda o comportamento dele, só a nota.
 */
function penalizar() {
  estado.errosTotal += 1;
  toast(`Tentativa errada: −${comVirgula(PENALIDADE)} ponto. Nota agora: ${comVirgula(nota())}`);
}

/** Aponta bloco indevido e ordem trocada, sem entregar a resposta. */
function diagnostico() {
  const caixa = el("div", { style: "margin-top:.6rem" });
  const indevidos = [
    ...estado.pandas.map((id) => blocoDe("pandas", id)),
    ...estado.plot.map((id) => blocoDe("plotnine", id)),
  ].filter((b) => b && !b.usar);

  for (const b of indevidos) {
    caixa.append(
      el("div.aviso.atencao", {}, [
        el("strong", {}, [el("code", { texto: b.codigo })]),
        el("span", { texto: b.porque_nao }),
      ])
    );
  }
  if (!indevidos.length && !ordemCorreta()) {
    const problema = diferencaDeOrdem();
    caixa.append(aviso("atencao", problema.titulo, problema.texto));
  }
  return caixa;
}

function esperados(tipo) {
  const blocos = tipo === "pandas" ? estado.desafio.blocos_pandas : estado.desafio.blocos_plotnine;
  return blocos.filter((b) => b.usar);
}

function ordemCorreta() {
  // pandas: sequência exata
  const pandasEsperado = esperados("pandas")
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((b) => b.id);
  if (JSON.stringify(estado.pandas) !== JSON.stringify(pandasEsperado)) return false;

  // plotnine: mesmo conjunto, com o ggplot() na frente
  const plotEsperado = esperados("plotnine").map((b) => b.id);
  const mesmos =
    estado.plot.length === plotEsperado.length &&
    [...estado.plot].sort().join() === [...plotEsperado].sort().join();
  if (!mesmos) return false;
  const primeiro = esperados("plotnine").find((b) => b.primeiro);
  return !primeiro || estado.plot[0] === primeiro.id;
}

function diferencaDeOrdem() {
  const pandasEsperado = esperados("pandas")
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((b) => b.id);
  const plotEsperado = esperados("plotnine").map((b) => b.id);
  const faltaPandas = pandasEsperado.filter((id) => !estado.pandas.includes(id)).length;
  const faltaPlot = plotEsperado.filter((id) => !estado.plot.includes(id)).length;

  if (faltaPandas || faltaPlot) {
    return {
      titulo: "Falta bloco na esteira",
      texto:
        "Ainda há bloco necessário no banco. Compare o seu gráfico com o esperado: o que está " +
        "faltando na figura costuma indicar o bloco que falta no código.",
    };
  }
  const primeiro = esperados("plotnine").find((b) => b.primeiro);
  if (primeiro && estado.plot[0] !== primeiro.id) {
    return {
      titulo: "O gráfico começa pelo ggplot()",
      texto: "As camadas com + vêm depois, porque somam algo a um gráfico que já existe.",
    };
  }
  return {
    titulo: "Os blocos certos, na ordem errada",
    texto:
      "No pandas a sequência muda o resultado. Pergunte-se, para cada bloco: ele usa alguma " +
      "coluna que outro bloco precisa ter criado antes?",
  };
}

function proximoDesafio() {
  if (estado.indice + 1 < estado.config.desafios.length) carregarDesafio(estado.indice + 1);
}

function registrarTentativa(certo, codigo, erro) {
  registrarSubmissao({
    exercicio: EXERCICIO,
    etapa: "tentativa",
    identificacao: estado.identidade,
    desafio: estado.desafio.id,
    tentativa: estado.tentativas,
    correto: certo,
    blocos_pandas: [...estado.pandas],
    blocos_plotnine: [...estado.plot],
    blocos_indevidos: [
      ...estado.pandas.map((id) => blocoDe("pandas", id)),
      ...estado.plot.map((id) => blocoDe("plotnine", id)),
    ]
      .filter((b) => b && !b.usar)
      .map((b) => b.id),
    codigo,
    erro_python: erro ? String(erro).slice(0, 1200) : null,
    monitoramento: estado.guarda.resumo(),
  });
}

/* ---------- fechamento -------------------------------------------------- */

async function fechar() {
  const botao = $("#b-fechar");
  botao.disabled = true;
  const conteudo = [
    "# Projeto 2 (aula 06), reposição - CDAD II 2026/2",
    `# ${estado.identidade.email}`,
    `# fechado em ${agora()}`,
    `# nota: ${comVirgula(nota())} de ${NOTA_MAXIMA} ` +
      `(${comVirgula(pontosGanhos())} de ${NOTA_MAXIMA} pontos, ` +
      `${estado.errosTotal} tentativas erradas)`,
    "",
    ...estado.resolvidos.flatMap((r, i) => {
      const desafio = estado.config.desafios.find((d) => d.id === r.desafio);
      return [
        `# ---- Desafio ${i + 1}: ${desafio.titulo}`,
        `# Pergunta: ${desafio.pergunta}`,
        `# tentativas: ${r.tentativas}`,
        r.codigo,
        "",
      ];
    }),
  ].join("\n");
  const hash = await sha256(conteudo);

  const resultado = await registrarSubmissao({
    exercicio: EXERCICIO,
    etapa: "final",
    identificacao: estado.identidade,
    resolvidos: estado.resolvidos.map(({ codigo, ...resto }) => resto),
    total_tentativas: estado.resolvidos.reduce((s, r) => s + r.tentativas, 0),
    pontos: pontosGanhos(),
    pontos_possiveis: NOTA_MAXIMA,
    erros: estado.errosTotal,
    desconto: desconto(),
    nota: nota(),
    hash_codigo: hash,
    monitoramento: estado.guarda.resumo(),
  });

  $("#status-fim").replaceChildren(
    el(`span.etiqueta.${resultado.ok ? "ok" : "erro"}`, {
      texto: resultado.ok ? "registrado" : "registro falhou",
    })
  );
  limpar($("#painel-fim")).append(
    el("div.ficha.destaque", {}, [
      el("span.rotulo", { texto: "resumo" }),
      el("div", {
        html:
          `Desafios resolvidos: <strong>${estado.resolvidos.length}</strong> de ` +
          `${estado.config.desafios.length} · pontos: ` +
          `<strong>${comVirgula(pontosGanhos())}</strong> de ${NOTA_MAXIMA} · ` +
          `tentativas erradas: <strong>${estado.errosTotal}</strong> ` +
          `(−${comVirgula(desconto())})`,
      }),
      el("div", { html: `<strong>Nota: ${comVirgula(nota())}</strong> de ${NOTA_MAXIMA}` }),
      el("div.mono.miudo", { texto: `código de verificação: ${hash}` }),
    ]),
    el("div.acoes", { style: "margin-top:.6rem" }, [
      el("button.principal", {
        type: "button",
        texto: "baixar o arquivo com os quatro códigos",
        onclick: () =>
          baixar(`ex02b_${estado.identidade.email.split("@")[0]}.py`, conteudo, "text/x-python;charset=utf-8"),
      }),
    ])
  );
  $("#s-fim").classList.add("concluida");
  botao.disabled = false;
}

iniciar().catch((erro) => {
  document.body.prepend(aviso("erro", "Erro ao iniciar", String(erro.message || erro)));
});
