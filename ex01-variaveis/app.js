/* ==========================================================================
   Projeto 1 (aula 03) - Da sentença para a tabela.

   O grupo escolhe um tema (cada um com pergunta de pesquisa e 10 sentenças reais
   de 1º grau do TJSP), define as variáveis da tabela, e um LLM lê cada sentença
   preenchendo as colunas. Depois vem o feedback pela rubrica, que fica visível na
   tela desde o começo.

   Decisões que valem registrar:
   - uma chamada de LLM por sentença (10 no total). Lote grande economiza tokens e
     piora a leitura: o modelo começa a "copiar" a resposta do caso anterior;
   - teto de 5 avaliações. O feedback é para conversar, não para tentativa e erro;
   - não existe tipo "texto": coluna com trecho copiado da sentença não é variável,
     é matéria-prima. Quem quer registrar aquilo vira categoria ou número;
   - os arquivos da entrega são gerados primeiro e baixados por botão, um a um:
     dois downloads automáticos seguidos travam no navegador;
   - baixar arquivo avisa os guardrails, senão a janela de salvar conta como fuga;
   - o tipo declarado vira formato de saída no esquema JSON mandado ao modelo, e
     o valor ainda passa por uma coerção aqui. Sem isso, variável numérica volta
     como "R$ 15.000,00" e a coluna não serve para calcular nada. O que não se
     converte é contado e mostrado: é sinal de tipo mal escolhido, não de bug.
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import { ativar } from "../_shared/guardrails.js";
import { exigirIdentificacao, chaveDoGrupo } from "../_shared/identidade.js";
import { registrarSubmissao as registrarNaBase } from "../_shared/firebase.js";
import { avisoEstudo, exigirLiberacao, modoEstudo } from "../_shared/liberacao.js";
import {
  chamar, rubricaEmTexto, criterioDaRubrica, ESQUEMA_FEEDBACK, SISTEMA_FEEDBACK,
} from "../_shared/llm.js";
import { painelRubrica, contadorTentativas, avisoTentativasEsgotadas, painelFeedback } from "../_shared/rubrica.js";
import { blocoDeNotas } from "../_shared/notas.js";
import {
  $, $$, el, limpar, aviso, toast, montarTopo, montarPassos, tabela, paraCSV, baixar,
  sha256, pct, esc, agora, modal, comGlossario, fichaJuridica,
} from "../_shared/ui.js";

const EXERCICIO = "ex01";

/**
 * Grava a submissão, exceto em modo estudo.
 *
 * Depois do prazo o projeto vira material de treino, e o que se faz nele não
 * pode entrar na mesma base de quem entregou valendo nota.
 */
async function registrarSubmissao(dados) {
  if (estado.estudo) return { ok: true, estudo: true };
  return registrarNaBase(dados);
}

const estado = {
  identidade: null,
  estudo: false,
  guarda: null,
  config: null,
  corpus: null,
  rubrica: null,
  tema: null,
  lido: new Set(),
  variaveis: [],
  linhas: [],
  foraDoTipo: {},
  estatisticas: "",
  uniformizados: 0,
  feedbacks: [],
  tentativas: null,
  passos: null,
  extraindo: false,
  arquivos: null,
  notas: null,
};

/* ---------- arranque ----------------------------------------------------- */

async function iniciar() {
  montarTopo({
    exercicio: "Projeto 1",
    aula: "aula 03",
    titulo: "Da sentença para a tabela",
  });
  const liberacao = await exigirLiberacao(EXERCICIO);
  if (!liberacao.liberado) return;

  estado.passos = montarPassos([
    "tema", "explorar", "variáveis", "preencher", "estatísticas", "avaliar", "entregar",
  ]);
  estado.passos.ir(0);

  // passado o prazo, o projeto vira material de estudo: sem identificação, sem
  // bloqueio de cópia e cola e sem registro. Ver `modoEstudo` em liberacao.js.
  estado.estudo = modoEstudo(liberacao);
  if (estado.estudo) {
    $(".abertura")?.prepend(avisoEstudo());
    estado.identidade = { email: "estudo", integrantes: [], em_grupo: false };
    estado.guarda = { resumo: () => ({ modo: "estudo" }), etapa: () => {} };
  } else {
    estado.identidade = await exigirIdentificacao({
      exercicio: EXERCICIO,
      emGrupo: true,
      titulo: "Projeto 1 · quem está fazendo",
      explicacao:
        "Trabalho em grupo. Coloque o seu e-mail e os e-mails do grupo. Dá para corrigir depois, " +
        "no canto de cima da tela, se alguém ficar de fora.",
    });
    estado.guarda = ativar({ exercicio: EXERCICIO });
  }

  const [config, corpus, rubrica] = await Promise.all([
    fetch("config.json").then((r) => r.json()),
    fetch("dados/sentencas.json").then((r) => r.json()),
    fetch("../rubricas/ex01-variaveis.json").then((r) => r.json()),
  ]);
  estado.config = config;
  estado.corpus = corpus;
  estado.rubrica = rubrica;
  // Em modo estudo o teto passa a ser por dia e guardado no navegador: sem
  // prazo, um contador que morre no recarregamento nao segura nada, e cada
  // avaliacao custa uma chamada ao modelo.
  estado.tentativas = estado.estudo
    ? contadorTentativas(config.limites.max_avaliacoes_estudo, {
        chave: `${EXERCICIO}:avaliacoes-estudo`,
      })
    : contadorTentativas(config.limites.max_avaliacoes);

  // Quem volta no dia seguinte comeca do zero, mas quem volta no mesmo dia
  // precisa ver o que ja gastou antes de montar o trabalho inteiro para so
  // entao descobrir que o botao nao responde.
  if (estado.tentativas.usadas) {
    estado.tentativas.aplicar($("#contador-feedback"), $("#b-feedback"));
  }

  $("#aviso-corpus").textContent =
    `${corpus.temas.length} temas · ${corpus.casos_por_tema} sentenças cada · ${corpus.fonte}`;

  limpar($("#painel-rubrica")).append(painelRubrica(rubrica, { abertoPorPadrao: false }));
  estado.notas = blocoDeNotas({ exercicio: EXERCICIO });
  montarTemas();
  adicionarVariavel();
  ligarBotoes();
}

