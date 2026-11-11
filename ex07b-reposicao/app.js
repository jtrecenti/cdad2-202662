/* ==========================================================================
   Projeto 7 (reposição) - Provinha de machine learning, online.

   Para as duas alunas que não fizeram a prova em papel de 10/11. Mesmos
   conteúdos e níveis, casos novos, e as mesmas proteções do app do projeto 7,
   com uma a mais: aqui nem os enunciados ficam no site. O Worker só entrega as
   questões a quem tem a senha da reposição (POST /ex07b/questoes), registra a
   hora em que elas saíram e corrige no servidor (POST /ex07b/avaliar).

   - a ordem das alternativas é embaralhada por aluno, a partir do e-mail;
   - 53 minutos, como na sala, contados do clique em "Começar";
   - tela cheia, colar e copiar bloqueados, foco monitorado.
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import { ativar } from "../_shared/guardrails.js";
import { exigirIdentificacao } from "../_shared/identidade.js";
import { SESSAO } from "../_shared/firebase.js";
import {
  $, $$, el, limpar, aviso, toast, montarTopo, embaralharCom, paragrafos, formatar,
  modal, tabela,
} from "../_shared/ui.js";

const EXERCICIO = "ex07b";

const estado = {
  identidade: null,
  guarda: null,
  senha: "",
  prova: null,
  questoes: [],       // alternativas já embaralhadas
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
    aula: "reposição",
    titulo: "Provinha de machine learning",
  });

  estado.identidade = await exigirIdentificacao({
    exercicio: EXERCICIO,
    emGrupo: false,
    titulo: "Projeto 7 (reposição) · quem está fazendo",
    explicacao:
      "Provinha individual, sem consulta e sem IA, em tela cheia. Use o seu e-mail institucional: " +
      "a senha que o professor mandou só vale para ele.",
  });
  estado.guarda = ativar({
    exercicio: EXERCICIO,
    colar: false,
    copiar: false,
    telaCheia: true,
  });

  $("#b-comecar").addEventListener("click", comecar);
  $("#senha").addEventListener("keydown", (e) => {
    if (e.key === "Enter") comecar();
  });
  $("#b-entregar").addEventListener("click", () => entregar(false));
  $("#b-entregar-fim").addEventListener("click", () => entregar(false));
  window.addEventListener("beforeunload", (e) => {
    if (estado.inicio && !estado.entregue) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

/* ---------- busca das questões e montagem ------------------------------ */

async function comecar() {
  const status = $("#status-inicio");
  const botao = $("#b-comecar");
  estado.senha = $("#senha").value.trim();
  if (!estado.senha) {
    status.replaceChildren(el("span.etiqueta.erro", { texto: "digite a senha" }));
    return;
  }
  botao.disabled = true;
  status.replaceChildren(el("span.carregando", { texto: "buscando as questões" }));
  try {
    const resposta = await fetch(`${CONFIG.proxy}/ex07b/questoes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: estado.identidade.email,
        senha: estado.senha,
        turma: CONFIG.turma,
        sessao: SESSAO,
      }),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(dados?.erro || `servidor respondeu ${resposta.status}`);
    estado.prova = dados;
  } catch (erro) {
    botao.disabled = false;
    status.replaceChildren(el("span.etiqueta.erro", { texto: String(erro.message || erro) }));
    return;
  }

  const semente = `${CONFIG.turma}|${estado.prova.id}|${estado.identidade.email}`;
  estado.questoes = estado.prova.questoes.map((q) => ({
    ...q,
    alternativas: embaralharCom(`${semente}|${q.id}`, q.alternativas),
  }));
  estado.limiteMs = estado.prova.minutos * 60 * 1000;
  estado.inicio = Date.now();
  estado.guarda.marco("ex07b_inicio", `${estado.questoes.length} questões`);

  $("#senha").disabled = true;
  status.replaceChildren();
  $("#s-instrucoes").classList.add("concluida");
  $("#s-questoes").classList.remove("travada", "oculto");
  $("#barra-progresso").classList.remove("oculto");
  desenharQuestoes();
  estado.temporizador = setInterval(tique, 500);
  tique();
}

/** Tabela de uma questão: `{cabecalho: [...], linhas: [[...], ...]}`. */
function desenharTabela(t) {
  const linhas = t.linhas.map((l) => Object.fromEntries(t.cabecalho.map((c, i) => [c, l[i]])));
  return tabela(t.cabecalho, linhas, { numericas: t.cabecalho.slice(1) });
}

/**
 * Árvore de profundidade 3, completa, no desenho da prova em papel: cada nó
 * com a pergunta, o n e a proporção; as folhas só com os números; "sim" à
 * esquerda e "não" à direita.
 */
function desenharArvore(raiz) {
  const NS = "http://www.w3.org/2000/svg";
  const L = 920;
  const ALTO = 46;
  const Y = [8, 118, 228, 338];
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${L} ${Y[3] + ALTO + 8}`);
  svg.setAttribute("class", "arvore");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Árvore de decisão da questão");
  const no = (tag, attrs, texto) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (texto != null) n.textContent = texto;
    svg.append(n);
    return n;
  };
  const caixas = [];
  const arestas = [];
  (function percorrer(n, nivel, x, largura) {
    const folha = !n.sim;
    caixas.push({ n, nivel, x, folha });
    if (folha) return;
    const filhos = [[n.sim, x - largura / 4, "sim"], [n.nao, x + largura / 4, "não"]];
    for (const [f, xf, rotulo] of filhos) {
      arestas.push({ x1: x, y1: Y[nivel] + ALTO, x2: xf, y2: Y[nivel + 1], rotulo });
      percorrer(f, nivel + 1, xf, largura / 2);
    }
  })(raiz, 0, L / 2, L);

  for (const a of arestas) {
    no("line", { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, class: "aresta" });
    const mx = (a.x1 + a.x2) / 2;
    const my = (a.y1 + a.y2) / 2;
    no("rect", { x: mx - 16, y: my - 9, width: 32, height: 16, rx: 3, class: "fundo-rotulo" });
    no("text", { x: mx, y: my + 3, "text-anchor": "middle", class: "rotulo-aresta" }, a.rotulo);
  }
  const larguras = [300, 250, 214, 104];
  for (const c of caixas) {
    const w = larguras[c.nivel];
    const y = Y[c.nivel];
    no("rect", { x: c.x - w / 2, y, width: w, height: ALTO, rx: 4, class: c.folha ? "folha" : "no" });
    if (c.folha) {
      no("text", { x: c.x, y: y + 19, "text-anchor": "middle" }, `n = ${c.n.n}`);
      no("text", { x: c.x, y: y + 36, "text-anchor": "middle", class: "forte" }, c.n.p);
    } else {
      no("text", { x: c.x, y: y + 19, "text-anchor": "middle", class: "forte" }, c.n.texto);
      no("text", { x: c.x, y: y + 36, "text-anchor": "middle" }, `n = ${c.n.n} · ${c.n.p}`);
    }
  }
  return el("div.figura", {}, [svg]);
}

