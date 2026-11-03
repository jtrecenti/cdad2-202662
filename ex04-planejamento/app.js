/* ==========================================================================
   Projeto 4 (aula 13) - Planejamento de pesquisa.

   O aluno escolhe um tema, formula a pergunta, declara as variáveis que vai
   construir e, só depois disso, escreve a hipótese e escolhe a análise. A ordem
   é deliberada: hipótese que não fala das variáveis declaradas é hipótese solta,
   e análise escolhida antes de saber o tipo do desfecho é chute.

   Reprogramação de 13/09: o projeto roda na segunda hora da aula 13, antes da
   prova intermediária, e a turma ainda não viu testes de hipóteses. O campo de
   "método" virou "análise" (tabela, gráfico e intervalo de confiança).

   Ajuste de 22/09, na véspera da aula: os textos de ajuda ganharam exemplos, o
   campo da fonte deixou de pedir "o que ela não vê" (ninguém entendia o pedido),
   o tipo "data" saiu da lista de tipos, e o desenho do estudo passou a ser
   declarado em campo próprio, junto da população, do parâmetro e da estimativa.
   A hipótese vem duas vezes, em palavras e formalizada em H0 e H1, o que é
   redação de hipótese e não execução de teste: nada de p-valor. Tudo isso mora
   em temas.json, e os campos novos entram sozinhos no markdown da entrega e no
   prompt do feedback, porque textoDoPlanejamento() percorre as duas listas.

   O que mudou depois do primeiro teste em sala:
   - tema escolhido de uma lista, não sorteado (o aluno se compromete mais com o
     tema que ele escolheu, e o professor não precisa arbitrar trocas);
   - sem tela cheia: a proteção que importa aqui é o bloqueio de cópia e cola;
   - papel da variável aceita mais de um valor, porque na prática comarca pode ser
     filtro e independente ao mesmo tempo;
   - tamanho de texto é sugestão, não trava. Quem julga o suficiente é a rubrica.
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import { ativar } from "../_shared/guardrails.js";
import { exigirIdentificacao, chaveDoGrupo } from "../_shared/identidade.js";
import { registrarSubmissao } from "../_shared/firebase.js";
import { exigirLiberacao } from "../_shared/liberacao.js";
import {
  chamar, rubricaEmTexto, criterioDaRubrica, ESQUEMA_FEEDBACK, SISTEMA_FEEDBACK,
} from "../_shared/llm.js";
import { painelRubrica, contadorTentativas, avisoTentativasEsgotadas, painelFeedback } from "../_shared/rubrica.js";
import {
  $, $$, el, limpar, aviso, toast, montarTopo, montarPassos, baixar, sha256,
  contarPalavras, esc, agora, fichaJuridica,
} from "../_shared/ui.js";

const EXERCICIO = "ex04";

const estado = {
  identidade: null,
  guarda: null,
  config: null,
  rubrica: null,
  tema: null,
  respostas: {},
  variaveis: [],
  feedbacks: [],
  tentativas: null,
  passos: null,
};

/* ---------- arranque ---------------------------------------------------- */

async function iniciar() {
  montarTopo({
    exercicio: "Projeto 4",
    aula: "aula 13",
    titulo: "Planejamento de pesquisa",
  });
  const liberacao = await exigirLiberacao(EXERCICIO);
  if (!liberacao.liberado) return;

  estado.passos = montarPassos(["tema", "pergunta", "variáveis", "hipótese", "feedback", "entrega"]);
  estado.passos.ir(0);

  estado.identidade = await exigirIdentificacao({
    exercicio: EXERCICIO,
    emGrupo: true,
    titulo: "Projeto 4 · quem está fazendo",
    explicacao:
      "Trabalho em grupo. Coloque o seu e-mail e os e-mails do grupo. Cópia e cola estão " +
      "bloqueados: o planejamento tem que ser escrito aqui.",
  });
  estado.guarda = ativar({ exercicio: EXERCICIO, colar: false, copiar: false, capturas: true });

  const [config, rubrica] = await Promise.all([
    fetch("temas.json").then((r) => r.json()),
    fetch("../rubricas/ex04-planejamento.json").then((r) => r.json()),
  ]);
  estado.config = config;
  estado.rubrica = rubrica;
  estado.tentativas = contadorTentativas(config.limites.max_avaliacoes);

  // As instruções da rubrica são escritas para o modelo: exibi-las aqui só
  // enchia a tela de jargão. Elas continuam indo para o prompt.
  limpar($("#painel-rubrica")).append(painelRubrica(rubrica, { mostrarInstrucoes: false }));
  montarTemas();
  montarCampos("#campos-antes", config.campos_antes, "#progresso-antes");
  montarCampos("#campos-depois", config.campos_depois, "#progresso-depois");
  for (let i = 0; i < 3; i += 1) adicionarVariavel();
  $("#b-add-variavel").addEventListener("click", () => adicionarVariavel());
  $("#b-avaliar").addEventListener("click", avaliar);
  $("#b-fechar").addEventListener("click", fechar);
}