/* ---------- 1. tema ------------------------------------------------------ */

function montarTemas() {
  const alvo = limpar($("#lista-temas"));
  for (const t of estado.corpus.temas) {
    // A descrição do problema vem antes da pergunta de propósito: sem entender
    // o que está em disputa, a pergunta lida sozinha vira uma frase técnica e o
    // aluno já entra escolhendo variáveis no escuro.
    const cartao = el("label.cartao-tema", { for: `t-${t.id}` }, [
      el("div.area", { texto: t.area }),
      el("h4", {}, [
        el("input", { type: "radio", name: "tema", id: `t-${t.id}`, value: t.id }),
        t.titulo,
      ]),
      t.problema ? el("div.problema", { texto: t.problema }) : null,
      el("div.pergunta", {}, [el("strong", { texto: "Pergunta: " }), t.pergunta]),
      el("div.miudo", { texto: t.contexto }),
    ]);
    cartao.addEventListener("change", () => escolherTema(t, cartao));
    alvo.append(cartao);
  }
}

async function escolherTema(tema, cartao) {
  estado.tema = tema;
  $$(".cartao-tema").forEach((c) => c.classList.remove("marcado"));
  cartao.classList.add("marcado");

  limpar($("#tema-escolhido")).append(
    aviso(
      "ok",
      `Tema escolhido: ${tema.titulo}`,
      (tema.problema ? `${tema.problema}\n` : "") +
        `**Pergunta:** ${tema.pergunta}\n**Pista:** ${tema.pistas}\n**Cuidado:** ${tema.cuidado}`
    ),
    fichaJuridica(tema)
  );
  destravar("#s-casos");
  destravar("#s-variaveis");
  $("#s-tema").classList.add("concluida");
  estado.passos.ir(1);
  montarListaCasos();
  estado.guarda.marco("ex01_tema", tema.id);
  estado.guarda.etapa("1. tema escolhido", tema.titulo);
}

/* ---------- 2. leitura das sentenças ------------------------------------ */

function casos() {
  return estado.tema?.casos || [];
}

function montarListaCasos() {
  const alvo = limpar($("#lista-casos"));
  limpar($("#aviso-leitura"));
  $("#contador-lidas").textContent = "";
  estado.lido = new Set();
  const corpo = el("tbody");
  for (const c of casos()) {
    const linha = el("tr", { style: "cursor:pointer", dataset: { caso: c.id } }, [
      el("td", { texto: c.id }),
      el("td", { texto: c.assunto || c.classe || "—" }),
      el("td", { texto: c.comarca || "—" }),
      el("td", {}, [
        el("button.secundario", {
          type: "button",
          texto: "abrir",
          style: "padding:.15rem .5rem;font-size:.72rem",
        }),
      ]),
      el("td.marca-lida", { texto: "" }),
    ]);
    linha.addEventListener("click", () => mostrarCaso(c));
    corpo.append(linha);
  }
  alvo.append(
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, ["id", "assunto", "comarca", "", "lida"].map((t) => el("th", { texto: t }))),
      ]),
      corpo,
    ])
  );
}

/**
 * Quantas sentenças o grupo já abriu.
 *
 * O contador dizia "3 de 10 sentenças abertas", e os monitores notaram que isso
 * lê como meta: sob nervosismo, o aluno vai ler as dez e perde metade do tempo
 * da atividade. A partir da terceira, o contador passa a dizer que já dá.
 */
const LEITURA_SUFICIENTE = 3;

function marcarLidos() {
  for (const linha of $$("#lista-casos tbody tr")) {
    const lida = estado.lido.has(linha.dataset.caso);
    linha.querySelector(".marca-lida").textContent = lida ? "✓" : "";
  }
  const n = estado.lido.size;
  if (!n) {
    $("#contador-lidas").textContent = "";
    return;
  }
  $("#contador-lidas").textContent =
    n >= LEITURA_SUFICIENTE
      ? `${n} sentenças abertas · já dá para passar para a etapa 3`
      : `${n} de ${LEITURA_SUFICIENTE} sentenças abertas (não precisa ler as 10)`;
  if (n === LEITURA_SUFICIENTE) {
    estado.guarda.etapa("2. sentenças exploradas", `${n} abertas`);
    limpar($("#aviso-leitura")).append(
      aviso(
        "ok",
        "Já dá para começar a definir as variáveis",
        "Você pode continuar lendo, mas três ou quatro sentenças já mostram o padrão do " +
          "documento. Com uma hora de atividade, quem lê as dez chega sem tempo na etapa 3, " +
          "que é a que vale."
      )
    );
  }
}

/** Texto da sentença em parágrafos, com os termos do glossário marcados. */
function textoComGlossario(texto, glossario) {
  const caixa = el("div.selecionavel");
  for (const bloco of String(texto).split(/\n{2,}/)) {
    if (!bloco.trim()) continue;
    caixa.append(el("p", {}, [comGlossario(bloco.trim(), glossario)]));
  }
  return caixa;
}

/**
 * A sentença abre em janela larga. Sentença inteira tem 10 a 30 mil caracteres:
 * ler isso em uma coluna estreita, ao lado da lista, é pior do que ler em um
 * documento com a largura da tela.
 */
function mostrarCaso(c) {
  estado.lido.add(c.id);
  marcarLidos();
  modal({
    titulo: `${c.id} · processo ${c.processo}`,
    leitura: true,
    conteudo: [
      el("div.miudo", { texto: [c.classe, c.vara, c.comarca, c.data].filter(Boolean).join(" · ") }),
      el("div.miudo", { texto: c.juiz ? `Juiz(a): ${c.juiz}` : "" }),
      el("hr.regua"),
      textoComGlossario(c.texto, estado.tema?.glossario),
    ],
  });
}

