/* ==========================================================================
   Projeto 7 (aula 27) - Provinha de machine learning.

   Avaliação protegida em app estático tem um problema óbvio: se a resposta
   certa vier no JSON que o navegador baixa, não há prova. Aqui:

   - o arquivo público (dados/questoes.json) tem enunciados e alternativas, sem
     nenhuma marca de qual é a correta;
   - o gabarito fica no Worker, e a correção acontece lá (POST /ex07/avaliar),
     que também grava a submissão marcada como origem "worker";
   - a ordem das questões e das alternativas é embaralhada por aluno, de forma
     determinística a partir do e-mail (mesmo aluno, mesma ordem se recarregar);
   - tempo cronometrado, colar bloqueado, foco monitorado.
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import { ativar } from "../_shared/guardrails.js";
import { exigirIdentificacao } from "../_shared/identidade.js";
import { exigirLiberacao } from "../_shared/liberacao.js";
import { SESSAO } from "../_shared/firebase.js";
import {
  $, $$, el, limpar, aviso, toast, montarTopo, embaralharCom, paragrafos, formatar, pct,
  modal, tabela,
} from "../_shared/ui.js";

const EXERCICIO = "ex07";

const estado = {
  identidade: null,
  guarda: null,
  prova: null,
  questoes: [],       // já embaralhadas, com alternativas embaralhadas
  respostas: {},
  inicio: null,
  limiteMs: 0,
  temporizador: null,
  entregue: false,
};

const LETRAS = ["A", "B", "C", "D", "E"];

/* ---------- arranque ---------------------------------------------------- */

