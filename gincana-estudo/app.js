/* ==========================================================================
   Gincana para estudar (aula 5).

   A gincana da aula é uma atividade ao vivo: cronômetro do professor, número
   de grupo, envio dentro do tempo. Nada disso serve para quem vai revisar
   sozinho depois, e tudo isso depende do Worker. Esta página é a mesma
   atividade com o andaime retirado:

     - sem cronômetro, sem grupo, sem envio;
     - sem limite de execuções, porque aqui tentar de novo É o estudo;
     - roda inteira no navegador, sem rede depois que a página carrega.

   O gabarito continua fora daqui, e continua sendo o mesmo motivo de antes:
   com a resposta no cliente, a rodada vira copiar e colar, e o baralho não
   serviria para os próximos semestres. O feedback vem de outro lugar:

     - rodada de tabela: a impressão digital do resultado (um hash), que diz
       "bate" ou "não bate" sem mostrar a tabela certa;
     - rodada de gráfico: a imagem produzida ao lado da imagem pedida. Não há
       o que esconder ali, a figura já está no enunciado, e comparar as duas é
       exatamente o exercício.

   Quem estuda em casa não tem o baralho de papel na mesa, então as 40 cartas
   ficam consultáveis na própria página, e clicar numa delas preenche a
   próxima caixa vazia.
   ========================================================================== */

import { $, aviso, el, limpar, montarTopo } from "../_shared/ui.js";
import { carregar, rodar } from "../_shared/pyodide.js";

// os dois arquivos moram no app da aula: esta página é uma segunda porta para
// o mesmo material, e duplicá-los deixaria as duas versões desencontradas
const CARTAS_JSON = "../gincana/cartas.json";
const FIGURAS = "../gincana/";
const CHAVE_RODADA = "gincana-estudo:rodada";

const estado = {
  cartas: new Map(),
  rodadas: [],
  rodada: null,
  impressaoPy: null,
  entradas: [],
  py: null,
  carregandoPy: null,
};

/* ---------- Python -------------------------------------------------------- */

function statusPython(msg) {
  const alvo = $("#status-python");
  if (alvo) alvo.textContent = msg;
}

function habilitarRodar() {
  const b = $("#b-rodar");
  if (b) b.disabled = !estado.py;
}

/**
 * O mesmo preâmbulo do app da aula. Precisa ser o mesmo até na construção da
 * coluna `regime`: é contra ESTA base que as impressões digitais do
 * cartas.json foram calculadas.
 */
function garantirPython() {
  if (estado.py) return Promise.resolve(estado.py);
  if (estado.carregandoPy) return estado.carregandoPy;

  estado.carregandoPy = (async () => {
    const py = await carregar({
      pacotes: ["pandas", "matplotlib"],
      viaMicropip: ["plotnine"],
      aoProgresso: (msg) => statusPython(msg),
    });
    const csv = await fetch("../_shared/dados/criminal.csv").then((r) => r.text());
    py.FS.writeFile("/criminal.csv", csv);
    await rodar(py, `
import pandas as pd, matplotlib
matplotlib.use("agg")
from plotnine import *
criminal = pd.read_csv("/criminal.csv")
criminal["regime"] = pd.Categorical(
    criminal["regime_inicial"],
    categories=["aberto", "semiaberto", "fechado"],
    ordered=True,
)
penas = criminal.dropna(subset=["regime", "pena_anos"]).query("pena_anos <= 30")
criminal.shape
`);
    estado.py = py;
    statusPython("Python pronto");
    habilitarRodar();
    return py;
  })();

  return estado.carregandoPy;
}

/* ---------- montagem do código ------------------------------------------- */

function idsDigitados() {
  return estado.entradas.map((i) => i.value.trim().toUpperCase()).filter(Boolean);
}

function idsValidos() {
  return idsDigitados().filter((id) => estado.cartas.has(id));
}

/**
 * Onde termina o bloco de pandas e começa o do gráfico, nas rodadas de dois
 * blocos: a primeira carta de gráfico abre o segundo bloco.
 */
function corteDosBlocos(ids) {
  const i = ids.findIndex((id) => estado.cartas.get(id)?.naipe === "grafico");
  return i <= 0 ? ids.length : i;
}

function codigoMontado(ids, doisBlocos) {
  const bloco = (lista) =>
    lista.map((i) => estado.cartas.get(i).codigo
      .split("\n").map((l) => `    ${l}`).join("\n")).join("\n");
  if (!doisBlocos) return `(\n${bloco(ids)}\n)`;
  const corte = corteDosBlocos(ids);
  return `resumo = (\n${bloco(ids.slice(0, corte))}\n)\n\n(\n${bloco(ids.slice(corte))}\n)`;
}

