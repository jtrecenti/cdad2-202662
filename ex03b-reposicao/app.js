/* ==========================================================================
   Projeto 3, reposição (aula 10) · Probabilidade e variável aleatória.

   Versão para fazer em casa da prova do projeto 3, para quem combinou outra
   data com o professor. Mesmos conteúdos e mesmos pesos da prova de 10/09
   (condicional, independência, Bayes, valor esperado e risco), com casos novos,
   e fica com id próprio (ex03b) para a submissão não se confundir com a da
   turma.

   O aluno escreve as respostas no próprio app. Elas ficam salvas neste
   navegador enquanto ele escreve (localStorage, por e-mail), e o envio grava
   tudo no Firebase e oferece o arquivo em markdown, com o código de
   verificação, para guardar e entregar. Quem corrige é o professor, com o
   gabarito que fica no repositório privado: este app não tem resposta nenhuma.

   Colar nos campos está bloqueado, e as tentativas vão junto com o envio. Não
   há registro de troca de aba: fazer em casa com o material aberto é o
   combinado, e registrar isso seria vigiar justamente o que foi permitido.
   ========================================================================== */

import { exigirIdentificacao } from "../_shared/identidade.js";
import { registrarSubmissao } from "../_shared/firebase.js";
import { carregarLiberacao, exigirLiberacao, formatarData } from "../_shared/liberacao.js";
import { $, el, limpar, aviso, toast, montarTopo, baixar, sha256, agora } from "../_shared/ui.js";

const EXERCICIO = "ex03b";
const SIMBOLOS = ["∩", "∪", "ᶜ", "|", "P( )"];

const estado = {
  identidade: null,
  chave: null,
  respostas: {},
  colar: 0,
  ultimaNotacao: null,
};

/* ---------- o conteúdo --------------------------------------------------- */

// Os rótulos de cada campo, na ordem em que aparecem: é deles que sai o arquivo
// do envio, e é por eles que o aviso de "campo em branco" fala com o aluno.
const CAMPOS = [
  ["q1a_iii", "1a) iii. em notação"],
  ["q1a_iv", "1a) iv. em notação"],
  ["q1a_v", "1a) v. em notação"],
  ["q1a_vi", "1a) vi. em notação"],
  ["q1b_i", "1b) P(i)"],
  ["q1b_ii", "1b) P(ii)"],
  ["q1b_iii", "1b) P(iii)"],
  ["q1b_iv", "1b) P(iv)"],
  ["q1b_v", "1b) P(v)"],
  ["q1b_vi", "1b) P(vi)"],
  ["q1b_contas", "1b) contas"],
  ["q1c", "1c) independência e frase"],
  ["q1d", "1d) Bayes e frase"],
  ["q2a_p0", "2a) P(X = 0)"],
  ["q2a_valor", "2a) valor de X na linha do meio"],
  ["q2a_p1000", "2a) P(X = 1.000)"],
  ["q2b", "2b) E(X) e frase"],
  ["q2c", "2c) decisão, risco e medida"],
];

const EVENTOS = [
  ["i", "a mora foi purgada e o contrato tinha fiador", "A ∩ B"],
  ["ii", "a mora não foi purgada", "Aᶜ"],
  ["iii", "a mora foi purgada ou o contrato tinha fiador", null],
  ["iv", "o contrato não tinha fiador", null],
  ["v", "o contrato tinha fiador e a mora não foi purgada", null],
  ["vi", "a mora foi purgada, sabendo que o contrato tinha fiador", null],
];

/* ---------- campos e rascunho -------------------------------------------- */

function campo(id, tipo = "input", atributos = {}) {
  const nó = el(tipo === "texto" ? "textarea" : "input", {
    id,
    spellcheck: tipo === "texto" ? "true" : "false",
    autocomplete: "off",
    ...(tipo === "texto" ? { rows: "5" } : { type: "text" }),
    ...atributos,
  });
  nó.dataset.campo = id;
  nó.value = estado.respostas[id] || "";
  nó.addEventListener("input", () => {
    estado.respostas[id] = nó.value;
    salvar();
  });
  return nó;
}