/* ---------- 3. variáveis ------------------------------------------------ */

function adicionarVariavel(inicial = {}) {
  const { max_variaveis: max } = estado.config.limites;
  if (estado.variaveis.length >= max) {
    toast(`No máximo ${max} variáveis. Uma lista enxuta é melhor que uma longa.`);
    return;
  }
  estado.variaveis.push({
    chave: `v${Date.now()}${Math.floor(Math.random() * 1000)}`,
    nome: "",
    tipo: "categorica_nominal",
    papel: "independente",
    origem: "",
    ...inicial,
  });
  desenharEditor();
}

function tipoDe(id) {
  return estado.config.tipos.find((t) => t.id === id) || null;
}

/** Como o valor sai na tabela, na linguagem do aluno. */
function formatoDaSaida(tipo) {
  const saida = tipoDe(tipo)?.saida;
  if (saida === "numero") return "sai número: 15000.5";
  if (saida === "categoria") return "sai uma das categorias listadas";
  return "sai o código do caso, copiado como está";
}

function desenharEditor() {
  const alvo = limpar($("#editor-variaveis"));
  for (const v of estado.variaveis) {
    const linha = el(`div.var-linha.${v.papel}`);

    const nome = el("input", {
      type: "text", value: v.nome, placeholder: "nome_da_coluna", maxlength: "40",
      "aria-label": "nome da variável",
    });
    nome.addEventListener("input", () => {
      v.nome = nome.value.trim().replace(/\s+/g, "_").toLowerCase();
      nome.value = v.nome;
    });

    const ajuda = el("div.miudo", { texto: tipoDe(v.tipo)?.ajuda || "" });
    const formato = el("div.formato-saida", { texto: formatoDaSaida(v.tipo) });
    const tipo = el("select", { "aria-label": "tipo da variável" },
      estado.config.tipos.map((t) =>
        el("option", { value: t.id, texto: t.rotulo, selected: t.id === v.tipo })));
    tipo.addEventListener("change", () => {
      v.tipo = tipo.value;
      ajuda.textContent = tipoDe(v.tipo)?.ajuda || "";
      formato.textContent = formatoDaSaida(v.tipo);
    });

    const ajudaPapel = el("div.miudo", {
      texto: estado.config.papeis.find((p) => p.id === v.papel)?.ajuda || "",
    });
    const papel = el("select", { "aria-label": "papel na pergunta" },
      estado.config.papeis.map((p) =>
        el("option", { value: p.id, texto: p.rotulo, selected: p.id === v.papel })));
    papel.addEventListener("change", () => {
      v.papel = papel.value;
      desenharEditor();
    });

    const origem = el("textarea", {
      rows: "3", maxlength: "400", "aria-label": "de onde tirar",
      placeholder:
        "Em que parte da sentença essa informação aparece e com que valores registrar. " +
        "Se for categórica, liste as categorias. Se for numérica, diga a unidade.",
    });
    origem.value = v.origem;
    origem.addEventListener("input", () => (v.origem = origem.value));

    linha.append(
      el("div", {}, [el("span.rotulo", { texto: "nome" }), nome]),
      el("div", {}, [el("span.rotulo", { texto: "tipo" }), tipo, formato, ajuda]),
      el("div", {}, [el("span.rotulo", { texto: "papel" }), papel, ajudaPapel]),
      el("div", {}, [el("span.rotulo", { texto: "de onde tirar" }), origem]),
      el("button.secundario.apagar", {
        type: "button", texto: "remover", title: "remover esta variável",
        onclick: () => {
          estado.variaveis = estado.variaveis.filter((x) => x.chave !== v.chave);
          desenharEditor();
        },
      })
    );
    alvo.append(linha);
  }
  atualizarContadorVariaveis();
}

function atualizarContadorVariaveis() {
  const { min_variaveis: min, max_variaveis: max } = estado.config.limites;
  const n = estado.variaveis.length;
  const temDesfecho = estado.variaveis.some((v) => v.papel === "dependente");
  const temId = estado.variaveis.some((v) => v.papel === "identificacao");
  $("#contador-variaveis").textContent =
    `${n} de ${max} · ${temId ? "com" : "sem"} identificação · ` +
    `${temDesfecho ? "com" : "sem"} variável de desfecho`;
  $("#b-confirmar-variaveis").disabled = n < min;
}

function validarVariaveis() {
  const problemas = [];
  const alertas = [];
  const nomes = new Set();
  for (const v of estado.variaveis) {
    if (!v.nome) problemas.push("Há variável sem nome.");
    else if (nomes.has(v.nome)) problemas.push(`Nome repetido: ${v.nome}.`);
    else nomes.add(v.nome);
    if ((v.origem || "").trim().length < 15) {
      problemas.push(
        `Falta dizer de onde tirar "${v.nome || "(sem nome)"}". É essa instrução que o modelo de ` +
          "linguagem vai seguir."
      );
    }
    const saida = tipoDe(v.tipo)?.saida;
    if (saida === "categoria" && !/[,;]|\bou\b/i.test(v.origem || "")) {
      alertas.push(
        `A variável ${v.nome || "(sem nome)"} é categórica, mas o campo de onde tirar não lista ` +
          "as categorias. Sem a lista, cada sentença volta com um rótulo diferente."
      );
    }
  }
  if (!estado.variaveis.some((v) => v.papel === "identificacao")) {
    alertas.push("Nenhuma variável identifica o caso. Isso é escolha sua, e a rubrica olha isso.");
  }
  if (!estado.variaveis.some((v) => v.papel === "dependente")) {
    alertas.push(
      "Nenhuma variável marcada como \"o que eu quero explicar\". Sem ela, o que a pergunta compara?"
    );
  }
  return { problemas: [...new Set(problemas)], alertas };
}