async function rodarIds(ids, doisBlocos) {
  const py = await garantirPython();
  const corte = doisBlocos ? corteDosBlocos(ids) : null;
  const bloco = (lista) =>
    lista.map((i) => estado.cartas.get(i).codigo
      .split("\n").map((l) => `    ${l}`).join("\n")).join("\n");
  const corpo = corte
    ? `resumo = (\n${bloco(ids.slice(0, corte))}\n)\n_ultimo = (\n${bloco(ids.slice(corte))}\n)`
    : `_ultimo = (\n${bloco(ids)}\n)`;

  // seguro de rodar: o texto não é digitado pelo aluno, é a concatenação de
  // cartas conhecidas do baralho na ordem que ele escolheu
  const script = `
import io, base64, traceback
import pandas as pd
from plotnine import ggplot, theme_minimal
${estado.impressaoPy || ""}
saida = {"erro": None, "png": None, "tabela": None, "colunas": None,
         "linhas": None, "impressao": None}
try:
${corpo.split("\n").map((l) => `    ${l}`).join("\n")}
    if isinstance(_ultimo, ggplot):
        buf = io.BytesIO()
        # o theme_minimal() e do app, nao do aluno: nenhuma carta define tema, e
        # sem ele o grafico produzido sai com o fundo cinza padrao do plotnine
        # enquanto a figura esperada tem fundo branco. A diferenca de estilo
        # rouba a atencao da diferenca que importa.
        (_ultimo + theme_minimal()).save(
            buf, format="png", width=6, height=3.8, dpi=110, verbose=False)
        saida["png"] = base64.b64encode(buf.getvalue()).decode()
    elif isinstance(_ultimo, pd.DataFrame):
        visivel = _ultimo.drop(columns=[c for c in _ultimo.columns if c == "ementa"])
        saida["linhas"] = int(_ultimo.shape[0])
        saida["colunas"] = list(map(str, _ultimo.columns))
        saida["tabela"] = visivel.head(8).round(3).astype(str).to_dict(orient="records")
        try:
            saida["impressao"] = _impressao(_ultimo)
        except Exception:
            pass
    else:
        saida["tabela"] = [{"resultado": str(_ultimo)[:400]}]
except Exception:
    saida["erro"] = traceback.format_exc(limit=2)
saida
`;
  return rodar(py, script);
}

/* ---------- desenho da página -------------------------------------------- */

function escolherRodada(id) {
  const r = estado.rodadas.find((x) => x.id === id) || estado.rodadas[0];
  estado.rodada = r;
  try {
    localStorage.setItem(CHAVE_RODADA, r.id);
  } catch {
    // navegador com armazenamento bloqueado: só não lembra a escolha
  }
  for (const b of document.querySelectorAll(".grade-rodadas button")) {
    b.classList.toggle("atual", b.dataset.rodada === r.id);
  }
  desenharRodada(r);
}

function barraDeRodadas() {
  const grade = el("div.grade-rodadas");
  for (const r of estado.rodadas) {
    const b = el("button.secundario", {
      texto: r.rotulo,
      dataset: { rodada: r.id },
      title: r.titulo,
    });
    if (!r.pontua) b.classList.add("aquecimento");
    b.addEventListener("click", () => escolherRodada(r.id));
    grade.append(b);
  }
  return grade;
}

function baralhoConsultavel() {
  const lista = el("div.baralho");
  const naipes = [
    ["pandas", "Cartas de pandas"],
    ["grafico", "Cartas de gráfico"],
  ];
  for (const [naipe, titulo] of naipes) {
    lista.append(el("div.naipe", { texto: titulo }));
    for (const c of estado.cartas.values()) {
      if (c.naipe !== naipe) continue;
      const b = el("button.carta-consulta", { type: "button" }, [
        el("span.id", { texto: c.id }),
        el("span.codigo", { texto: c.codigo }),
        el("span.verso", { texto: c.verso }),
      ]);
      b.addEventListener("click", () => usarCarta(c.id));
      lista.append(b);
    }
  }
  return el("details", { style: "margin-top:1rem" }, [
    el("summary", { texto: "O baralho: as 40 cartas (clique para usar)" }),
    el("p.ajuda", {
      texto: "É o mesmo baralho da aula. Clicar numa carta põe o código dela " +
             "na primeira caixa vazia.",
    }),
    lista,
  ]);
}

