/* ==========================================================================
   Rubrica visível para o aluno.

   Avaliar com rubrica escondida é pegadinha. O aluno tem que poder ler, antes de
   escrever, o que vai ser olhado no trabalho dele. Este módulo desenha a mesma
   rubrica JSON que vai no prompt do modelo, então não existe versão "de dentro"
   diferente da versão "de fora".

   Também cuida do teto de tentativas de feedback: o feedback automático é para
   iterar, não para adivinhar por força bruta.
   ========================================================================== */

import { el, limpar, esc } from "./ui.js";

/**
 * Painel dobrável com os critérios. `abertoPorPadrao` deixa a rubrica aberta em
 * projetos em que ela é o próprio enunciado do que se espera.
 */
export function painelRubrica(rubrica, { abertoPorPadrao = false, mostrarInstrucoes = true } = {}) {
  const corpo = el("div", { style: abertoPorPadrao ? "" : "display:none" });

  for (const c of rubrica.criterios) {
    corpo.append(
      el("div.criterio-rubrica", {}, [
        el("div.cabeca", {}, [el("strong", { texto: c.nome })]),
        el("div", { texto: c.descricao }),
        c.niveis
          ? el("details", {}, [
              el("summary.miudo", { texto: "níveis de avaliação" }),
              el(
                "ul.miudo",
                {},
                Object.entries(c.niveis).map(([nivel, texto]) =>
                  el("li", { html: `<strong>${esc(nivel)}:</strong> ${esc(texto)}` })
                )
              ),
            ])
          : null,
        c.penalizar
          ? el("div.miudo", { html: `<strong>Perde ponto:</strong> ${esc(c.penalizar)}` })
          : null,
      ])
    );
  }

  const botao = el("button.secundario", {
    type: "button",
    texto: abertoPorPadrao ? "esconder a rubrica" : "ver a rubrica da avaliação",
    onclick: () => {
      const escondido = corpo.style.display === "none";
      corpo.style.display = escondido ? "" : "none";
      botao.textContent = escondido ? "esconder a rubrica" : "ver a rubrica da avaliação";
    },
  });

  const escala = rubrica.escala
    ? el("p.miudo", {
        style: "margin:.4rem 0 0",
        texto:
          `Cada critério recebe um de três níveis: ${Object.values(rubrica.escala).join(" · ")}.`,
      })
    : null;

  return el("div.caixa-rubrica", {}, [
    el("div.fileira", {}, [
      el("span.rotulo", { style: "margin:0", texto: "como este trabalho vai ser avaliado" }),
      botao,
    ]),
    escala,
    // As instruções são escritas para o modelo, não para o aluno: em rubrica
    // longa elas viram um parágrafo de jargão logo abaixo do botão. Quem não
    // quiser exibi-las passa `mostrarInstrucoes: false`; o texto continua indo
    // para o prompt, porque quem o monta é `rubricaEmTexto`, em llm.js.
    mostrarInstrucoes && rubrica.instrucoes
      ? el("p.miudo", { style: "margin:.4rem 0 0", texto: rubrica.instrucoes })
      : null,
    corpo,
  ]);
}

/**
 * Controle do teto de tentativas de feedback.
 *
 * Sem `chave`, o teto vale so para esta visita: recarregar a pagina zera a
 * conta. Isso basta enquanto o trabalho tem prazo, porque quem recarrega para
 * ganhar avaliacoes perde o que ja tinha montado.
 *
 * Passado o prazo o exercicio vira material de estudo, e ai um contador que
 * morre no recarregamento nao limita coisa nenhuma: cada avaliacao e uma
 * chamada paga ao modelo, e a pagina fica aberta por tempo indeterminado. Com
 * `chave`, a conta fica guardada no navegador e volta a zero a cada dia, o que
 * mantem o exercicio util para estudar sem deixar a conta correr solta.
 */
