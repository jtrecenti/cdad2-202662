/* ==========================================================================
   Quiz ao vivo · painel do professor

   Esta página faz duas coisas ao mesmo tempo: comanda o quiz e é o que está
   projetado. Por isso a barra de controle é pequena, some com Esc, e o resto
   da tela é conteúdo em corpo grande.

   O que o professor faz, na ordem de uma pergunta:

     abrir   -> a pergunta aparece nos celulares, o QR fica no telão
     fechar  -> ninguém mais vota (útil para quem chegou atrasado não votar
                depois de ouvir a discussão)
     revelar -> as barras e o comentário aparecem aqui E nos celulares

   Voltar atrás é só clicar em "abrir" de novo: o estado é reescrito inteiro a
   cada clique, e não incrementado.
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import { el, $, limpar } from "../_shared/ui.js";

const LETRAS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const INTERVALO_MS = 2000;
const ENDERECO_ALUNO = "jtrecenti.github.io/cdad2-202662/quiz";

const estado = {
  perguntas: [],
  atual: null,
  aberto: false,
  revelado: false,
  resultados: null,
  resultadosItens: null, // num bloco: id do item -> resultados
};

/* ---------- senha e conversa com o Worker -------------------------------- */

/*
 * A senha fica em sessionStorage, e não em localStorage: ela some quando a
 * janela fecha. Numa máquina de sala de aula isso importa.
 */
function senha() {
  return $("#senha").value.trim();
}

function lembrarSenha() {
  try {
    sessionStorage.setItem("cdad2-quiz-senha", senha());
  } catch {
    // sem armazenamento: a senha vale enquanto a aba estiver aberta
  }
}