async function iniciar() {
  montarTopo({
    exercicio: "Projeto 7",
    aula: "aula 27",
    titulo: "Provinha de machine learning",
  });

  const liberacao = await exigirLiberacao(EXERCICIO);
  if (!liberacao.liberado) return;

  estado.identidade = await exigirIdentificacao({
    exercicio: EXERCICIO,
    emGrupo: false,
    titulo: "Projeto 7 · quem está fazendo",
    explicacao:
      "Provinha individual, sem consulta e sem IA, em tela cheia. O seu e-mail define a ordem " +
      "das questões, então cada aluno recebe a prova em uma ordem diferente.",
  });
  // Tela cheia aqui se justifica: é a única avaliação individual com nota fechada.
  estado.guarda = ativar({
    exercicio: EXERCICIO,
    colar: false,
    copiar: false,
    telaCheia: true,
  });

  estado.prova = await fetch("dados/questoes.json").then((r) => r.json());
  estado.limiteMs = estado.prova.minutos * 60 * 1000;
  $("#info-prova").textContent =
    `${estado.prova.n_questoes} questões · ${estado.prova.minutos} minutos`;
  limpar($("#instrucoes")).append(el("p.enunciado", { html: paragrafos(estado.prova.instrucoes) }));

  $("#b-comecar").addEventListener("click", comecar);
  $("#b-entregar").addEventListener("click", () => entregar(false));
  $("#b-entregar-fim").addEventListener("click", () => entregar(false));
  window.addEventListener("beforeunload", (e) => {
    if (estado.inicio && !estado.entregue) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

/* ---------- montagem da prova ------------------------------------------ */

function comecar() {
  const semente = `${CONFIG.turma}|${estado.prova.id}|${estado.identidade.email}`;
  estado.questoes = embaralharCom(semente, estado.prova.questoes).map((q) => ({
    ...q,
    alternativas: embaralharCom(`${semente}|${q.id}`, q.alternativas),
  }));
  estado.inicio = Date.now();
  estado.guarda.marco("ex07_inicio", `${estado.questoes.length} questões`);

  $("#s-instrucoes").classList.add("concluida");
  $("#s-questoes").classList.remove("travada", "oculto");
  $("#barra-progresso").classList.remove("oculto");
  $("#b-comecar").disabled = true;
  desenharQuestoes();
  estado.temporizador = setInterval(tique, 500);
  tique();
}

function desenharQuestoes() {
  const alvo = limpar($("#questoes"));
  estado.questoes.forEach((q, indice) => {
    const caixa = el("div.questao", { id: `q-${q.id}` });
    caixa.append(
      el("div.cabeca", {}, [
        el("span.numero", { texto: `${indice + 1}.` }),
        el("span.enunciado", { texto: q.enunciado }),
      ])
    );
    q.alternativas.forEach((a, i) => {
      const rotulo = el("label.alternativa", { for: `alt-${q.id}-${a.id}` }, [
        el("input", {
          type: "radio",
          name: `q-${q.id}`,
          id: `alt-${q.id}-${a.id}`,
          value: a.id,
        }),
        el("span.letra", { texto: LETRAS[i] }),
        a.texto,
      ]);
      rotulo.addEventListener("change", () => {
        estado.respostas[q.id] = a.id;
        $$(`#q-${q.id} .alternativa`).forEach((n) => n.classList.remove("marcada"));
        rotulo.classList.add("marcada");
        caixa.classList.add("respondida");
        atualizarProgresso();
      });
      caixa.append(rotulo);
    });
    alvo.append(caixa);
  });
  atualizarProgresso();
}

function atualizarProgresso() {
  const n = Object.keys(estado.respostas).length;
  $("#progresso-respostas").textContent = `${n} de ${estado.questoes.length} respondidas`;
}

/* ---------- cronômetro -------------------------------------------------- */

function tique() {
  const restante = estado.limiteMs - (Date.now() - estado.inicio);
  const relogio = $("#cronometro");
  if (restante <= 0) {
    relogio.textContent = "00:00";
    $("#barra-tempo").style.width = "100%";
    clearInterval(estado.temporizador);
    toast("Tempo esgotado. Entregando o que está respondido.");
    entregar(true);
    return;
  }
  const minutos = Math.floor(restante / 60000);
  const segundos = Math.floor((restante % 60000) / 1000);
  relogio.textContent = `${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;
  relogio.classList.toggle("pouco", restante < 120000);
  $("#barra-tempo").style.width = `${(1 - restante / estado.limiteMs) * 100}%`;
}

/* ---------- entrega e correção no servidor ------------------------------ */

/**
 * Confere as respostas antes de entregar.
 *
 * A entrega é irreversível e a correção acontece no servidor, então o aluno
 * precisa ver o que está mandando. Uma tabela com as 15 questões e a letra
 * marcada em cada uma resolve mais do que um confirm() com contagem de brancos:
 * dá para achar a questão que ficou em branco e voltar nela.
 */
function confirmarEntrega() {
  return new Promise((resolve) => {
    const linhas = estado.questoes.map((q, indice) => {
      const escolhida = estado.respostas[q.id];
      const posicao = q.alternativas.findIndex((a) => a.id === escolhida);
      return {
        questão: String(indice + 1),
        "sua resposta": posicao >= 0 ? LETRAS[posicao] : "em branco",
        início: `${q.enunciado.slice(0, 70)}${q.enunciado.length > 70 ? "…" : ""}`,
      };
    });
    const brancos = linhas.filter((l) => l["sua resposta"] === "em branco").length;

    let decidido = false;
    const janela = modal({
      titulo: "Conferir antes de entregar",
      conteudo: [
        brancos
          ? aviso(
              "atencao",
              `${brancos} questão(ões) em branco`,
              "Questão em branco conta como errada. Dá para fechar esta janela e voltar nelas."
            )
          : aviso("ok", "Todas as questões respondidas", "Confira as letras antes de entregar."),
        tabela(["questão", "sua resposta", "início"], linhas),
        el("p.miudo", {
          texto: "Depois de entregar não é possível mudar resposta: a correção é feita no servidor.",
        }),
      ],
      acoes: [
        el("button.principal", {
          type: "button",
          texto: "Entregar agora",
          onclick: () => {
            decidido = true;
            janela.fechar();
            resolve(true);
          },
        }),
        el("button.secundario", {
          type: "button",
          texto: "voltar para a prova",
          onclick: () => {
            decidido = true;
            janela.fechar();
            resolve(false);
          },
        }),
      ],
    });
    // fechar no Esc ou no clique fora vale como "voltar para a prova"
    new MutationObserver((_, observador) => {
      if (!document.body.contains(janela.quadro)) {
        observador.disconnect();
        if (!decidido) resolve(false);
      }
    }).observe(document.body, { childList: true });
  });
}

async function entregar(porTempo) {
  if (estado.entregue) return;
  if (!porTempo && !(await confirmarEntrega())) return;
  estado.entregue = true;
  clearInterval(estado.temporizador);
  const status = $("#status-entrega");
  status.replaceChildren(el("span.carregando", { texto: "corrigindo no servidor" }));
  $$("#questoes input").forEach((i) => (i.disabled = true));
  $("#b-entregar").disabled = true;
  $("#b-entregar-fim").disabled = true;

  const segundos = Math.round((Date.now() - estado.inicio) / 1000);
  try {
    const resposta = await fetch(`${CONFIG.proxy}/ex07/avaliar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: estado.identidade.email,
        turma: CONFIG.turma,
        respostas: estado.respostas,
        sessao: SESSAO,
        segundos_gastos: segundos,
        monitoramento: estado.guarda.resumo(),
        por_tempo: porTempo,
      }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados?.erro || `servidor respondeu ${resposta.status}`);
    mostrarResultado(dados, segundos);
    status.replaceChildren(el("span.etiqueta.ok", { texto: "entregue e corrigido" }));
  } catch (erro) {
    status.replaceChildren(el("span.etiqueta.erro", { texto: "falha na correção" }));
    limpar($("#painel-resultado")).append(
      aviso(
        "erro",
        "Não consegui corrigir agora",
        `${erro.message || erro}\n\nSuas respostas continuam na tela. Chame o professor antes de fechar a aba.`
      ),
      el("pre", {}, [el("code", { texto: JSON.stringify(estado.respostas, null, 1) })])
    );
    $("#s-resultado").classList.remove("oculto");
  }
}