function confirmarVariaveis() {
  const { problemas, alertas } = validarVariaveis();
  const alvo = limpar($("#erros-variaveis"));
  if (problemas.length) {
    alvo.append(
      aviso("erro", "Antes de rodar o modelo de linguagem:", problemas.map((p) => `- ${p}`).join("\n"))
    );
    return;
  }
  if (alertas.length) {
    alvo.append(aviso("atencao", "Seguindo assim, mas repare:", alertas.map((a) => `- ${a}`).join("\n")));
  }
  $("#s-variaveis").classList.add("concluida");
  destravar("#s-extracao");
  estado.passos.ir(3);
  estado.guarda.etapa(
    "3. variáveis confirmadas",
    `${estado.variaveis.length} variáveis, depois de abrir ${estado.lido.size} sentenças`
  );
  toast("Variáveis confirmadas. Agora o modelo de linguagem lê as sentenças.");
}

/* ---------- 4. extração (uma chamada por sentença) ---------------------- */

const NAO_INFORMADO = "não informado";

/**
 * Esquema JSON da extração, montado a partir dos tipos declarados.
 *
 * É aqui que o tipo deixa de ser rótulo e vira contrato: variável numérica sai
 * como number (ou null), o resto sai como string. Sem isso o modelo devolve
 * "R$ 15.000,00" e a coluna precisa ser limpa na mão depois.
 */
function esquemaExtracao() {
  const propriedades = {};
  for (const v of estado.variaveis) {
    const t = tipoDe(v.tipo);
    propriedades[v.nome] =
      t?.saida === "numero"
        ? {
            type: ["number", "null"],
            description: `${v.nome}: número puro; null se a sentença não traz a informação`,
          }
        : {
            type: "string",
            description: `${v.nome}: ${t?.regra || "valor curto"}; "${NAO_INFORMADO}" se não estiver no texto`,
          };
  }
  return {
    type: "object",
    required: ["id", "valores"],
    properties: {
      id: { type: "string" },
      valores: {
        type: "object",
        required: estado.variaveis.map((v) => v.nome),
        properties: propriedades,
      },
    },
  };
}

/**
 * Converte para número o que o modelo devolveu, mesmo formatado.
 *
 * Aceita 15000.5, "15000,5", "R$ 15.000,50" e "15.000". Devolve null quando não
 * há número, e o chamador registra isso como valor fora do tipo declarado.
 */
function paraNumero(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (valor === null || valor === undefined) return null;
  let t = String(valor).trim();
  if (!t || /^(n[ãa]o informado|null|-|—)$/i.test(t)) return null;
  t = t.replace(/reais?/gi, "").replace(/[R$\s]/gi, "");
  const temVirgula = t.includes(",");
  const temPonto = t.includes(".");
  if (temVirgula && temPonto) t = t.replace(/\./g, "").replace(",", ".");
  else if (temVirgula) t = t.replace(",", ".");
  else if (temPonto && /\.\d{3}(?:\D|$)/.test(t)) t = t.replace(/\./g, "");
  const achado = t.match(/-?\d+(?:\.\d+)?/);
  return achado ? Number(achado[0]) : null;
}

function promptExtracao(caso) {
  const especificacao = estado.variaveis
    .map((v) => {
      const t = tipoDe(v.tipo);
      return (
        `- ${v.nome} (tipo: ${v.tipo}; papel: ${v.papel})\n` +
        `  significa: ${t?.rotulo || v.tipo}\n` +
        `  de onde tirar: ${v.origem}\n` +
        `  formato obrigatório da saída: ${t?.regra || "valor curto"}`
      );
    })
    .join("\n");
  return [
    `PERGUNTA DE PESQUISA: ${estado.tema.pergunta}`,
    "",
    "VARIÁVEIS A PREENCHER (siga a instrução de onde tirar E o formato de saída):",
    especificacao,
    "",
    `SENTENÇA (id ${caso.id}, processo ${caso.processo}):`,
    caso.texto,
    "",
    "Preencha as variáveis lendo APENAS esta sentença.",
    "Não deduza do que é comum nesse tipo de caso, não use conhecimento externo.",
    "Os nomes das partes aparecem como [PESSOA 1], [PESSOA 2]: isso é proposital.",
    "",
    "REGRAS DE FORMATO, que valem mais que o estilo do documento:",
    "- variável numérica sai como número JSON, sem aspas, sem R$, sem ponto de milhar e com " +
      "ponto como separador decimal. Quinze mil reais é 15000, não \"R$ 15.000,00\";",
    "- variável numérica sem a informação no texto sai como null, nunca como texto;",
    "- variável categórica sai com uma das categorias listadas em \"de onde tirar\", escrita " +
      "exatamente como foi listada, sempre com a mesma grafia em todas as sentenças;",
    "- identificador sai copiado do documento, exatamente como aparece;",
    `- para tudo que não é numérico, use exatamente "${NAO_INFORMADO}" quando faltar a informação.`,
    "",
    `Formato: {"id": "${caso.id}", "valores": {"nome_da_variavel": valor}}`,
    "",
    // A instrução de acentuação vai no fim porque é a posição mais próxima da
    // geração: no sistema ela não segurou, e o modelo leve devolvia "N'ao" e
    // "Nao" na mesma coluna, misturando grafias de uma mesma categoria.
    "IMPORTANTE: escreva os valores em português do Brasil com ACENTUAÇÃO correta " +
      "(Não, Sim, réu, prisão). Nunca troque acento por apóstrofo: escreva \"Não\", " +
      "jamais \"N'ao\". Cada categoria mantém, em todas as sentenças, exatamente a " +
      "grafia listada no campo \"de onde tirar\".",
  ].join("\n");
}

/**
 * Põe o valor devolvido pelo modelo no formato do tipo declarado.
 *
 * O que não couber no tipo fica registrado em `estado.foraDoTipo` e aparece no
 * diagnóstico. Isso é conteúdo da aula, não defeito: "R$ 15.000,00" numa coluna
 * declarada como numérica é sinal de que a instrução ou o tipo estão errados.
 */