/** Põe a carta na primeira caixa vazia, que é o que a mão espera. */
function usarCarta(id) {
  const vazia = estado.entradas.find((i) => !i.value.trim());
  if (!vazia) return;
  vazia.value = id;
  vazia.dispatchEvent(new Event("input", { bubbles: true }));
}

function desenharRodada(r) {
  const alvo = limpar($("#painel-rodada"));
  estado.entradas = [];

  alvo.append(
    el("h2", { texto: `${r.rotulo} · ${r.titulo}` }),
    el("p", { texto: r.pergunta }),
  );

  if (r.figura) {
    alvo.append(el("figure", { style: "margin:.8rem 0" }, [
      el("figcaption", {
        style: "font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;" +
               "color:var(--cinza-600);margin-bottom:.3rem",
        texto: "o gráfico que você tem que produzir",
      }),
      el("img", {
        src: FIGURAS + r.figura, alt: "gráfico esperado",
        style: "max-width:min(100%,30rem);border:var(--borda);border-radius:var(--raio)",
      }),
    ]));
  }

  alvo.append(
    el("h3", { texto: "A ordem das cartas" }),
    el("p.ajuda", {
      texto: `São ${r.n_cartas} cartas. Digite os códigos na ordem, uma caixa ` +
             "por carta, ou clique nas cartas do baralho lá embaixo.",
    }),
  );

  const caixas = el("div.cartas-entrada", { style: "margin-top:.7rem" });
  for (let i = 0; i < r.n_cartas; i += 1) {
    const input = el("input", {
      type: "text", maxlength: "3", "aria-label": `carta ${i + 1}`,
      autocomplete: "off", spellcheck: "false",
    });
    input.addEventListener("input", () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (input.value.length === 3 && estado.entradas[i + 1]) {
        estado.entradas[i + 1].focus();
      }
      atualizarPrevia();
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Backspace" && !input.value && estado.entradas[i - 1]) {
        estado.entradas[i - 1].focus();
      }
    });
    estado.entradas.push(input);
    caixas.append(el("div", {}, [
      el("span.ordinal", { texto: String(i + 1) }),
      input,
    ]));
  }
  alvo.append(caixas);

  alvo.append(
    el("h3", { texto: "O código que isso monta", style: "margin-top:1rem" }),
    el("div.previa", { id: "previa" }, [
      el("p.vazio", { texto: "digite os códigos acima para ver o código aparecer" }),
    ]),
    el("div", {
      style: "margin-top:1rem;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap",
    }, [
      el("button.primario", { id: "b-rodar", texto: "Rodar e ver o resultado" }),
      el("button.secundario", { id: "b-limpar", texto: "Limpar" }),
      el("span.ajuda", { id: "status-python" }),
    ]),
    el("div.saida-execucao", { id: "saida" }),
    baralhoConsultavel(),
  );

  $("#b-rodar").addEventListener("click", executar);
  $("#b-limpar").addEventListener("click", () => {
    for (const i of estado.entradas) i.value = "";
    limpar($("#saida"));
    atualizarPrevia();
    estado.entradas[0]?.focus();
  });

  habilitarRodar();
  if (!estado.py) statusPython("carregando o Python do navegador…");
  atualizarPrevia();
}

function atualizarPrevia() {
  for (const input of estado.entradas) {
    const v = input.value.trim().toUpperCase();
    input.classList.toggle("ok", Boolean(v) && estado.cartas.has(v));
    input.classList.toggle("ruim", Boolean(v) && !estado.cartas.has(v));
  }

  const ids = idsValidos();
  const previa = limpar($("#previa"));
  if (!ids.length) {
    previa.append(el("p.vazio", { texto: "digite os códigos acima para ver o código aparecer" }));
    return;
  }
  previa.append(el("pre", {}, [
    el("code", { texto: codigoMontado(ids, estado.rodada.dois_blocos) }),
  ]));
}

/* ---------- execução e feedback ------------------------------------------ */

async function executar() {
  const r = estado.rodada;
  const ids = idsValidos();
  const alvo = limpar($("#saida"));
  if (!ids.length) {
    alvo.append(aviso("atencao", null, "Digite pelo menos uma carta."));
    return;
  }
  alvo.append(el("p.carregando", { texto: "rodando…" }));

  let saida;
  try {
    saida = await rodarIds(ids, r.dois_blocos);
  } catch (erro) {
    limpar(alvo).append(aviso("erro", "Não consegui rodar", String(erro)));
    return;
  }
  mostrarSaida(limpar(alvo), r, ids, saida);
}

