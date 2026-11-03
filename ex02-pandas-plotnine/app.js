/* ==========================================================================
   Projeto 2 (aula 06) - Montar o gráfico na ordem certa.

   O grupo leva blocos de pandas e de plotnine para duas esteiras, na ordem em
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
import { avisoEstudo, exigirLiberacao, modoEstudo } from "../_shared/liberacao.js";
import { carregar, rodar } from "../_shared/pyodide.js";
import { painelRubrica } from "../_shared/rubrica.js";
import {
  $, $$, el, limpar, aviso, toast, montarTopo, montarPassos, tabela, baixar, sha256, agora,
} from "../_shared/ui.js";

const EXERCICIO = "ex02";

const estado = {
  identidade: null,
  guarda: null,
  estudo: false,
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
  resolvidos: [],
  passos: null,
};

// Cada desafio vale o seu `peso` (1 no primeiro, 2 nos outros, somando 11) e
// cada tentativa errada custa PENALIDADE. A nota é limitada a 10, então sobram
// quatro erros de folga para quem fizer os seis.
const PENALIDADE = 0.25;
const NOTA_MAXIMA = 10;

function pontosPossiveis() {
  return estado.config.desafios.reduce((s, d) => s + (d.peso ?? 1), 0);
}

function pontosGanhos() {
  return estado.resolvidos.reduce((s, r) => {
    const d = estado.config.desafios.find((x) => x.id === r.desafio);
    return s + (d?.peso ?? 1);
  }, 0);
}

function desconto() {
  return estado.errosTotal * PENALIDADE;
}

function nota() {
  return Math.max(0, Math.min(NOTA_MAXIMA, pontosGanhos() - desconto()));
}

/** 7 vira "7", 6.75 vira "6,75": nota com vírgula e sem zero à toa. */
function comVirgula(n) {
  return String(Number(n.toFixed(2))).replace(".", ",");
}

/* ---------- arranque ----------------------------------------------------- */

async function iniciar() {
  montarTopo({
    exercicio: "Projeto 2",
    aula: "aula 06",
    titulo: "Montar o gráfico na ordem certa",
  });
  const liberacao = await exigirLiberacao(EXERCICIO);
  if (!liberacao.liberado) return;

  // passado o prazo, o projeto vira material de estudo: sem identificação, sem
  // bloqueio de cópia e cola e sem registro. Ver `modoEstudo` em liberacao.js.
  estado.estudo = modoEstudo(liberacao);
  if (estado.estudo) {
    $(".abertura").prepend(avisoEstudo());
    estado.identidade = { email: "estudo", integrantes: [], em_grupo: false };
    estado.guarda = { resumo: () => ({ modo: "estudo" }) };
  } else {
    estado.identidade = await exigirIdentificacao({
      exercicio: EXERCICIO,
      emGrupo: true,
      titulo: "Projeto 2 · quem está fazendo",
      explicacao:
        "Trabalho em grupo. Coloque o seu e-mail e os e-mails do grupo; dá para corrigir " +
        "depois, no canto de cima da tela, se alguém ficar de fora. Cópia e cola estão " +
        "bloqueados: o objetivo é ordenar as operações, não digitar código de fora.",
    });
    estado.guarda = ativar({ exercicio: EXERCICIO });
  }

  [estado.config, estado.rubrica] = await Promise.all([
    fetch("desafios.json").then((r) => r.json()),
    fetch("../rubricas/ex02-graficos.json").then((r) => r.json()),
  ]);
  estado.meta = await fetch(estado.config.base.meta).then((r) => r.json());
  limpar($("#painel-rubrica")).append(painelRubrica(estado.rubrica));

  // a barra de passos sai do arquivo: com quatro desafios escritos a mao aqui,
  // tirar um do desafios.json deixava um passo fantasma na barra
  const nomes = estado.config.desafios.map((_, i) => `desafio ${i + 1}`);
  estado.passos = montarPassos(["ambiente", ...nomes, "fechar"]);
  estado.passos.ir(0);

  $("#b-carregar").addEventListener("click", carregarAmbiente);
  $("#b-rodar").addEventListener("click", rodarPipeline);
  $("#b-limpar").addEventListener("click", () => {
    estado.pandas = [];
    estado.plot = [];
    desenharBlocos();
  });
  $("#b-proximo").addEventListener("click", proximoDesafio);
  $("#b-anterior").addEventListener("click", desafioAnterior);
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
  estado.passos.ir(indice + 1);

  const total = estado.config.desafios.length;
  $("#numero-desafio").textContent = String(indice + 1).padStart(2, "0");
  $("#titulo-desafio").textContent =
    `Desafio ${indice + 1} de ${total}: ${estado.desafio.titulo}`;
  // o contexto vem antes da pergunta: sem ele a pergunta é uma tarefa solta, e
  // com ele é uma decisão sobre uma base de decisões judiciais
  limpar($("#enunciado-desafio")).append(
    estado.desafio.contexto
      ? el("p.enunciado", { texto: estado.desafio.contexto })
      : null,
    el("p.enunciado", {}, [el("strong", { texto: "Pergunta: " }), estado.desafio.pergunta]),
    aviso("atencao", "O gráfico esperado", estado.desafio.grafico_esperado)
  );
  $("#figura-esperada").src = estado.desafio.imagem;
  esconderMeuGrafico();
  limpar($("#avaliacao"));
  limpar($("#tabela-dados"));
  // dá para seguir sem resolver: travar o avanço só transformaria um desafio
  // difícil em desistência do projeto inteiro
  $("#b-anterior").disabled = indice === 0;
  // no último, o rótulo NÃO pode repetir o do botão de fechar lá embaixo: eram
  // dois botões iguais fazendo coisas diferentes, e o de cima parecia quebrado
  $("#b-proximo").textContent = indice + 1 >= total
    ? "Terminei os desafios, ir para a entrega ↓"
    : "Avançar para o próximo desafio →";
  atualizarPlacar();
  desenharBlocos();
  window.scrollTo({ top: 0 });  // sem `smooth`: ver a nota em proximoDesafio()
}