function normalizar(variavel, bruto) {
  const saida = tipoDe(variavel.tipo)?.saida;
  if (saida !== "numero") {
    const texto = String(bruto ?? "").trim();
    // "N'ao" no lugar de "Não": o modelo leve troca o acento por apóstrofo de
    // vez em quando. Apóstrofo no meio de palavra é raríssimo numa categoria
    // (e o identificador não passa por aqui com pontuação), então tirar é
    // seguro e evita duas grafias da mesma categoria na coluna.
    const limpo = saida === "categoria" ? semApostrofoInterno(texto) : texto;
    return limpo || NAO_INFORMADO;
  }
  const numero = paraNumero(bruto);
  if (numero === null) {
    const texto = String(bruto ?? "").trim();
    const faltou = !texto || /^(n[ãa]o informado|null)$/i.test(texto);
    if (!faltou) {
      (estado.foraDoTipo[variavel.nome] ||= []).push(texto.slice(0, 40));
    }
    return "";
  }
  return numero;
}

/** Tira o apóstrofo que aparece no meio de uma palavra: "N'ao" vira "Nao". */
function semApostrofoInterno(texto) {
  return String(texto).replace(/([A-Za-zÀ-ÿ])['’`´]([A-Za-zÀ-ÿ])/g, "$1$2");
}

/**
 * As categorias que o aluno listou no campo "de onde tirar".
 *
 * Só entram pedaços curtos (até três palavras): o campo é texto livre, e o que
 * se quer daqui é a grafia que o próprio aluno escolheu para cada categoria,
 * para a coluna sair escrita como ele definiu.
 */
function categoriasDeclaradas(origem) {
  return String(origem || "")
    .split(/[,;:\n]|\bou\b|\//i)
    .map((parte) => parte.replace(/^[\s"'“”().:-]+|[\s"'“”().:-]+$/g, "").trim())
    .filter((parte) => parte && parte.length <= 30 && parte.split(/\s+/).length <= 3);
}

/** Forma canônica de um valor: sem acento, sem apóstrofo, minúscula. */
function chaveCanonica(valor) {
  return String(valor)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/['`´^~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Quanto uma grafia parece "a certa": com acento vale mais, com apóstrofo vale menos. */
function qualidadeDaGrafia(texto) {
  let pontos = 0;
  if (/[áàâãéêíóôõúüç]/i.test(texto)) pontos += 2;
  if (/[A-Za-zÀ-ú]'[A-Za-zÀ-ú]/.test(texto)) pontos -= 3;
  return pontos;
}

/**
 * Uniformiza a grafia dentro de cada coluna categórica.
 *
 * O modelo leve escapa do formato de vez em quando e devolve "N'ao" numa linha e
 * "Não" na outra: é a mesma categoria escrita de dois jeitos, e a contagem sai
 * errada sem que o aluno perceba. São duas passadas, nesta ordem:
 *
 *   1. se o valor corresponde a uma categoria que o aluno declarou, ele passa a
 *      usar a grafia do aluno (é ele quem define como a categoria se escreve);
 *   2. o que sobrar é agrupado pela forma canônica, e cada grupo adota a grafia
 *      mais frequente (no empate, a que tem acento e não tem apóstrofo).
 *
 * Valor sem correspondência e sem irmão na coluna fica exatamente como veio:
 * isto conserta grafia, não conteúdo.
 */
function uniformizarCategorias(linhas, variaveis) {
  let trocas = 0;
  for (const v of variaveis) {
    if (tipoDe(v.tipo)?.saida !== "categoria") continue;

    const declaradas = new Map(
      categoriasDeclaradas(v.origem).map((c) => [chaveCanonica(c), c])
    );
    for (const linha of linhas) {
      const valor = linha[v.nome];
      if (typeof valor !== "string" || !valor.trim()) continue;
      const declarada = declaradas.get(chaveCanonica(valor));
      if (declarada && declarada !== valor) {
        linha[v.nome] = declarada;
        trocas += 1;
      }
    }

    const grafiasPorChave = new Map();
    for (const linha of linhas) {
      const valor = linha[v.nome];
      if (typeof valor !== "string" || !valor.trim()) continue;
      const chave = chaveCanonica(valor);
      if (!chave) continue;
      const grafias = grafiasPorChave.get(chave) || new Map();
      grafias.set(valor, (grafias.get(valor) || 0) + 1);
      grafiasPorChave.set(chave, grafias);
    }

    for (const [chave, grafias] of grafiasPorChave) {
      if (grafias.size < 2) continue;
      const [vencedora] = [...grafias.entries()].sort(
        (a, b) => b[1] - a[1] || qualidadeDaGrafia(b[0]) - qualidadeDaGrafia(a[0])
      )[0];
      for (const linha of linhas) {
        if (typeof linha[v.nome] === "string" && chaveCanonica(linha[v.nome]) === chave &&
            linha[v.nome] !== vencedora) {
          linha[v.nome] = vencedora;
          trocas += 1;
        }
      }
    }
  }
  return trocas;
}

async function extrair() {
  if (estado.extraindo) return;
  estado.extraindo = true;
  estado.foraDoTipo = {};

  const lista = casos();
  const botao = $("#b-extrair");
  const status = $("#status-extracao");
  const barra = $("#barra-extracao");
  botao.disabled = true;
  const acumulado = [];
  const falhas = [];
  const inicio = performance.now();

  try {
    for (let i = 0; i < lista.length; i += 1) {
      const caso = lista[i];
      status.replaceChildren(
        el("span.carregando", { texto: `lendo a sentença ${i + 1} de ${lista.length}` })
      );
      try {
        const resposta = await chamar({
          tarefa: "ex01_extrair",
          modelo: CONFIG.modelos.simples,
          sistema:
            "Você extrai variáveis estruturadas de sentenças judiciais brasileiras. " +
            "Você é literal: só registra o que está escrito no texto fornecido. " +
            "Você respeita o tipo declarado de cada variável: numérica devolve número JSON " +
            "(nunca texto formatado como R$ 1.500,00), categórica devolve uma das categorias " +
            "listadas. Responda apenas com o JSON pedido.",
          usuario: promptExtracao(caso),
          json: true,
          esquema: esquemaExtracao(),
          maxTokens: 900,
          temperatura: 0,
          // a sala inteira roda junto: quando o servidor pede espera, o aluno
          // vê que está na fila em vez de achar que travou
          aoEsperar: ({ esperaMs }) =>
            status.replaceChildren(
              el("span.carregando", {
                texto:
                  `muita gente pedindo ao mesmo tempo: esperando ${Math.round(esperaMs / 1000)}s ` +
                  `para ler a sentença ${i + 1} de ${lista.length}`,
              })
            ),
        });
        const valores = resposta.dados?.valores || {};
        const registro = { id_caso: caso.id, processo: caso.processo };
        for (const v of estado.variaveis) {
          registro[v.nome] = normalizar(v, valores[v.nome]);
        }
        acumulado.push(registro);
      } catch (erro) {
        falhas.push(`${caso.id}: ${erro.message || erro}`);
      }
      barra.style.width = `${((i + 1) / lista.length) * 100}%`;
    }

    estado.uniformizados = uniformizarCategorias(acumulado, estado.variaveis);
    estado.linhas = acumulado;
    const segundos = ((performance.now() - inicio) / 1000).toFixed(0);
    status.replaceChildren(
      el(`span.etiqueta.${falhas.length ? "alerta" : "ok"}`, {
        texto: `${acumulado.length} de ${lista.length} sentenças em ${segundos}s`,
      })
    );
    mostrarResultado(falhas);
    if (acumulado.length) {
      destravar("#s-estatisticas");
      estado.passos.ir(4);
      estado.guarda.etapa(
        "4. tabela preenchida",
        `${acumulado.length} de ${lista.length} sentenças em ${segundos}s`
      );
      await registrarSubmissao({
        exercicio: EXERCICIO,
        etapa: "extracao",
        identificacao: estado.identidade,
        tema: estado.tema.id,
        variaveis: estado.variaveis.map(({ chave, ...resto }) => resto),
        n_casos: acumulado.length,
        falhas,
        preenchimento: diagnostico(),
        monitoramento: estado.guarda.resumo(),
      });
    }
  } finally {
    botao.disabled = false;
    botao.textContent = "Preencher de novo";
    estado.extraindo = false;
  }
}

function diagnostico() {
  const total = estado.linhas.length || 1;
  return estado.variaveis.map((v) => {
    const vazias = estado.linhas.filter(
      (l) => l[v.nome] === "" || l[v.nome] === null || l[v.nome] === undefined ||
        String(l[v.nome]).trim().toLowerCase() === "não informado"
    ).length;
    const distintos = new Set(estado.linhas.map((l) => String(l[v.nome]))).size;
    const fora = estado.foraDoTipo[v.nome] || [];
    return {
      coluna: v.nome,
      tipo: v.tipo,
      preenchida: 1 - vazias / total,
      distintos,
      fora_do_tipo: fora.length,
      exemplos_fora: fora.slice(0, 3),
    };
  });
}

function mostrarResultado(falhas = []) {
  const alvo = limpar($("#resultado-extracao"));
  if (falhas.length) {
    alvo.append(
      aviso("atencao", `${falhas.length} sentença(s) não foram lidas`, falhas.map((f) => `- ${f}`).join("\n"))
    );
  }
  if (!estado.linhas.length) return;

  const colunas = ["id_caso", ...estado.variaveis.map((v) => v.nome)];
  const diag = diagnostico();
  const painel = el("div.diag");
  for (const d of diag) {
    const cor = d.preenchida < 0.5 ? "var(--vermelho)" : d.preenchida < 0.8 ? "var(--laranja)" : "var(--turquesa)";
    painel.append(
      el("div.item", {}, [
        el("span.nome", { texto: d.coluna }),
        el("span.barra", {}, [el("i", { style: `width:${d.preenchida * 100}%;background:${cor}` })]),
        el("span", {
          texto:
            `${pct(d.preenchida, 0)} preenchida · ${d.distintos} valores distintos` +
            (d.fora_do_tipo ? ` · ${d.fora_do_tipo} fora do tipo` : ""),
        }),
      ])
    );
  }
  const problemas = diag.filter((d) => d.preenchida < 0.6);
  const desalinhadas = diag.filter((d) => d.fora_do_tipo > 0);
  alvo.append(
    el("h3", { texto: "Como cada coluna ficou" }),
    painel,
    // transparência: o app não mexe nos dados do aluno sem dizer
    estado.uniformizados
      ? el("p.miudo", {
          texto:
            `${estado.uniformizados} valor(es) tiveram a grafia uniformizada para a categoria ` +
            "que você declarou (o modelo escreveu a mesma categoria de dois jeitos). O conteúdo " +
            "não mudou, só a escrita.",
        })
      : null,
    problemas.length
      ? aviso(
          "atencao",
          "Colunas com muito 'não informado'",
          `${problemas.map((p) => p.coluna).join(", ")}. Em geral isso quer dizer que a variável ` +
            "pede informação que a sentença não traz. Vale rever de onde tirar, ou trocar a variável."
        )
      : aviso("ok", "Preenchimento razoável", "Nenhuma coluna ficou majoritariamente vazia."),
    desalinhadas.length
      ? aviso(
          "atencao",
          "Valores que não cabem no tipo declarado",
          desalinhadas
            .map(
              (d) =>
                `- ${d.coluna} (declarada como ${d.tipo}): ${d.fora_do_tipo} valor(es) que não ` +
                `viraram número, por exemplo ${d.exemplos_fora.map((e) => `"${e}"`).join(", ")}`
            )
            .join("\n") +
            "\n\nOu a sentença não traz um número ali, ou o tipo escolhido não é o certo para " +
            "essa variável."
        )
      : null,
    el("h3", { texto: "Tabela preenchida" }),
    tabela(colunas, estado.linhas)
  );
}

/* ---------- 5. estatísticas --------------------------------------------- */

function confirmarEstatisticas() {
  const minimo = estado.config.limites.min_estatisticas ?? 120;
  const texto = $("#estatisticas").value.trim();
  const alvo = limpar($("#erros-estatisticas"));
  if (texto.length < minimo) {
    alvo.append(
      aviso(
        "atencao",
        "Ainda está curto",
        `Escreva pelo menos ${minimo} caracteres (você tem ${texto.length}). Diga qual estatística, ` +
          "calculada em qual variável, e separada por qual outra."
      )
    );
    return;
  }
  estado.estatisticas = texto;
  $("#contador-estatisticas").textContent = `${texto.length} caracteres registrados`;
  $("#s-estatisticas").classList.add("concluida");
  destravar("#s-feedback");
  estado.passos.ir(5);
  estado.guarda.etapa("5. estatísticas registradas", `${texto.length} caracteres`);
  alvo.append(
    aviso(
      "ok",
      "Registrado",
      "O feedback da próxima etapa também vai olhar para isso: se a estatística que você propôs " +
        "combina com o tipo que você declarou."
    )
  );
}

/* ---------- 5. feedback ------------------------------------------------- */

async function pedirFeedback() {
  if (!estado.linhas.length) {
    limpar($("#painel-feedback")).append(
      aviso("atencao", "Falta preencher a tabela", "Rode a etapa 4 antes de pedir feedback.")
    );
    return;
  }
  if (!estado.estatisticas) {
    limpar($("#painel-feedback")).append(
      aviso(
        "atencao",
        "Falta dizer que estatísticas você calcularia",
        "Preencha a etapa 5. O feedback avalia as variáveis junto com as contas que elas permitem."
      )
    );
    return;
  }
  if (estado.tentativas.esgotou) {
    limpar($("#painel-feedback")).append(avisoTentativasEsgotadas(estado.tentativas.maximo, { porDia: estado.tentativas.porDia }));
    return;
  }

  const botao = $("#b-feedback");
  const status = $("#status-feedback");
  botao.disabled = true;
  status.replaceChildren(el("span.carregando", { texto: "avaliando pela rubrica" }));

  const amostra = estado.linhas.slice(0, 6);
  const usuario = [
    `TEMA E PERGUNTA DE PESQUISA: ${estado.tema.titulo} — ${estado.tema.pergunta}`,
    `(o enunciado já avisou: ${estado.tema.cuidado})`,
    "",
    "VARIÁVEIS DEFINIDAS PELO ALUNO:",
    ...estado.variaveis.map(
      (v, i) => `${i + 1}. ${v.nome} | tipo: ${v.tipo} | papel: ${v.papel}\n   de onde tirar: ${v.origem}`
    ),
    "",
    "COMO CADA COLUNA FICOU (fração de sentenças com informação e nº de valores distintos):",
    ...diagnostico().map(
      (d) =>
        `- ${d.coluna}: ${pct(d.preenchida, 0)} preenchida, ${d.distintos} valores distintos` +
        (d.fora_do_tipo
          ? `, ${d.fora_do_tipo} valor(es) que não couberam no tipo declarado ` +
            `(ex.: ${d.exemplos_fora.join(", ")})`
          : "")
    ),
    "",
    "ESTATÍSTICAS QUE O ALUNO DISSE QUE CALCULARIA:",
    estado.estatisticas,
    "",
    `AMOSTRA DA TABELA (${amostra.length} de ${estado.linhas.length} linhas):`,
    JSON.stringify(amostra, null, 1),
    "",
    estado.feedbacks.length
      ? `Esta é a avaliação ${estado.feedbacks.length + 1} de ${estado.tentativas.maximo}. ` +
        "Antes você apontou: " + estado.feedbacks.map((f) => f.proximo_passo).join(" | ") +
        ". Diga o que melhorou e o que continua pendente."
      : `Primeira avaliação (de ${estado.tentativas.maximo}).`,
    "",
    rubricaEmTexto(estado.rubrica),
    "",
    "Devolva JSON com criterios (id da rubrica, nivel, comentario, evidencia, sugestao), " +
      "resumo (2 frases), proximo_passo e pontos_fortes.",
  ].join("\n");

  try {
    const resposta = await chamar({
      tarefa: "ex01_feedback",
      modelo: CONFIG.modelos.complexo,
      sistema: SISTEMA_FEEDBACK,
      usuario,
      json: true,
      esquema: ESQUEMA_FEEDBACK,
      maxTokens: 2400,
      temperatura: 0.3,
      aoEsperar: ({ esperaMs }) =>
        status.replaceChildren(
          el("span.carregando", {
            texto: `fila cheia, tentando de novo em ${Math.round(esperaMs / 1000)}s`,
          })
        ),
    });
    estado.tentativas.usar();
    estado.feedbacks.push(resposta.dados);
    limpar($("#painel-feedback")).append(
      painelFeedback({
        feedback: resposta.dados,
        rubrica: estado.rubrica,
        iteracao: estado.feedbacks.length,
        criterioDaRubrica,
      }),
      estado.tentativas.esgotou ? avisoTentativasEsgotadas(estado.tentativas.maximo, { porDia: estado.tentativas.porDia }) : null
    );
    status.replaceChildren(el("span.etiqueta", { texto: estado.tentativas.texto() }));
    estado.tentativas.aplicar($("#contador-feedback"), botao);
    destravar("#s-submissao");
    estado.passos.ir(6);
    estado.guarda.etapa(
      "6. avaliação pedida",
      `${estado.feedbacks.length} de ${estado.tentativas.maximo}`
    );
    await registrarSubmissao({
      exercicio: EXERCICIO,
      etapa: "feedback",
      identificacao: estado.identidade,
      tema: estado.tema.id,
      iteracao: estado.feedbacks.length,
      variaveis: estado.variaveis.map(({ chave, ...resto }) => resto),
      estatisticas: estado.estatisticas,
      feedback: resposta.dados,
      modelo: resposta.modelo,
      monitoramento: estado.guarda.resumo(),
    });
  } catch (erro) {
    status.replaceChildren(el("span.etiqueta.erro", { texto: "falhou" }));
    limpar($("#painel-feedback")).append(
      aviso("erro", "Não consegui gerar o feedback", String(erro.message || erro))
    );
  } finally {
    if (!estado.tentativas.esgotou) botao.disabled = false;
  }
}

/* ---------- 6. entrega -------------------------------------------------- */

async function gerarArquivos() {
  const comentario = $("#comentario-final").value.trim();
  const pendencias = [];
  if (!estado.linhas.length) pendencias.push("preencher a tabela (etapa 4)");
  if (!estado.estatisticas) pendencias.push("dizer que estatísticas calcularia (etapa 5)");
  if (comentario.length < 20) pendencias.push("escrever as observações da etapa 7");
  if (pendencias.length) {
    limpar($("#painel-submissao")).append(
      aviso("atencao", "Falta isto antes de fechar:", pendencias.map((p) => `- ${p}`).join("\n"))
    );
    return;
  }

  const botao = $("#b-fechar");
  botao.disabled = true;
  $("#status-submissao").replaceChildren(el("span.carregando", { texto: "gerando" }));

  const colunas = ["id_caso", "processo", ...estado.variaveis.map((v) => v.nome)];
  const csv = paraCSV(colunas, estado.linhas);
  const documentacao = {
    exercicio: "Projeto 1 (aula 03) - CDAD II 2026/2",
    integrantes: estado.identidade.integrantes,
    submetido_por: estado.identidade.email,
    fechado_em: agora(),
    tema: estado.tema.titulo,
    pergunta_de_pesquisa: estado.tema.pergunta,
    corpus: { fonte: estado.corpus.fonte, casos: casos().map((c) => c.id) },
    variaveis: estado.variaveis.map(({ chave, ...resto }) => resto),
    preenchimento: diagnostico(),
    estatisticas_propostas: estado.estatisticas,
    avaliacoes_usadas: estado.feedbacks.length,
    observacoes: comentario,
    tabela: estado.linhas,
  };
  const jsonTexto = JSON.stringify(documentacao, null, 1);
  const hashCsv = await sha256(csv);
  const hashJson = await sha256(jsonTexto);
  const base = `ex01_${chaveDoGrupo(estado.identidade).replace(/\+/g, "-")}`;
  estado.arquivos = {
    csv: { nome: `${base}_tabela.csv`, conteudo: csv, hash: hashCsv },
    json: { nome: `${base}_documentacao.json`, conteudo: jsonTexto, hash: hashJson },
  };

  // Antes de registrar: assim o horário da entrega e a lista de etapas já
  // entram no `monitoramento` desta submissão, e não só na próxima.
  estado.guarda.entregar(
    `${estado.linhas.length} linhas, ${estado.variaveis.length} variáveis`,
    "7. entrega fechada"
  );

  const resultado = await registrarSubmissao({
    exercicio: EXERCICIO,
    etapa: "final",
    identificacao: estado.identidade,
    tema: estado.tema.id,
    variaveis: estado.variaveis.map(({ chave, ...resto }) => resto),
    n_linhas: estado.linhas.length,
    estatisticas: estado.estatisticas,
    avaliacoes_usadas: estado.feedbacks.length,
    observacoes: comentario,
    hash_csv: hashCsv,
    hash_json: hashJson,
    preenchimento: diagnostico(),
    monitoramento: estado.guarda.resumo(),
  });

  $("#status-submissao").replaceChildren(
    el(`span.etiqueta.${resultado.ok ? "ok" : "erro"}`, {
      texto: resultado.ok ? "submissão registrada" : "registro falhou (avise o professor)",
    })
  );
  limpar($("#painel-submissao")).append(
    aviso(
      "ok",
      "Arquivos prontos",
      "Baixe os dois, um de cada vez, e entregue no BlackBoard sem renomear."
    ),
    el("div.acoes", { style: "margin-top:0" }, [
      el("button.principal", {
        type: "button",
        texto: `baixar ${estado.arquivos.csv.nome}`,
        onclick: () => baixar(estado.arquivos.csv.nome, estado.arquivos.csv.conteudo, "text/csv;charset=utf-8", true),
      }),
      el("button.principal", {
        type: "button",
        texto: `baixar ${estado.arquivos.json.nome}`,
        onclick: () => baixar(estado.arquivos.json.nome, estado.arquivos.json.conteudo, "application/json;charset=utf-8"),
      }),
    ]),
    el("div.ficha.destaque", { style: "margin-top:.8rem" }, [
      el("span.rotulo", { texto: "código de verificação dos arquivos (SHA-256)" }),
      el("div.mono", { texto: `tabela.csv  ${hashCsv}` }),
      el("div.mono", { texto: `documentacao.json  ${hashJson}` }),
      el("p.miudo", {
        texto:
          "Estes códigos ficaram registrados com a submissão. Se o arquivo entregue for diferente " +
          "do que foi gerado aqui, o código não bate. Baixar arquivo não conta como saída da aba.",
      }),
    ])
  );
  $("#s-submissao").classList.add("concluida");
  botao.disabled = false;
  botao.textContent = "Gerar de novo";
}

/* ---------- utilidades -------------------------------------------------- */

function destravar(seletor) {
  $(seletor)?.classList.remove("travada");
}

function ligarBotoes() {
  $("#b-add-variavel").addEventListener("click", () => adicionarVariavel());
  $("#b-confirmar-variaveis").addEventListener("click", confirmarVariaveis);
  $("#b-extrair").addEventListener("click", extrair);
  $("#b-confirmar-estatisticas").addEventListener("click", confirmarEstatisticas);
  $("#b-feedback").addEventListener("click", pedirFeedback);
  $("#b-fechar").addEventListener("click", gerarArquivos);
}

iniciar().catch((erro) => {
  document.body.prepend(aviso("erro", "Erro ao iniciar o projeto", String(erro.message || erro)));
});