/* ---------- tema -------------------------------------------------------- */

function montarTemas() {
  const alvo = limpar($("#lista-temas"));
  for (const t of estado.config.temas) {
    const cartao = el("label.cartao-tema", { for: `t-${t.id}` }, [
      el("div.area", { texto: t.area }),
      el("h4", {}, [
        el("input", { type: "radio", name: "tema", id: `t-${t.id}`, value: t.id }),
        t.titulo,
      ]),
      el("div", { texto: t.contexto }),
    ]);
    cartao.addEventListener("change", () => {
      estado.tema = t;
      $$(".cartao-tema").forEach((c) => c.classList.remove("marcado"));
      cartao.classList.add("marcado");
      limpar($("#tema-escolhido")).append(
        el("div.ficha.destaque", { style: "margin-top:.6rem" }, [
          el("span.rotulo", { texto: "tema escolhido" }),
          el("div", {}, [el("strong", { texto: t.titulo })]),
          el("div.miudo", { html: `<strong>Fontes que existem:</strong> ${esc(t.fontes_possiveis)}` }),
          el("div.miudo", { html: `<strong>Armadilha conhecida:</strong> ${esc(t.armadilha)}` }),
        ]),
        fichaJuridica(t)
      );
      $("#s-tema").classList.add("concluida");
      for (const s of ["#s-antes", "#s-variaveis", "#s-depois", "#s-avaliar"]) {
        $(s).classList.remove("travada");
      }
      estado.passos.ir(1);
      estado.guarda.marco("ex04_tema", t.id);
    });
    alvo.append(cartao);
  }
}

/* ---------- campos de texto -------------------------------------------- */

function montarCampos(seletor, campos, seletorProgresso) {
  const alvo = limpar($(seletor));
  for (const campo of campos) {
    estado.respostas[campo.id] = "";
    const contagem = el("span.contagem", {
      texto: `0 palavras (sugerido: ${campo.sugestao_palavras})`,
    });
    // O placeholder repetia a descrição inteira, e o mesmo texto aparecia duas
    // vezes na tela. Aqui ele é só uma pista curta, declarada no JSON.
    const area = el("textarea", {
      id: `c-${campo.id}`,
      rows: String(campo.linhas),
      maxlength: String(campo.max_caracteres),
      placeholder: campo.placeholder || "",
      spellcheck: "true",
    });
    const alertaCampo = el("div");
    area.addEventListener("input", () => {
      estado.respostas[campo.id] = area.value;
      const n = contarPalavras(area.value);
      contagem.textContent = `${n} palavras (sugerido: ${campo.sugestao_palavras})`;
      contagem.className = `contagem ${n >= campo.sugestao_palavras ? "ok" : ""}`;
      limpar(alertaCampo);
      if (campo.exige_interrogacao && area.value.trim() && !area.value.trim().endsWith("?")) {
        alertaCampo.append(
          aviso(
            "atencao",
            null,
            "Pergunta de pesquisa termina com ponto de interrogação. Se não dá para escrever " +
              "como pergunta, provavelmente ainda é um tema, não uma pergunta."
          )
        );
      }
      atualizarProgresso(campos, seletorProgresso);
    });
    alvo.append(
      el("div.campo", {}, [
        el("label.rotulo", { for: `c-${campo.id}`, texto: campo.rotulo }),
        el("p.miudo", { style: "margin:0 0 .3rem", texto: campo.ajuda }),
        // Conteúdo nosso, do JSON da disciplina, com fórmulas em LaTeX para o
        // MathJax compor. Não entra texto de aluno aqui.
        campo.exemplo_html ? el("div.exemplos-formula", { html: campo.exemplo_html }) : null,
        area,
        contagem,
        alertaCampo,
      ])
    );
  }
  atualizarProgresso(campos, seletorProgresso);
  comporFormulas();
}