function salvar() {
  try {
    localStorage.setItem(estado.chave, JSON.stringify({
      respostas: estado.respostas,
      colar: estado.colar,
      comecou_em: estado.comecou_em,
    }));
    $("#salvo").textContent = `rascunho salvo neste navegador às ${agora().slice(11, 16)}`;
  } catch {
    $("#salvo").textContent = "não consegui salvar o rascunho neste navegador";
  }
}

function recuperar() {
  try {
    const salvo = JSON.parse(localStorage.getItem(estado.chave) || "null");
    if (salvo) {
      estado.respostas = salvo.respostas || {};
      estado.colar = salvo.colar || 0;
      estado.comecou_em = salvo.comecou_em || agora();
      return true;
    }
  } catch {
    /* rascunho ilegível: começa do zero */
  }
  estado.comecou_em = agora();
  return false;
}

/** Colar e arrastar texto ficam bloqueados nos campos de resposta. */
function bloquearColar() {
  const bloquear = (evento) => {
    if (!evento.target.closest?.("[data-campo]")) return;
    evento.preventDefault();
    estado.colar += 1;
    salvar();
    toast("Colar está bloqueado nesta prova: escreva a resposta.");
  };
  document.addEventListener("paste", bloquear);
  document.addEventListener("drop", bloquear);
}

/* ---------- desenho -------------------------------------------------------- */

function secao(numero, titulo, dica, filhos) {
  return el("section.secao", {}, [
    el("header", {}, [
      el("span.n", { texto: numero }),
      el("h2", { texto: titulo }),
      el("span.dica", { texto: dica }),
    ]),
    el("div.corpo", {}, filhos),
  ]);
}

function item(letra, texto, pontos) {
  return el("p.enunciado.item", {}, [
    el("strong", { texto: `${letra}) ` }),
    texto,
    el("span.pontos", { texto: `  (${pontos})` }),
  ]);
}

function tabelaDados(cabecalho, linhas) {
  return el("table.dados", {}, [
    el("thead", {}, [el("tr", {}, cabecalho.map((c) => el("th", { texto: c })))]),
    el("tbody", {}, linhas.map((l) =>
      el("tr", {}, l.map((c, i) => el(i === 0 || /total/.test(l[0]) ? "th" : "td", { texto: c })))
    )),
  ]);
}

function paleta() {
  return el("div.paleta", {}, [
    el("span.miudo", { texto: "símbolos:" }),
    ...SIMBOLOS.map((s) =>
      el("button.secundario", {
        type: "button",
        texto: s,
        title: `inserir ${s} no último campo de notação em que você clicou`,
        onclick: () => inserirSimbolo(s),
      })
    ),
  ]);
}

function inserirSimbolo(simbolo) {
  const alvo = estado.ultimaNotacao;
  if (!alvo) return toast("Clique primeiro no campo em que quer escrever.");
  const texto = simbolo === "P( )" ? "P()" : simbolo;
  const [ini, fim] = [alvo.selectionStart ?? alvo.value.length, alvo.selectionEnd ?? alvo.value.length];
  alvo.value = alvo.value.slice(0, ini) + texto + alvo.value.slice(fim);
  const cursor = ini + (simbolo === "P( )" ? 2 : texto.length);
  alvo.focus();
  alvo.setSelectionRange(cursor, cursor);
  alvo.dispatchEvent(new Event("input"));
}