export function contadorTentativas(maximo = 3, { chave = null } = {}) {
  const hoje = () => new Date().toISOString().slice(0, 10);

  const ler = () => {
    if (!chave) return 0;
    try {
      const g = JSON.parse(localStorage.getItem(chave) || "{}");
      return g.dia === hoje() ? Number(g.usadas) || 0 : 0;
    } catch {
      return 0;
    }
  };

  const gravar = () => {
    if (!chave) return;
    try {
      localStorage.setItem(chave, JSON.stringify({ dia: hoje(), usadas }));
    } catch {
      // navegador sem armazenamento: o teto vale so para esta visita
    }
  };

  let usadas = ler();
  return {
    get porDia() {
      return Boolean(chave);
    },
    get usadas() {
      return usadas;
    },
    get restantes() {
      return Math.max(0, maximo - usadas);
    },
    get maximo() {
      return maximo;
    },
    get esgotou() {
      return usadas >= maximo;
    },
    usar() {
      usadas += 1;
      gravar();
    },
    texto() {
      const fim = chave ? " usadas hoje" : " usadas";
      return `${usadas} de ${maximo} avaliações${fim}`;
    },
    /** Atualiza uma etiqueta e o botão, e devolve true se ainda pode pedir. */
    aplicar(etiqueta, botao) {
      if (etiqueta) {
        etiqueta.textContent = this.texto();
        etiqueta.className = `etiqueta${this.esgotou ? " alerta" : ""}`;
      }
      if (botao) {
        botao.disabled = this.esgotou;
        if (this.esgotou) botao.title = "Você usou as avaliações disponíveis.";
      }
      return !this.esgotou;
    },
  };
}

export function avisoTentativasEsgotadas(maximo, { porDia = false } = {}) {
  return el("div.aviso.atencao", {}, [
    el("strong", {
      texto: porDia
        ? `Você usou as ${maximo} avaliações de hoje`
        : `Você usou as ${maximo} avaliações automáticas`,
    }),
    el("span", {
      texto: porDia
        ? "O teto volta a zero amanhã. Ele existe porque cada avaliação é uma chamada ao " +
          "modelo, e a página fica aberta o semestre inteiro. Enquanto isso, releia a rubrica " +
          "e o último feedback: quase sempre o que falta já está escrito ali."
        : "O teto existe para o feedback servir de conversa, e não de tentativa e erro até " +
          "acertar. Daqui para frente, revise com o grupo e chame o professor: é para isso que " +
          "ele está na sala. Você ainda pode fechar e entregar o trabalho.",
    }),
  ]);
}

/** Renderiza o feedback do modelo, com o nome do critério vindo da rubrica. */
export function painelFeedback({ feedback, rubrica, iteracao, criterioDaRubrica }) {
  const CORES = { insuficiente: "erro", abaixo_do_esperado: "alerta", esperado: "ok" };
  const ROTULOS = {
    insuficiente: "insuficiente",
    abaixo_do_esperado: "abaixo do esperado",
    esperado: "esperado",
  };
  const caixa = el("div.feedback");
  caixa.append(
    el("h4", { texto: `Feedback ${iteracao}` }),
    el("p", { texto: feedback.resumo || "" })
  );
  for (const c of feedback.criterios || []) {
    const meta = criterioDaRubrica(rubrica, c.id);
    caixa.append(
      el("div.criterio", {}, [
        el("div.cabeca", {}, [
          el("strong", { texto: meta?.nome || c.id }),
          el(`span.etiqueta.${CORES[c.nivel] || ""}`, { texto: ROTULOS[c.nivel] || c.nivel }),
        ]),
        el("div", { texto: c.comentario || "" }),
        c.evidencia
          ? el("div.miudo", { html: `<strong>No que você escreveu:</strong> ${esc(c.evidencia)}` })
          : null,
        c.sugestao ? el("div.miudo", { html: `<strong>Para pensar:</strong> ${esc(c.sugestao)}` }) : null,
      ])
    );
  }
  if (feedback.pontos_fortes?.length) {
    caixa.append(
      el("hr.regua"),
      el("div", {}, [
        el("span.rotulo", { texto: "o que já está bom" }),
        el("ul", {}, feedback.pontos_fortes.map((p) => el("li", { texto: p }))),
      ])
    );
  }
  if (feedback.proximo_passo) {
    caixa.append(
      el("hr.regua"),
      el("div.aviso.atencao", {}, [
        el("strong", { texto: "Próximo passo" }),
        el("span", { texto: feedback.proximo_passo }),
      ])
    );
  }
  caixa.append(
    el("p.miudo", {
      texto:
        "Não concorda? Chame o professor. Este feedback é um monitor automático, não é a nota, " +
        "e defender a sua escolha com um bom motivo faz parte do projeto.",
    })
  );
  return caixa;
}

/** Helper para trocar o conteúdo de um painel. */
export function mostrar(alvo, ...nós) {
  return limpar(alvo).append(...nós.filter(Boolean));
}