async function pedir(caminho, opcoes = {}) {
  const r = await fetch(`${CONFIG.proxy}${caminho}`, {
    ...opcoes,
    headers: {
      "Content-Type": "application/json",
      "X-Prof-Token": senha(),
      ...(opcoes.headers || {}),
    },
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `erro ${r.status}`);
  return dados;
}

function recado(texto, ruim = false) {
  const n = $("#recado");
  n.textContent = texto;
  n.className = ruim ? "aviso-senha" : "";
  if (texto && !ruim) setTimeout(() => { if (n.textContent === texto) n.textContent = ""; }, 3000);
}

/* ---------- comandos ------------------------------------------------------ */

async function comandar({ aberto, revelado }) {
  const id = $("#pergunta").value;
  if (!id) return;
  if (!senha()) return recado("falta a senha", true);
  try {
    await pedir("/quiz/estado", {
      method: "POST",
      body: JSON.stringify({ pergunta: id, aberto, revelado }),
    });
    lembrarSenha();
    estado.atual = id;
    estado.aberto = aberto;
    estado.revelado = revelado;
    await atualizar();
  } catch (erro) {
    recado(String(erro.message || erro), true);
  }
}

async function apagarVotos() {
  const id = $("#pergunta").value;
  if (!id) return;
  if (!senha()) return recado("falta a senha", true);
  const p = estado.perguntas.find((x) => x.id === id);
  // Num bloco, os votos moram em cada item, e é lá que se apaga.
  const alvos = p?.tipo === "bloco" ? p.itens : [id];
  try {
    for (const alvo of alvos) {
      await pedir("/quiz/limpar", { method: "POST", body: JSON.stringify({ pergunta: alvo }) });
    }
    recado("votos apagados");
    await atualizar();
  } catch (erro) {
    recado(String(erro.message || erro), true);
  }
}

/* ---------- leitura ------------------------------------------------------- */

async function atualizar() {
  const id = estado.atual;
  if (!id) return;
  const p = estado.perguntas.find((x) => x.id === id);
  if (!p) return;

  if (p.tipo === "bloco") {
    const pares = await Promise.all(
      p.itens.map(async (item) => {
        try {
          const q = new URLSearchParams({ pergunta: item, opcoes: String(p.opcoes.length) });
          return [item, await pedir(`/quiz/resultados?${q}`)];
        } catch {
          return [item, estado.resultadosItens?.[item] || null];
        }
      })
    );
    estado.resultadosItens = Object.fromEntries(pares);
    desenhar();
    return;
  }

  try {
    const q = new URLSearchParams({ pergunta: id, opcoes: String(p.opcoes?.length || 4) });
    estado.resultados = await pedir(`/quiz/resultados?${q}`);
  } catch (erro) {
    // Ficar sem a contagem por um ciclo é irrelevante; o que não pode é a tela
    // projetada piscar um erro no meio da aula.
    if (!estado.resultados) recado(String(erro.message || erro), true);
  }
  desenhar();
}

/* ---------- desenho ------------------------------------------------------- */

function desenhar() {
  const palco = limpar($("#palco"));
  palco.className = `palco${estado.revelado ? " revelado" : ""}`;

  const p = estado.perguntas.find((x) => x.id === estado.atual);
  if (!p) {
    palco.append(el("div.espera", { texto: "Digite a senha e escolha uma pergunta." }));
    return;
  }

  if (p.contexto) palco.append(el("div.contexto", { texto: p.contexto }));
  palco.append(el("h1", { texto: p.enunciado }));

  const total = estado.resultados?.total || 0;

  if (p.tipo === "data") {
    desenharData(palco, total);
    return;
  }

  if (p.tipo === "bloco") {
    desenharBloco(palco, p);
    return;
  }

  const contagem = estado.resultados?.contagem || null;
  const certa = estado.revelado ? estado.resultados?.certa ?? null : null;

  const opcoes = el("div.opcoes");
  p.opcoes.forEach((texto, i) => {
    const n = contagem ? contagem[i] || 0 : 0;
    const frac = total > 0 ? Math.round((n / total) * 100) : 0;
    const linha = el(`div.linha${certa === i ? ".certa" : ""}`, {}, [
      // Antes de revelar, a barra fica em zero: a sala não pode ver o placar.
      el("div.preenche", { style: `width:${estado.revelado ? frac : 0}%` }),
      el("div.conteudo", {}, [
        el("div.letra", { texto: LETRAS[i] }),
        el("div.texto", { texto }),
        estado.revelado ? el("div.n", { texto: `${frac}%` }) : null,
      ]),
    ]);
    opcoes.append(linha);
  });

  const coluna = el("div", {}, [opcoes]);

  if (estado.revelado && estado.resultados?.porque) {
    coluna.append(el("div.comentario", { texto: estado.resultados.porque }));
  }

  const lateral = el("div.lateral", {}, [
    el("img", { src: "qr.svg", alt: "QR code para responder no celular" }),
    el("div.endereco", { texto: ENDERECO_ALUNO }),
    el("div.contador", {}, [
      el("span", { texto: String(total) }),
      el("small", { texto: total === 1 ? "resposta" : "respostas" }),
    ]),
  ]);

  palco.append(el("div.duas", {}, [coluna, lateral]));
}

/* ---------- bloco: várias perguntas na mesma tela ------------------------- */

/*
 * Seis cartões em grade. Antes de revelar, só os enunciados e quantos
 * aparelhos já responderam; depois, as três barras de cada item e o
 * comentário. O contador é o do item mais respondido: quem respondeu só
 * metade ainda conta como alguém na sala.
 */
function desenharBloco(palco, p) {
  const itens = p.itens
    .map((id) => estado.perguntas.find((x) => x.id === id))
    .filter(Boolean);
  const res = estado.resultadosItens || {};
  const total = Math.max(0, ...itens.map((it) => res[it.id]?.total || 0));

  const grade = el("div.grade-bloco");
  itens.forEach((item, k) => {
    const r = res[item.id];
    const n = r?.total || 0;
    const certa = estado.revelado ? r?.certa ?? null : null;
    const cartao = el("div.cartao-bloco", {}, [
      el("div.cartao-titulo", { texto: `${k + 1}. ${item.titulo}` }),
      el("div.cartao-enunciado", { texto: item.enunciado }),
    ]);
    if (estado.revelado) {
      const linhas = el("div.opcoes.compacta");
      p.opcoes.forEach((texto, i) => {
        const frac = n > 0 ? Math.round(((r?.contagem?.[i] || 0) / n) * 100) : 0;
        linhas.append(
          el(`div.linha${certa === i ? ".certa" : ""}`, {}, [
            el("div.preenche", { style: `width:${frac}%` }),
            el("div.conteudo", {}, [
              el("div.texto", { texto }),
              el("div.n", { texto: `${frac}%` }),
            ]),
          ])
        );
      });
      cartao.append(linhas);
      if (r?.porque) cartao.append(el("div.cartao-porque", { texto: r.porque }));
    } else {
      cartao.append(el("div.cartao-n", { texto: `${n} ${n === 1 ? "resposta" : "respostas"}` }));
    }
    grade.append(cartao);
  });

  const lateral = el("div.lateral", {}, [
    el("img", { src: "qr.svg", alt: "QR code para responder no celular" }),
    el("div.endereco", { texto: ENDERECO_ALUNO }),
    el("div.contador", {}, [
      el("span", { texto: String(total) }),
      el("small", { texto: total === 1 ? "aparelho" : "aparelhos" }),
    ]),
  ]);

  palco.append(el("div.duas", {}, [grade, lateral]));
}

/* ---------- perguntas de data (o quiz dos aniversários) ------------------- */

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function porExtenso(data) {
  const [d, m] = String(data).split("-").map(Number);
  // Em português o primeiro dia do mês é ordinal: 1º de janeiro, 2 de janeiro.
  return `${d === 1 ? "1º" : d} de ${MESES[m - 1] || "?"}`;
}

/*
 * A chance de haver pelo menos uma data repetida entre n pessoas. É o
 * complementar de "todas diferentes", que é o produto de (365-k)/365. Com 23
 * pessoas já passa de 50%, e com 30 passa de 70%: é esse número que costuma
 * surpreender a sala depois de ver a lista.
 */
function chanceCoincidencia(n) {
  let todasDiferentes = 1;
  for (let k = 0; k < n; k += 1) todasDiferentes *= (365 - k) / 365;
  return 1 - todasDiferentes;
}

function desenharData(palco, total) {
  const d = estado.revelado ? estado.resultados?.datas : null;
  const coluna = el("div");

  if (!d) {
    coluna.append(
      el("div.espera", {
        texto: estado.revelado
          ? "Ninguém respondeu ainda."
          : estado.aberto
            ? "A turma está respondendo. Feche e revele quando todo mundo tiver mandado."
            : "Clique em revelar para ver as coincidências.",
      })
    );
  } else if (!d.coincidencias.length) {
    coluna.append(
      el("div.comentario", {
        texto:
          `Nenhuma data se repetiu: ${d.total} respostas em ${d.distintas} datas ` +
          `diferentes. Com ${d.total} pessoas, a chance de haver alguma ` +
          `coincidência era de ${(chanceCoincidencia(d.total) * 100).toFixed(0)}%, ` +
          `então este resultado é o menos provável dos dois.`,
      })
    );
  } else {
    const lista = el("div.opcoes");
    d.coincidencias.forEach(({ data, n }) => {
      lista.append(
        el("div.linha.certa", {}, [
          el("div.preenche", { style: "width:100%" }),
          el("div.conteudo", {}, [
            el("div.letra", { texto: String(n) }),
            el("div.texto", { texto: porExtenso(data) }),
            el("div.n", { texto: n === 2 ? "2 pessoas" : `${n} pessoas` }),
          ]),
        ])
      );
    });
    const quantas = d.coincidencias.length;
    coluna.append(
      lista,
      el("div.comentario", {
        texto:
          `${quantas === 1 ? "Uma data repetida" : `${quantas} datas repetidas`} ` +
          `entre ${d.total} respostas. Com ${d.total} pessoas, a chance de haver ` +
          `pelo menos uma coincidência é de ` +
          `${(chanceCoincidencia(d.total) * 100).toFixed(0)}%. ` +
          `Não é sorte: são ${(d.total * (d.total - 1)) / 2} pares de pessoas, ` +
          `e basta um deles bater.`,
      })
    );
  }

  const lateral = el("div.lateral", {}, [
    el("img", { src: "qr.svg", alt: "QR code para responder no celular" }),
    el("div.endereco", { texto: ENDERECO_ALUNO }),
    el("div.contador", {}, [
      el("span", { texto: String(total) }),
      el("small", { texto: total === 1 ? "resposta" : "respostas" }),
    ]),
  ]);

  palco.append(el("div.duas", {}, [coluna, lateral]));
}

/* ---------- início -------------------------------------------------------- */

async function iniciar() {
  const dados = await (await fetch("perguntas.json")).json();
  estado.perguntas = dados.perguntas || [];

  const select = $("#pergunta");
  let aulaAtual = null;
  let grupo = null;
  for (const p of estado.perguntas) {
    if (p.aula !== aulaAtual) {
      aulaAtual = p.aula;
      grupo = el("optgroup", { label: typeof p.aula === "number" ? `Aula ${p.aula}` : p.aula });
      select.append(grupo);
    }
    grupo.append(el("option", { value: p.id, texto: `${p.id} · ${p.titulo}` }));
  }

  try {
    $("#senha").value = sessionStorage.getItem("cdad2-quiz-senha") || "";
  } catch {
    // sem armazenamento: o professor digita a senha
  }

  $("#b-abrir").addEventListener("click", () => comandar({ aberto: true, revelado: false }));
  $("#b-fechar").addEventListener("click", () => comandar({ aberto: false, revelado: false }));
  $("#b-revelar").addEventListener("click", () => comandar({ aberto: false, revelado: true }));
  $("#b-limpar").addEventListener("click", apagarVotos);

  const botaoTema = $("#b-tema");
  botaoTema.addEventListener("click", () => {
    const escuro = document.documentElement.getAttribute("data-tema") === "escuro";
    if (escuro) document.documentElement.removeAttribute("data-tema");
    else document.documentElement.setAttribute("data-tema", "escuro");
    botaoTema.textContent = escuro ? "escuro" : "claro";
  });

  // Esc esconde a barra de controle: na hora de projetar, ela não interessa.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("#controle").classList.toggle("recolhida");
  });

  // Retoma o que já estava aberto, para reabrir o painel no meio da aula sem
  // perder o que a sala está vendo.
  try {
    const { estado: e } = await (await fetch(`${CONFIG.proxy}/quiz/estado`)).json();
    if (e?.pergunta) {
      estado.atual = e.pergunta;
      estado.aberto = Boolean(e.aberto);
      estado.revelado = Boolean(e.revelado);
      select.value = e.pergunta;
    }
  } catch {
    // sem rede ainda: o professor escolhe a pergunta na mão
  }

  select.addEventListener("change", () => {
    estado.atual = select.value;
    estado.resultados = null;
    estado.resultadosItens = null;
    estado.aberto = false;
    estado.revelado = false;
    desenhar();
  });

  desenhar();
  await atualizar();
  setInterval(atualizar, INTERVALO_MS);
}

iniciar();