function questao1() {
  const notacao = el("table.dados.notacao", {}, [
    el("thead", {}, [el("tr", {}, ["", "o caso sorteado...", "em notação"].map((c) => el("th", { texto: c })))]),
    el("tbody", {}, EVENTOS.map(([n, texto, exemplo]) => {
      let celula;
      if (exemplo) {
        celula = el("td.exemplo", { texto: `${exemplo}  (exemplo)` });
      } else {
        const entrada = campo(`q1a_${n}`, "input", { placeholder: "ex.: A ∩ B" });
        entrada.addEventListener("focus", () => { estado.ultimaNotacao = entrada; });
        celula = el("td", {}, [entrada]);
      }
      return el("tr", {}, [el("td", { texto: n }), el("td", { texto: texto }), celula]);
    })),
  ]);

  const probs = el("div.probs", {}, EVENTOS.map(([n]) =>
    el("label", {}, [el("span", { texto: `P(${n}) =` }), campo(`q1b_${n}`, "input", { placeholder: "ex.: 7/20" })])
  ));

  return secao("01", "Questão 1 · 6,0 pontos", "tabela de dupla entrada, condicional e Bayes", [
    el("p.enunciado", {
      html:
        "Na ação de despejo por falta de pagamento, a Lei do Inquilinato (Lei 8.245/1991, " +
        "art. 62, II) permite ao locatário e ao fiador evitar a rescisão do contrato pagando, no " +
        "prazo, o débito atualizado: é a <strong>purgação da mora</strong>. O contrato de locação " +
        "pode ter uma garantia (art. 37), e a mais comum é o <strong>fiador</strong>, que responde " +
        "pela dívida se o locatário não pagar.",
    }),
    el("p.enunciado", {
      html:
        "Uma pesquisa acompanhou as <strong>200 ações de despejo por falta de pagamento</strong> " +
        "julgadas numa vara em um ano, para investigar se ter fiador tem relação com a purgação da " +
        "mora.",
    }),
    tabelaDados(["", "mora purgada", "não purgada", "total"], [
      ["com fiador", "45", "15", "60"],
      ["sem fiador", "35", "105", "140"],
      ["total", "80", "120", "200"],
    ]),
    el("p.enunciado", { texto: "Uma ação é sorteada ao acaso entre as 200. Considere os eventos:" }),
    el("div.dados-caixa", {}, [
      el("div", { html: "<strong>A</strong>: a mora foi purgada" }),
      el("div", { html: "<strong>B</strong>: o contrato tinha fiador" }),
    ]),

    item("a", "Escreva cada frase abaixo em notação de conjuntos ou condicionais. As duas primeiras já estão resolvidas, como exemplo do que se espera. Um diagrama de Venn com os números da tabela ajuda aqui e no item (b).", "1,5"),
    paleta(),
    notacao,

    item("b", "Calcule a probabilidade de cada um dos seis eventos do item (a). Pode deixar em fração.", "1,5"),
    probs,
    el("label.rotulo", { for: "q1b_contas", texto: "as contas (principalmente a do item iii)" }),
    campo("q1b_contas", "texto", { rows: "4" }),

    item("c", "Os eventos A e B são independentes? Justifique com os números e diga, em uma frase, o que isso significa para um locador que está decidindo se exige fiador no contrato.", "1,0"),
    campo("q1c", "texto"),

    item("d", "", "2,0"),
    el("p.enunciado", {
      html:
        "Uma administradora de imóveis passou a usar uma <strong>ferramenta automática de " +
        "conferência de assinaturas</strong> nos contratos com fiador, porque há golpes com " +
        "fiadores falsos: alguém assina em nome de uma pessoa que nem sabe do contrato. Considere " +
        "os eventos <strong>F</strong>: a assinatura do fiador é falsa; e <strong>S</strong>: a " +
        "ferramenta aponta a assinatura como falsa. Sabe-se que:",
    }),
    el("ul.enunciado", {}, [
      el("li", { html: "<strong>10%</strong> das assinaturas que chegam são falsas: P(F) = 0,10;" }),
      el("li", { html: "entre as <strong>falsas</strong>, a ferramenta aponta <strong>90%</strong>: P(S | F) = 0,90;" }),
      el("li", { html: "entre as <strong>verdadeiras</strong>, a ferramenta aponta <strong>10%</strong> por engano: P(S | Fᶜ) = 0,10." }),
    ]),
    el("p.enunciado", {
      html:
        "A ferramenta apontou a assinatura de um contrato como falsa. Utilize o <strong>teorema de " +
        "Bayes</strong> para calcular a probabilidade de a assinatura ser realmente falsa, " +
        "P(F | S). Considerando o resultado, a administradora deveria recusar o contrato só pelo " +
        "alerta da ferramenta? Explique em uma frase.",
    }),
    campo("q1d", "texto", { rows: "7" }),
  ]);
}