function mostrarResultado(dados, segundos) {
  $("#s-resultado").classList.remove("oculto");
  const alvo = limpar($("#painel-resultado"));
  alvo.append(
    el("div.grade.tres", {}, [
      el("div.ficha.destaque", {}, [
        el("span.rotulo", { texto: "acertos" }),
        el("div.numerao", { texto: `${dados.acertos}/${dados.total}` }),
        el("div.miudo", { texto: pct(dados.acertos / dados.total, 0) }),
      ]),
      el("div.ficha", {}, [
        el("span.rotulo", { texto: "nota" }),
        el("div.numerao", { texto: formatar(dados.nota, 1) }),
        el("div.miudo", {
          texto: dados.acertos_para_aprovar
            ? `referência do professor: ${dados.acertos_para_aprovar} acertos`
            : "",
        }),
      ]),
      el("div.ficha", {}, [
        el("span.rotulo", { texto: "tempo" }),
        el("div.numerao", { texto: `${Math.floor(segundos / 60)}min` }),
        el("div.miudo", { texto: `${segundos} segundos` }),
      ]),
    ]),
    dados.registrado
      ? aviso("ok", "Submissão registrada", "A correção foi feita e registrada no servidor.")
      : aviso(
          "atencao",
          "Corrigido, mas não registrado",
          "O servidor corrigiu mas não conseguiu gravar. Avise o professor, mostrando esta tela."
        )
  );

  const comentado = limpar($("#gabarito-comentado"));
  if (!dados.gabarito_liberado) {
    const quando = dados.gabarito_em
      ? new Date(dados.gabarito_em).toLocaleString("pt-BR", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        })
      : "depois da aula";
    comentado.append(
      aviso(
        "atencao",
        "O gabarito comentado abre depois da aula",
        `A sua nota já está aí em cima. As respostas comentadas ficam disponíveis a partir de ` +
          `${quando}: volte a esta página depois desse horário.`
      )
    );
    return;
  }
  comentado.append(el("h3", { texto: "Gabarito comentado" }));
  const porId = Object.fromEntries(dados.por_questao.map((q) => [q.id, q]));
  estado.questoes.forEach((q, indice) => {
    const info = porId[q.id];
    if (!info) return;
    const caixa = el("div.questao");
    caixa.append(
      el("div.cabeca", {}, [
        el("span.numero", { texto: `${indice + 1}.` }),
        el("span.enunciado", { texto: q.enunciado }),
        el(`span.etiqueta.${info.acertou ? "ok" : "erro"}`, {
          texto: info.acertou ? "acertou" : "errou",
        }),
      ])
    );
    q.alternativas.forEach((a, i) => {
      const ehCorreta = a.id === info.correta;
      const marcada = a.id === info.marcada;
      caixa.append(
        el(`div.alternativa${ehCorreta ? ".certa" : marcada ? ".errada" : ""}`, {}, [
          el("span.letra", { texto: LETRAS[i] }),
          a.texto,
          marcada ? el("span.etiqueta", { texto: "sua resposta" }) : null,
        ])
      );
    });
    if (info.explicacao) {
      caixa.append(el("div.explicacao", { html: paragrafos(info.explicacao) }));
    }
    comentado.append(caixa);
  });
}

iniciar().catch((erro) => {
  document.body.prepend(aviso("erro", "Erro ao iniciar", String(erro.message || erro)));
});