/**
 * Pede ao MathJax que componha o que acabou de entrar no DOM.
 *
 * O script do MathJax carrega em paralelo com este módulo, então ele pode
 * ainda não estar pronto quando os campos são montados. Em vez de depender da
 * ordem de carregamento, tenta algumas vezes e desiste em silêncio: sem
 * MathJax o aluno vê a fórmula em LaTeX, que continua legível.
 */
async function comporFormulas() {
  for (let i = 0; i < 20; i += 1) {
    if (window.MathJax?.typesetPromise) {
      try {
        await window.MathJax.typesetPromise();
      } catch {
        // fórmula malformada não pode derrubar o formulário
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

function atualizarProgresso(campos, seletorProgresso) {
  const escritos = campos.filter((c) => contarPalavras(estado.respostas[c.id]) > 0).length;
  $(seletorProgresso).textContent = `${escritos} de ${campos.length} campos escritos`;
}

/* ---------- variáveis --------------------------------------------------- */

function adicionarVariavel(inicial = {}) {
  const { max_variaveis: max } = estado.config.limites;
  if (estado.variaveis.length >= max) return toast(`No máximo ${max} variáveis.`);
  estado.variaveis.push({
    chave: `v${Date.now()}${Math.floor(Math.random() * 1000)}`,
    nome: "",
    tipo: "categorica_nominal",
    papeis: ["independente"],
    medicao: "",
    ...inicial,
  });
  desenharVariaveis();
}

function desenharVariaveis() {
  const alvo = limpar($("#editor-variaveis"));
  for (const v of estado.variaveis) {
    const classes = v.papeis.map((p) => `tem-${p}`).join(".");
    const linha = el(`div.var-linha${classes ? "." + classes : ""}`);

    const nome = el("input", {
      type: "text", value: v.nome, placeholder: "nome_da_variavel", maxlength: "40",
    });
    nome.addEventListener("input", () => {
      v.nome = nome.value.trim().replace(/\s+/g, "_").toLowerCase();
      nome.value = v.nome;
    });

    const tipo = el("select", {}, estado.config.tipos_variavel.map((t) =>
      el("option", { value: t.id, texto: t.rotulo, selected: t.id === v.tipo })));
    tipo.addEventListener("change", () => (v.tipo = tipo.value));

    const papeis = el("div.papeis-check");
    for (const p of estado.config.papeis_variavel) {
      const marca = el("input", {
        type: "checkbox",
        checked: v.papeis.includes(p.id),
      });
      marca.addEventListener("change", () => {
        v.papeis = marca.checked
          ? [...new Set([...v.papeis, p.id])]
          : v.papeis.filter((x) => x !== p.id);
        desenharVariaveis();
      });
      // sem a explicação ao lado: em quatro linhas de variável o texto repetido
      // vira ruído. A explicação de cada papel fica no title e no enunciado.
      papeis.append(
        el("label", { title: p.ajuda }, [marca, el("span", { texto: p.rotulo })])
      );
    }

    const medicao = el("textarea", {
      rows: "3", maxlength: "300",
      placeholder: "onde essa informação está no documento e que valores ela pode ter",
    });
    medicao.value = v.medicao;
    medicao.addEventListener("input", () => (v.medicao = medicao.value));

    linha.append(
      el("div", {}, [el("span.rotulo", { texto: "nome" }), nome]),
      el("div", {}, [el("span.rotulo", { texto: "tipo" }), tipo]),
      el("div", {}, [el("span.rotulo", { texto: "papel (pode marcar mais de um)" }), papeis]),
      el("div", {}, [el("span.rotulo", { texto: "como medir" }), medicao]),
      el("button.secundario", {
        type: "button", texto: "×", title: "remover",
        onclick: () => {
          estado.variaveis = estado.variaveis.filter((x) => x.chave !== v.chave);
          desenharVariaveis();
        },
      })
    );
    alvo.append(linha);
  }
  const temDesfecho = estado.variaveis.some((v) => v.papeis.includes("dependente"));
  const temExplicativa = estado.variaveis.some((v) => v.papeis.includes("independente"));
  $("#contador-variaveis").textContent =
    `${estado.variaveis.length} de ${estado.config.limites.max_variaveis} · ` +
    `${temDesfecho ? "com" : "sem"} desfecho · ${temExplicativa ? "com" : "sem"} explicativa`;
  mostrarProblemasDePapel();
}

/**
 * Problemas de papel que dá para apontar sem julgar o mérito da pesquisa.
 *
 * O app avisa e deixa seguir: a rubrica é que avalia. Travar aqui esconderia do
 * feedback exatamente o erro que vale discutir, e o aluno pode ter um motivo que
 * o app não conhece.
 */
export function problemasDePapel(variaveis) {
  const problemas = [];
  const nome = (v) => v.nome || "(sem nome)";

  for (const v of variaveis) {
    if (v.papeis.includes("dependente") && v.papeis.includes("independente")) {
      problemas.push(
        `"${nome(v)}" está marcada como o desfecho e como o que explica o desfecho ao mesmo ` +
          "tempo. Uma variável não pode explicar a si mesma: escolha um dos dois papéis."
      );
    }
    if (v.papeis.includes("identificador") && v.papeis.length > 1) {
      problemas.push(
        `"${nome(v)}" identifica o caso e ainda tem outro papel. Número de processo não explica ` +
          "nada: se ele carrega alguma informação (ano, comarca), essa informação é outra variável."
      );
    }
    if (!v.papeis.length) {
      problemas.push(`"${nome(v)}" está sem papel nenhum: para que ela entra na tabela?`);
    }
  }

  const dependentes = variaveis.filter((v) => v.papeis.includes("dependente"));
  if (dependentes.length > 1) {
    problemas.push(
      `Há ${dependentes.length} variáveis marcadas como desfecho (${dependentes.map(nome).join(", ")}). ` +
        "Uma pergunta de pesquisa tem um desfecho; duas perguntas viram dois estudos."
    );
  }
  if (!dependentes.length) {
    problemas.push("Nenhuma variável é o desfecho. Sem desfecho, o que a pergunta compara?");
  }
  if (!variaveis.some((v) => v.papeis.includes("independente"))) {
    problemas.push("Nenhuma variável explica o desfecho. O que a pergunta quer associar a ele?");
  }
  return problemas;
}

function mostrarProblemasDePapel() {
  const alvo = limpar($("#alertas-papeis"));
  const problemas = problemasDePapel(estado.variaveis);
  if (!problemas.length) return;
  alvo.append(
    aviso(
      "atencao",
      "Confira os papéis antes de pedir feedback",
      problemas.map((p) => `- ${p}`).join("\n")
    )
  );
}

/* ---------- avaliação --------------------------------------------------- */

function pendencias() {
  const falta = [];
  if (!estado.tema) falta.push("escolher o tema");
  const todos = [...estado.config.campos_antes, ...estado.config.campos_depois];
  const vazios = todos.filter((c) => !contarPalavras(estado.respostas[c.id]));
  if (vazios.length) falta.push(`escrever: ${vazios.map((c) => c.rotulo.toLowerCase()).join(", ")}`);
  if (estado.variaveis.length < estado.config.limites.min_variaveis) {
    falta.push(`declarar ao menos ${estado.config.limites.min_variaveis} variáveis`);
  }
  if (estado.variaveis.some((v) => !v.nome || !v.medicao.trim())) {
    falta.push("dar nome e forma de medição a todas as variáveis");
  }
  if (estado.variaveis.some((v) => !v.papeis.length)) {
    falta.push("marcar pelo menos um papel em cada variável");
  }
  return falta;
}

function textoDoPlanejamento() {
  const campo = (c) => `## ${c.rotulo}\n${(estado.respostas[c.id] || "").trim()}`;
  return [
    `TEMA ESCOLHIDO: ${estado.tema.titulo} (${estado.tema.area})`,
    `Contexto dado no enunciado: ${estado.tema.contexto}`,
    `Armadilha que o enunciado já avisou: ${estado.tema.armadilha}`,
    "",
    ...estado.config.campos_antes.map(campo),
    "",
    "## Variáveis declaradas",
    "(papéis possíveis: identificador, dependente = desfecho, independente = explicativa, filtro)",
    ...estado.variaveis.map(
      (v, i) =>
        `${i + 1}. ${v.nome} | tipo: ${v.tipo} | papel: ${v.papeis.join(", ") || "(nenhum)"}\n   como medir: ${v.medicao}`
    ),
    problemasDePapel(estado.variaveis).length
      ? "Problemas de papel que o app já detectou por regra (confirme e explique ao grupo, " +
        "sem repetir o texto do app):\n" +
        problemasDePapel(estado.variaveis).map((p) => `- ${p}`).join("\n")
      : "O app não detectou problema formal nos papéis declarados.",
    "",
    ...estado.config.campos_depois.map(campo),
  ].join("\n\n");
}

async function avaliar() {
  const falta = pendencias();
  if (falta.length) {
    limpar($("#painel-feedback")).append(
      aviso("atencao", "Falta isto antes de pedir feedback:", falta.map((f) => `- ${f}`).join("\n"))
    );
    return;
  }
  if (estado.tentativas.esgotou) {
    limpar($("#painel-feedback")).append(avisoTentativasEsgotadas(estado.tentativas.maximo));
    return;
  }

  const botao = $("#b-avaliar");
  const status = $("#status-avaliacao");
  botao.disabled = true;
  status.replaceChildren(el("span.carregando", { texto: "avaliando pela rubrica" }));

  const usuario = [
    "PLANEJAMENTO DE PESQUISA SUBMETIDO PELO ALUNO:",
    "",
    textoDoPlanejamento(),
    "",
    estado.feedbacks.length
      ? `Esta é a avaliação ${estado.feedbacks.length + 1} de ${estado.tentativas.maximo}. ` +
        "Antes você apontou: " + estado.feedbacks.map((f) => f.proximo_passo).join(" | ") +
        ". Diga o que melhorou e o que continua pendente."
      : `Primeira avaliação (de ${estado.tentativas.maximo}).`,
    "",
    "Sobre a unidade de análise: neste projeto a linha da tabela é sempre um processo ou " +
      "contrato, então não cobre isso como se fosse omissão.",
    "",
    rubricaEmTexto(estado.rubrica),
    "",
    "Devolva JSON com criterios (id, nivel, comentario, evidencia, sugestao), resumo, " +
      "proximo_passo e pontos_fortes.",
  ].join("\n");

  try {
    const resposta = await chamar({
      tarefa: "ex04_feedback",
      modelo: CONFIG.modelos.complexo,
      sistema: SISTEMA_FEEDBACK,
      usuario,
      json: true,
      esquema: ESQUEMA_FEEDBACK,
      maxTokens: 2500,
      temperatura: 0.3,
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
      estado.tentativas.esgotou ? avisoTentativasEsgotadas(estado.tentativas.maximo) : null
    );
    status.replaceChildren(el("span.etiqueta", { texto: estado.tentativas.texto() }));
    estado.tentativas.aplicar($("#contador-feedback"), botao);
    for (const s of ["#s-observacoes", "#s-entrega"]) $(s).classList.remove("travada");
    estado.passos.ir(4);
    await registrarSubmissao({
      exercicio: EXERCICIO,
      etapa: "feedback",
      identificacao: estado.identidade,
      tema: estado.tema.id,
      iteracao: estado.feedbacks.length,
      respostas: estado.respostas,
      variaveis: estado.variaveis.map(({ chave, ...resto }) => resto),
      feedback: resposta.dados,
      modelo: resposta.modelo,
      monitoramento: estado.guarda.resumo(),
    });
  } catch (erro) {
    status.replaceChildren(el("span.etiqueta.erro", { texto: "falhou" }));
    limpar($("#painel-feedback")).append(
      aviso("erro", "Não consegui avaliar agora", String(erro.message || erro))
    );
  } finally {
    if (!estado.tentativas.esgotou) botao.disabled = false;
  }
}

/* ---------- entrega ----------------------------------------------------- */

async function fechar() {
  const falta = pendencias();
  if (falta.length) {
    limpar($("#painel-entrega")).append(
      aviso("atencao", "Falta isto antes de fechar:", falta.map((f) => `- ${f}`).join("\n"))
    );
    return;
  }
  const botao = $("#b-fechar");
  botao.disabled = true;
  $("#status-entrega").replaceChildren(el("span.carregando", { texto: "gerando" }));

  // A crítica ao feedback vai para o professor, no arquivo e na submissão, e
  // não para o modelo: discordar com argumento é conversa com quem corrige, e
  // não mais uma rodada de negociação com a IA.
  const observacoes = ($("#c-observacoes")?.value || "").trim();

  const conteudo = [
    "# Planejamento de pesquisa - Projeto 4",
    "CDAD II · 2026/2 · Insper",
    "",
    `- Integrantes: ${estado.identidade.integrantes.join(", ")}`,
    `- Submetido por: ${estado.identidade.email}`,
    `- Fechado em: ${agora()}`,
    `- Tema: ${estado.tema.titulo} (${estado.tema.area})`,
    `- Avaliações automáticas usadas: ${estado.feedbacks.length}`,
    "",
    "---",
    "",
    textoDoPlanejamento(),
    "",
    observacoes
      ? `## Observações do grupo sobre o feedback automático\n${observacoes}`
      : "## Observações do grupo sobre o feedback automático\n(o grupo não registrou observações)",
    "",
    "---",
    "",
    `_Arquivo gerado pelo app do projeto. O código de verificação (SHA-256) deste conteúdo foi ` +
      `registrado junto com a submissão; editar o arquivo depois quebra a conferência._`,
  ].join("\n");

  const hash = await sha256(conteudo);
  const nome = `ex04_planejamento_${chaveDoGrupo(estado.identidade).replace(/\+/g, "-")}.md`;

  const resultado = await registrarSubmissao({
    exercicio: EXERCICIO,
    etapa: "final",
    identificacao: estado.identidade,
    tema: estado.tema.id,
    respostas: estado.respostas,
    variaveis: estado.variaveis.map(({ chave, ...resto }) => resto),
    observacoes_sobre_feedback: observacoes,
    avaliacoes_usadas: estado.feedbacks.length,
    hash_arquivo: hash,
    nome_arquivo: nome,
    monitoramento: estado.guarda.resumo(),
  });

  $("#status-entrega").replaceChildren(
    el(`span.etiqueta.${resultado.ok ? "ok" : "erro"}`, {
      texto: resultado.ok ? "submissão registrada" : "registro falhou (avise o professor)",
    })
  );
  limpar($("#painel-entrega")).append(
    aviso("ok", "Arquivo pronto", "Baixe e entregue no BlackBoard sem editar."),
    el("div.acoes", { style: "margin-top:0" }, [
      el("button.principal", {
        type: "button",
        texto: `baixar ${nome}`,
        onclick: () => baixar(nome, conteudo, "text/markdown;charset=utf-8"),
      }),
    ]),
    el("div.ficha.destaque", { style: "margin-top:.8rem" }, [
      el("span.rotulo", { texto: "código de verificação do arquivo (SHA-256)" }),
      el("div.mono", { texto: hash }),
      el("p.miudo", {
        texto:
          "Se precisar mudar algo, mude aqui no app e feche de novo: o código novo também fica " +
          "registrado. Baixar arquivo não conta como saída da aba.",
      }),
    ])
  );
  $("#s-entrega").classList.add("concluida");
  estado.passos.ir(5);
  botao.disabled = false;
  botao.textContent = "Gerar de novo";
}

iniciar().catch((erro) => {
  document.body.prepend(aviso("erro", "Erro ao iniciar", String(erro.message || erro)));
});