function questao2() {
  const distribuicao = el("table.dados.distribuicao", {}, [
    el("thead", {}, [el("tr", {}, [el("th", { texto: "valor de X" }), el("th", { texto: "P(X = x)" })])]),
    el("tbody", {}, [
      el("tr", {}, [el("td.dada", { texto: "R$ 0" }), el("td", {}, [campo("q2a_p0", "input", { placeholder: "probabilidade" })])]),
      el("tr", {}, [
        el("td", {}, [campo("q2a_valor", "input", { placeholder: "valor de X" })]),
        el("td.dada", {}, ["0,48 ", el("span.conta", { texto: "(0,4 × 0,6 + 0,6 × 0,4)" })]),
      ]),
      el("tr", {}, [el("td.dada", { texto: "R$ 1.000" }), el("td", {}, [campo("q2a_p1000", "input", { placeholder: "probabilidade" })])]),
      el("tr", {}, [el("th", { texto: "total" }), el("th", { texto: "1,00" })]),
    ]),
  ]);

  return secao("02", "Questão 2 · 4,0 pontos", "variável aleatória, valor esperado e risco", [
    el("p.enunciado", {
      html:
        "A mesma administradora tenta um acordo com os inquilinos inadimplentes antes de ir à " +
        "Justiça. A equipe faz <strong>duas propostas de acordo por dia</strong>. Cada proposta é " +
        "aceita com <strong>40% de chance</strong>, e uma não influencia a outra. Cada acordo " +
        "aceito rende à administradora <strong>R$ 500</strong> de taxa.",
    }),
    el("p.enunciado", { texto: "Seja X o valor que a administradora recebe no dia." }),

    item("a", "Complete a tabela com a distribuição de X.", "1,5"),
    distribuicao,

    item("b", "Mostre como se calcula E(X) e confira que o resultado dá R$ 400. Note que a administradora nunca recebe R$ 400 em um dia. Explique, em uma frase, qual é a utilidade prática desse número para planejar o mês.", "1,5"),
    campo("q2b", "texto"),

    item("c", "Contratar mais uma pessoa custaria R$ 300 por dia de trabalho e dobraria o número de propostas por dia, o que dobraria também o valor esperado. Do ponto de vista puramente dos resultados financeiros esperados, vale a pena contratar? Justifique. Depois explique, em uma frase, qual o risco prático dessa decisão, e qual medida pode ser olhada junto com a média para avaliar esse risco.", "1,0"),
    campo("q2c", "texto", { rows: "6" }),
  ]);
}

/* ---------- envio ---------------------------------------------------------- */

function arquivo(enviadoEm) {
  const linhas = [
    "# Projeto 3 (aula 10), reposição · CDAD II 2026/2",
    "",
    `- aluno: ${estado.identidade.email}`,
    `- começou em: ${estado.comecou_em}`,
    `- enviado em: ${enviadoEm}`,
    `- tentativas de colar bloqueadas: ${estado.colar}`,
    "",
  ];
  let questaoAtual = null;
  for (const [id, rotulo] of CAMPOS) {
    const questao = id.startsWith("q1") ? "## Questão 1" : "## Questão 2";
    if (questao !== questaoAtual) {
      linhas.push(questao, "");
      questaoAtual = questao;
    }
    const valor = String(estado.respostas[id] || "").trim();
    linhas.push(`**${rotulo}**`, "", valor || "(em branco)", "");
  }
  return linhas.join("\n");
}