function esconderMeuGrafico() {
  $("#figura").style.display = "none";
  $("#figura").removeAttribute("src");
  $("#aguardando-figura").style.display = "";
  $("#aguardando-figura").textContent = "monte os blocos e clique em Rodar";
}

function atualizarPlacar() {
  const alvo = limpar($("#placar"));
  alvo.append(
    el("span.etiqueta", {
      texto: `resolvidos: ${estado.resolvidos.length}/${estado.config.desafios.length}`,
    }),
    el("span.etiqueta", { texto: `pontos: ${comVirgula(pontosGanhos())}/${pontosPossiveis()}` })
  );
  if (estado.errosTotal) {
    alvo.append(el("span.etiqueta.alerta", {
      texto: `${estado.errosTotal} erro${estado.errosTotal > 1 ? "s" : ""}: −${comVirgula(desconto())}`,
    }));
  }
  alvo.append(el("span.etiqueta.ok", { texto: `nota: ${comVirgula(nota())}` }));
}

function todosBlocos() {
  return [
    ...estado.desafio.blocos_pandas.map((b) => ({ ...b, tipo: "pandas" })),
    ...estado.desafio.blocos_plotnine.map((b) => ({ ...b, tipo: "plotnine" })),
  ];
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
    el("span.texto", {}, [
      // primeiro o que a operação faz, depois como ela se escreve
      b.descricao ? el("span.descricao", { texto: b.descricao }) : null,
      el("code", { texto: b.codigo }),
    ]),
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
function atualizarCodigo(linhaComErro = null) {
  const alvo = limpar($("#codigo-montado"));
  alvo.classList.toggle("vazio", !estado.pandas.length && !estado.plot.length);
  montarCodigo().split("\n").forEach((texto, i) => {
    const linha = el("span.linha", { texto: texto || " " });
    if (linhaComErro === i + 1) linha.classList.add("marcada");
    alvo.append(linha);
  });
}

/** A última linha do traceback: o tipo do erro e a mensagem. */
function mensagemDoErro(traceback) {
  const linhas = String(traceback).split("\n").filter((l) => l.trim());
  return linhas[linhas.length - 1] || String(traceback);
}

/**
 * A linha que o traceback aponta, no sistema de numeração do painel.
 *
 * Só funciona porque o código do aluno é compilado com nome próprio: o
 * traceback traz `File "o seu código", line N`, e esse N é a linha do painel.
 * Antes o N era do script que o app monta em volta, e não batia com nada que o
 * aluno pudesse ver.
 */
function linhaDoErro(traceback) {
  const achados = [...String(traceback).matchAll(/File "o seu código", line (\d+)/g)];
  if (!achados.length) return null;
  return Number(achados[achados.length - 1][1]);
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

  // O código vai em base64 para não precisar escapar aspas nem acentos, e é
  // compilado com nome próprio: assim o traceback numera as linhas do código
  // que o aluno vê no painel, e não as do embrulho que o app monta em volta.
  const fonte64 = btoa(String.fromCharCode(...new TextEncoder().encode(codigo)));
  const script = `
import io, base64, traceback
import pandas as pd
saida = {"erro": None, "png": None, "verificacao": None, "cabeca": None, "colunas": None, "linhas": None}
_fonte = base64.b64decode("${fonte64}").decode("utf-8")
try:
    exec(compile(_fonte, "o seu código", "exec"), globals())
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
    const linha = linhaDoErro(saida.erro);
    atualizarCodigo(linha);
    $("#det-codigo").open = true;
    status.replaceChildren(el("span.etiqueta.erro", { texto: "o Python reclamou" }));
    limpar($("#avaliacao")).append(
      aviso("erro", "Erro no seu código", linha
        ? `O erro está na linha ${linha} do código que você montou, marcada em `
          + "vermelho no painel do código."
        : "O Python não conseguiu rodar o código que você montou."),
      // a mensagem final em destaque, e o traceback inteiro recolhido: as
      // primeiras linhas do traceback são arquivos do pandas, que não dizem
      // nada a quem está montando blocos. Quem diz é a última.
      el("pre", {}, [el("code", { texto: mensagemDoErro(saida.erro) })]),
      el("details", { style: "margin-top:.4rem" }, [
        el("summary", { texto: "o erro completo (traceback)" }),
        el("pre", {}, [el("code", { texto: saida.erro })]),
      ]),
      diagnostico()
    );
    penalizar();
    registrarTentativa(false, codigo, saida.erro);
    return;
  }
  atualizarCodigo();

  const certo = Boolean(saida.verificacao) && ordemCorreta();
  const jaResolvido = estado.resolvidos.some((r) => r.desafio === estado.desafio.id);
  if (!certo) penalizar();
  status.replaceChildren(
    el(`span.etiqueta.${certo ? "ok" : "alerta"}`, {
      texto: certo ? "é isso" : "rodou, mas não é o gráfico pedido",
    })
  );
  limpar($("#avaliacao")).append(
    certo
      ? aviso("ok", "É isso 🎉", estado.desafio.reflexao
          ? `Agora olhe o gráfico e responda para você mesmo: ${estado.desafio.reflexao}`
          : "Compare os dois gráficos e repare no que cada bloco fez antes de seguir.")
      : aviso(
          "atencao",
          "Rodou, mas não é o que a pergunta pede",
          "Compare o seu gráfico com o esperado, ao lado. A diferença aponta o bloco que falta ou sobra."
        ),
    diagnostico()
  );

  if (certo) {
    if (!jaResolvido) {
      estado.resolvidos.push({
        desafio: estado.desafio.id,
        tentativas: estado.tentativas,
        codigo,
      });
    }
    if (estado.resolvidos.length === estado.config.desafios.length) {
      estado.passos.ir(estado.config.desafios.length + 1);
    }
  }
  atualizarPlacar();
  registrarTentativa(certo, codigo, null);
}

/**
 * Conta mais uma tentativa errada e avisa quanto isso custou.
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

/**
 * A ordem dos blocos de pandas, com três regras e um só objetivo: aceitar tudo
 * o que produz a tabela certa, e só isso.
 *
 * - `ordem: n` fixa a posição relativa;
 * - blocos com o MESMO n valem em qualquer sequência entre si, porque a tabela
 *   sai igual (os dois filtros do desafio 2);
 * - `livre: true` vale em QUALQUER posição, que é o caso de um filtro por uma
 *   coluna que também é chave do agrupamento: filtrar antes ou depois do
 *   groupby dá exatamente a mesma tabela.
 *
 * Sem a terceira regra, o desafio 4 reprovava quem punha o filtro do ano na
 * frente, embora o resultado fosse idêntico. Reprovar código certo é pior do
 * que aceitar código torto: manda o aluno procurar erro onde não há.
 */
function ordemCorreta() {
  const esperado = esperados("pandas");
  if (estado.pandas.length !== esperado.length) return false;
  if ([...estado.pandas].sort().join() !== esperado.map((b) => b.id).sort().join()) return false;

  // os livres saem da conta: onde quer que estejam, não mudam o resultado
  const fixosEsperados = esperado
    .filter((b) => !b.livre)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((b) => b.ordem ?? 0);
  const fixosMontados = estado.pandas
    .map((id) => blocoDe("pandas", id))
    .filter((b) => b && !b.livre)
    .map((b) => b.ordem ?? 0);
  if (JSON.stringify(fixosMontados) !== JSON.stringify(fixosEsperados)) return false;

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
  void pandasEsperado;
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
      "coluna que outro bloco precisa ter criado antes? Nem toda ordem importa, e o app " +
      "aceita as que dão a mesma tabela: se ele reclamou, alguma das suas de fato muda o " +
      "resultado.",
  };
}

function proximoDesafio() {
  if (estado.indice + 1 < estado.config.desafios.length) {
    carregarDesafio(estado.indice + 1);
    return;
  }
  // no último desafio o botão leva ao fechamento, que é o passo seguinte de
  // verdade. A seção pisca ao receber o foco: rolar sem sinal nenhum passava a
  // impressão de que o botão não tinha feito nada.
  estado.passos.ir(estado.config.desafios.length + 1);
  const fim = $("#s-fim");
  // scrollTo sem `behavior: smooth`, e não scrollIntoView: os dois caminhos
  // suaves são ignorados em parte dos navegadores, e o botão ficava sem efeito
  // nenhum. Rolar de uma vez é menos bonito e sempre funciona; quem sinaliza o
  // movimento é a moldura que pisca logo abaixo.
  const alvo = fim.getBoundingClientRect().top + window.scrollY - 12;
  window.scrollTo({ top: Math.max(0, alvo) });
  fim.classList.remove("piscar");
  void fim.offsetWidth;
  fim.classList.add("piscar");
}

function desafioAnterior() {
  if (estado.indice > 0) carregarDesafio(estado.indice - 1);
}

function registrarTentativa(certo, codigo, erro) {
  if (estado.estudo) return;  // em modo estudo nada vai para a base
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
  // o arquivo leva o grupo inteiro, e nao so quem clicou em submeter: e ele que
  // as pessoas guardam, e cada uma precisa reconhecer o proprio trabalho ali
  const integrantes = estado.identidade.integrantes || [estado.identidade.email];
  const conteudo = [
    "# Projeto 2 (aula 06) - CDAD II 2026/2",
    `# grupo: ${integrantes.join(", ")}`,
    `# submetido por: ${estado.identidade.email}`,
    `# fechado em ${agora()}`,
    `# nota: ${comVirgula(nota())} de ${NOTA_MAXIMA} ` +
      `(${comVirgula(pontosGanhos())} de ${pontosPossiveis()} pontos, ` +
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

  const observacoes = ($("#observacoes")?.value || "").trim().slice(0, 4000);

  const resultado = estado.estudo
    ? { ok: true, estudo: true }
    : await registrarSubmissao({
    exercicio: EXERCICIO,
    etapa: "final",
    identificacao: estado.identidade,
    resolvidos: estado.resolvidos.map(({ codigo, ...resto }) => resto),
    total_tentativas: estado.resolvidos.reduce((s, r) => s + r.tentativas, 0),
    pontos: pontosGanhos(),
    pontos_possiveis: pontosPossiveis(),
    erros: estado.errosTotal,
    desconto: desconto(),
    nota: nota(),
    observacoes,
    hash_codigo: hash,
    monitoramento: estado.guarda.resumo(),
      });

  $("#status-fim").replaceChildren(
    el(`span.etiqueta.${resultado.ok ? "ok" : "erro"}`, {
      texto: estado.estudo ? "modo estudo: nada registrado"
        : resultado.ok ? "registrado" : "registro falhou",
    })
  );
  limpar($("#painel-fim")).append(
    el("div.ficha.destaque", {}, [
      el("span.rotulo", { texto: "resumo" }),
      el("div", {
        html:
          `Desafios resolvidos: <strong>${estado.resolvidos.length}</strong> de ` +
          `${estado.config.desafios.length} · pontos: <strong>${comVirgula(pontosGanhos())}` +
          `</strong> de ${pontosPossiveis()} · tentativas erradas: ` +
          `<strong>${estado.errosTotal}</strong> (−${comVirgula(desconto())})`,
      }),
      el("div", {
        html: `<strong>Nota: ${comVirgula(nota())}</strong> de ${NOTA_MAXIMA}`,
      }),
      observacoes
        ? el("div.miudo", { texto: "As suas observações foram registradas junto." })
        : null,
      el("div.miudo", { texto: `grupo: ${integrantes.join(", ")}` }),
      el("div.mono.miudo", { texto: `código de verificação: ${hash}` }),
    ]),
    el("div.acoes", { style: "margin-top:.6rem" }, [
      el("button.principal", {
        type: "button",
        texto: "baixar o arquivo com os códigos",
        onclick: () =>
          baixar(`ex02_${estado.identidade.email.split("@")[0]}.py`, conteudo, "text/x-python;charset=utf-8"),
      }),
    ])
  );
  $("#s-fim").classList.add("concluida");
  botao.disabled = false;
}

iniciar().catch((erro) => {
  document.body.prepend(aviso("erro", "Erro ao iniciar", String(erro.message || erro)));
});