function mostrarSaida(alvo, r, ids, saida) {
  alvo.append(el("p", {}, [
    el("strong", { texto: "Você montou" }),
    el("code", { texto: ` ${ids.join(" > ")}` }),
  ]));

  if (saida.erro) {
    alvo.append(aviso("erro", "O código não rodou", ""));
    alvo.append(el("pre", {}, [el("code", { texto: saida.erro })]));
    alvo.append(el("p.ajuda", {
      texto: "Leia a última linha do erro: ela costuma dizer qual nome o " +
             "Python não encontrou, ou qual operação não cabia ali.",
    }));
    return;
  }

  // rodada de gráfico: o feedback é a comparação, e ela vale mais que qualquer
  // veredito escrito. As duas imagens ficam do mesmo tamanho, lado a lado.
  if (saida.png) {
    alvo.append(el("div.lado-a-lado", {}, [
      el("figure", {}, [
        el("figcaption", { texto: "o que o seu código produziu" }),
        el("img", { src: `data:image/png;base64,${saida.png}`, alt: "gráfico produzido" }),
      ]),
      r.figura ? el("figure", {}, [
        el("figcaption", { texto: "o gráfico que a pergunta pede" }),
        el("img", { src: FIGURAS + r.figura, alt: "gráfico esperado" }),
      ]) : null,
    ]));
    alvo.append(el("p.ajuda", {
      texto: "Compare os dois: os eixos, a legenda, a ordem das categorias e " +
             "se as barras estão lado a lado ou empilhadas.",
    }));
    return;
  }

  if (r.impressao && saida.impressao) {
    const bate = saida.impressao === r.impressao;
    alvo.append(aviso(bate ? "ok" : "atencao", null, bate
      ? "O resultado bate com o esperado: é esta a tabela que a pergunta pede."
      : "O código roda, mas o resultado é outro. Confira quais cartas você usou "
        + "e em que ordem: filtrar antes ou depois de agrupar muda a tabela."));
  }

  if (saida.tabela) {
    alvo.append(el("p.ajuda", {
      texto: saida.linhas != null
        ? `${saida.linhas} linhas · ${saida.colunas.join(", ")}` : "",
    }));
    const colunas = Object.keys(saida.tabela[0] || {});
    alvo.append(el("div", { style: "overflow-x:auto" }, [
      el("table.tabela", {}, [
        el("thead", {}, [el("tr", {}, colunas.map((c) => el("th", { texto: c })))]),
        el("tbody", {}, saida.tabela.map((linha) =>
          el("tr", {}, colunas.map((c) => el("td", { texto: String(linha[c]) }))))),
      ]),
    ]));
    if (saida.linhas > 8) {
      alvo.append(el("p.ajuda", { texto: "(mostrando as 8 primeiras linhas)" }));
    }
  }
}

/* ---------- entrada ------------------------------------------------------- */

async function iniciar() {
  montarTopo({
    exercicio: "Gincana",
    aula: "Aula 5",
    titulo: "Gincana para estudar",
  });

  const app = limpar($("#app"));
  let dados;
  try {
    dados = await fetch(CARTAS_JSON).then((r) => r.json());
  } catch (erro) {
    app.append(aviso("erro", "Não consegui carregar as cartas", String(erro)));
    return;
  }

  for (const c of dados.cartas) estado.cartas.set(c.id, c);
  estado.rodadas = dados.rodadas;
  estado.impressaoPy = dados.impressao_py || null;

  app.append(
    el("p", {
      texto: "A mesma gincana da aula, para treinar quantas vezes quiser. Sem " +
             "cronômetro, sem grupo e sem envio: escolha uma rodada, monte a " +
             "ordem das cartas e rode.",
    }),
    aviso("info", null,
      "O Python roda dentro do seu navegador, e a primeira vez demora um " +
      "pouco (são uns 40 MB). Depois disso é instantâneo, e funciona até sem " +
      "internet."),
    el("h2", { texto: "Escolha a rodada" }),
    barraDeRodadas(),
    el("div", { id: "painel-rodada", style: "margin-top:1.4rem" }),
  );

  let inicial = null;
  try {
    inicial = localStorage.getItem(CHAVE_RODADA);
  } catch {
    // sem armazenamento: começa pela primeira
  }
  escolherRodada(inicial || estado.rodadas[0].id);
  garantirPython().catch(() => statusPython("não consegui carregar o Python"));
}

iniciar();