function camposEmBranco() {
  return CAMPOS.filter(([id]) => !String(estado.respostas[id] || "").trim()).map(([, rotulo]) => rotulo);
}

async function enviar() {
  const botao = $("#b-enviar");
  const brancos = camposEmBranco();
  const avisos = limpar($("#avisos-envio"));
  if (brancos.length && !botao.dataset.confirmado) {
    avisos.append(aviso(
      "atencao",
      `${brancos.length} campo${brancos.length > 1 ? "s" : ""} em branco`,
      `${brancos.join(" · ")}. Se quiser enviar assim mesmo, clique de novo em enviar.`
    ));
    botao.dataset.confirmado = "1";
    return;
  }
  delete botao.dataset.confirmado;
  botao.disabled = true;
  $("#status-envio").replaceChildren(el("span.carregando", { texto: "enviando" }));

  const enviadoEm = agora();
  const conteudo = arquivo(enviadoEm);
  const hash = await sha256(conteudo);
  const resultado = await registrarSubmissao({
    exercicio: EXERCICIO,
    etapa: "final",
    identificacao: estado.identidade,
    respostas: estado.respostas,
    comecou_em: estado.comecou_em,
    tentativas_colar: estado.colar,
    em_branco: brancos,
    hash_respostas: hash,
  });

  $("#status-envio").replaceChildren(
    el(`span.etiqueta.${resultado.ok ? "ok" : "erro"}`, {
      texto: resultado.ok ? "enviado" : "o registro falhou: baixe o arquivo e mande por e-mail",
    })
  );
  limpar($("#painel-envio")).append(
    el("div.ficha.destaque", { style: "margin-top:.8rem" }, [
      el("span.rotulo", { texto: "comprovante" }),
      el("div", { texto: `Enviado em ${enviadoEm}, por ${estado.identidade.email}.` }),
      el("div.mono.miudo", { texto: `código de verificação: ${hash}` }),
      el("div.acoes", { style: "margin-top:.6rem" }, [
        el("button.principal", {
          type: "button",
          texto: "baixar o arquivo com as respostas",
          onclick: () =>
            baixar(`ex03b_${estado.identidade.email.split("@")[0]}.md`, conteudo, "text/markdown;charset=utf-8"),
        }),
      ]),
      el("p.miudo", {
        texto: "Guarde o arquivo. Se precisar corrigir alguma coisa, edite as respostas acima e envie de novo: vale o último envio.",
      }),
    ])
  );
  $("#s-envio").classList.add("concluida");
  botao.disabled = false;
}

/* ---------- arranque ------------------------------------------------------- */

async function iniciar() {
  montarTopo({ exercicio: "Projeto 3 · reposição", aula: "aula 10", titulo: "Probabilidade e variável aleatória" });
  const liberacao = await exigirLiberacao(EXERCICIO);
  if (!liberacao.liberado) return;

  try {
    const config = await carregarLiberacao("../liberacao.json");
    const prazo = config?.exercicios?.[EXERCICIO]?.entrega_em;
    if (prazo) $("#prazo").textContent = `O prazo é ${formatarData(prazo)}.`;
  } catch {
    /* sem o prazo, fica o texto padrão */
  }

  estado.identidade = await exigirIdentificacao({
    exercicio: EXERCICIO,
    emGrupo: false,
    titulo: "Projeto 3 (reposição) · quem está fazendo",
    explicacao: "Prova individual, para fazer em casa. Use o seu e-mail do Insper: o envio fica registrado no seu nome.",
  });
  estado.chave = `cdad2:${EXERCICIO}:${estado.identidade.email}`;
  const tinhaRascunho = recuperar();

  limpar($("#prova")).append(questao1(), questao2());
  bloquearColar();
  if (tinhaRascunho) toast("Recuperei o rascunho que estava salvo neste navegador.");
  salvar();
  $("#b-enviar").addEventListener("click", enviar);
}

iniciar().catch((erro) => {
  document.body.prepend(aviso("erro", "Erro ao iniciar", String(erro.message || erro)));
});