/** Enunciado com figura: o texto até a primeira linha em branco vem antes dela. */
function desenharEnunciado(q) {
  const [antes, ...depois] = String(q.enunciado).split("\n\n");
  const partes = [el("div.enunciado", { html: paragrafos(antes) })];
  if (q.tabela) partes.push(desenharTabela(q.tabela));
  if (q.arvore) partes.push(desenharArvore(q.arvore));
  if (depois.length) partes.push(el("div.enunciado", { html: paragrafos(depois.join("\n\n")) }));
  return partes;
}

function desenharQuestoes() {
  const alvo = limpar($("#questoes"));
  estado.questoes.forEach((q, indice) => {
    const caixa = el("div.questao", { id: `q-${q.id}` });
    caixa.append(
      el("div.cabeca", {}, [el("span.numero", { texto: `Questão ${indice + 1} · 2,0 pontos` })]),
      ...desenharEnunciado(q)
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
  relogio.classList.toggle("pouco", restante < 5 * 60000);
  $("#barra-tempo").style.width = `${(1 - restante / estado.limiteMs) * 100}%`;
}

/* ---------- entrega e correção no servidor ------------------------------ */

/** Tabela com a letra marcada em cada questão, antes da entrega irreversível. */
function confirmarEntrega() {
  return new Promise((resolve) => {
    const linhas = estado.questoes.map((q, indice) => {
      const escolhida = estado.respostas[q.id];
      const posicao = q.alternativas.findIndex((a) => a.id === escolhida);
      return {
        questão: String(indice + 1),
        "sua resposta": posicao >= 0 ? LETRAS[posicao] : "em branco",
        tema: q.tema,
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
        tabela(["questão", "sua resposta", "tema"], linhas),
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
    const resposta = await fetch(`${CONFIG.proxy}/ex07b/avaliar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: estado.identidade.email,
        senha: estado.senha,
        turma: CONFIG.turma,
        respostas: estado.respostas,
        sessao: SESSAO,
        segundos_gastos: segundos,
        inicio_servidor: estado.prova.inicio_servidor,
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
        `${erro.message || erro}\n\nSuas respostas continuam na tela. Tire um print desta tela e ` +
          "mande ao professor antes de fechar a aba."
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
      ]),
      el("div.ficha", {}, [
        el("span.rotulo", { texto: "nota" }),
        el("div.numerao", { texto: formatar(dados.nota, 0) }),
        el("div.miudo", { texto: "2 pontos por questão" }),
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
          "O servidor corrigiu mas não conseguiu gravar. Tire um print desta tela e mande ao professor."
        )
  );

  const comentado = limpar($("#gabarito-comentado"));
  if (!dados.gabarito_liberado) {
    const quando = new Date(dados.gabarito_em).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    comentado.append(
      aviso(
        "atencao",
        "O gabarito comentado abre depois",
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
    const situacao = info.acertou ? ["ok", "acertou"] : info.meio_certo ? ["atencao", "meio certo"] : ["erro", "errou"];
    const caixa = el("div.questao");
    caixa.append(
      el("div.cabeca", {}, [
        el("span.numero", { texto: `Questão ${indice + 1}` }),
        el(`span.etiqueta.${situacao[0]}`, { texto: situacao[1] }),
      ]),
      ...desenharEnunciado(q)
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
      // a explicação cita as alternativas como [a], [b]...: cada aluno as viu
      // numa ordem, então a letra certa é a da tela dele
      const letraDe = Object.fromEntries(q.alternativas.map((a, i) => [a.id, LETRAS[i]]));
      const texto = info.explicacao.replace(/\[([a-e])\]/g, (_, id) => letraDe[id] || id);
      caixa.append(el("div.explicacao", { html: paragrafos(texto) }));
    }
    comentado.append(caixa);
  });
}

iniciar().catch((erro) => {
  document.body.prepend(aviso("erro", "Erro ao iniciar", String(erro.message || erro)));
});
