/* ==========================================================================
   Quiz ao vivo · tela do aluno

   O celular não decide nada: ele pergunta ao Worker o que está aberto e
   desenha. Quem manda na pergunta, na abertura e na revelação é o painel do
   professor. Isso mantém a sala inteira na mesma tela sem precisar recarregar.

   A resposta certa NÃO está neste arquivo nem em perguntas.json: ela só desce
   quando o professor revela.
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import { el, $, limpar, esc } from "../_shared/ui.js";

const LETRAS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const INTERVALO_MS = 2500;

/*
 * O identificador do aparelho. Não é login: serve só para o segundo toque
 * substituir o primeiro em vez de virar dois votos. Fica no navegador, então
 * a mesma pessoa continua sendo a mesma pessoa da pergunta 1 até a última.
 */
function identificador() {
  const CHAVE = "cdad2-quiz-aparelho";
  try {
    let v = localStorage.getItem(CHAVE);
    if (!v) {
      v = crypto.randomUUID().slice(0, 12);
      localStorage.setItem(CHAVE, v);
    }
    return v;
  } catch {
    // Navegação privada: o id vale só enquanto a página estiver aberta. O voto
    // ainda conta; ele é que não sobrevive a um recarregamento.
    return crypto.randomUUID().slice(0, 12);
  }
}

const estado = {
  aparelho: identificador(),
  perguntas: [],
  atual: null, // id da pergunta aberta
  versao: null, // muda quando o professor mexe em algo
  escolha: null, // índice que ESTE aparelho votou
  data: null, // data que ESTE aparelho mandou, nas perguntas de data
  escolhas: {}, // num bloco: id do item -> índice que ESTE aparelho votou
  itens: null, // num bloco revelado: id do item -> { certa, porque }
  resultadosItens: null, // num bloco revelado: id do item -> contagem
  aberto: false,
  revelado: false,
  certa: null,
  porque: "",
  resultados: null,
  falhas: 0,
};

/* ---------- conversa com o Worker ---------------------------------------- */

async function pedir(caminho, opcoes = {}) {
  const r = await fetch(`${CONFIG.proxy}${caminho}`, {
    ...opcoes,
    headers: { "Content-Type": "application/json", ...(opcoes.headers || {}) },
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `erro ${r.status}`);
  return dados;
}

function conexao(texto, ruim = false) {
  const n = $("#estado-conexao");
  if (n) {
    n.textContent = texto;
    n.style.color = ruim ? "var(--marca)" : "var(--fraco)";
  }
}

/* ---------- ciclo de leitura --------------------------------------------- */

async function sincronizar() {
  let dados;
  try {
    dados = await pedir("/quiz/estado");
    estado.falhas = 0;
    conexao("ao vivo");
  } catch {
    estado.falhas += 1;
    // Uma falha isolada é sinal de wi-fi de sala cheia, não de erro: só depois
    // de três seguidas vale assustar quem está olhando.
    if (estado.falhas >= 3) conexao("sem conexão", true);
    return;
  }

  const e = dados.estado || {};
  const mudouPergunta = e.pergunta !== estado.atual;

  if (mudouPergunta) {
    estado.atual = e.pergunta || null;
    estado.escolha = null;
    estado.data = null;
    estado.escolhas = {};
    estado.resultados = null;
    estado.resultadosItens = null;
  }

  estado.aberto = Boolean(e.aberto);
  estado.revelado = Boolean(e.revelado);
  estado.certa = dados.certa ?? null;
  estado.porque = dados.porque || "";
  estado.itens = dados.itens || null;

  // A distribuição só existe depois de revelada, e é o Worker que garante isso.
  // Num bloco, cada item tem a sua contagem.
  const pb = perguntaAtual();
  if (estado.revelado && pb?.tipo === "bloco") {
    const pares = await Promise.all(
      pb.itens.map(async (id) => {
        try {
          const q = new URLSearchParams({ pergunta: id, opcoes: String(pb.opcoes.length) });
          return [id, await pedir(`/quiz/resultados?${q}`)];
        } catch {
          return [id, null];
        }
      })
    );
    estado.resultadosItens = Object.fromEntries(pares);
  } else if (estado.revelado && estado.atual) {
    try {
      const p = perguntaAtual();
      const q = new URLSearchParams({
        pergunta: estado.atual,
        opcoes: String(p?.opcoes?.length || 4),
      });
      estado.resultados = await pedir(`/quiz/resultados?${q}`);
    } catch {
      estado.resultados = null;
    }
  }

  if (mudouPergunta || e.versao !== estado.versao || estado.revelado) {
    estado.versao = e.versao;
    desenhar();
  }
}

async function votar(i) {
  if (!estado.aberto || !estado.atual) return;
  const anterior = estado.escolha;
  estado.escolha = i; // resposta imediata ao toque; o servidor confirma depois
  desenhar();
  try {
    await pedir("/quiz/responder", {
      method: "POST",
      body: JSON.stringify({
        pergunta: estado.atual,
        opcao: i,
        quem: estado.aparelho,
      }),
    });
  } catch (erro) {
    estado.escolha = anterior;
    desenhar();
    mostrarErro(String(erro.message || erro));
  }
}

async function votarItem(id, i) {
  if (!estado.aberto || !estado.atual) return;
  const anterior = estado.escolhas[id];
  estado.escolhas = { ...estado.escolhas, [id]: i };
  desenhar();
  try {
    await pedir("/quiz/responder", {
      method: "POST",
      body: JSON.stringify({ pergunta: id, opcao: i, quem: estado.aparelho }),
    });
  } catch (erro) {
    const volta = { ...estado.escolhas };
    if (anterior === undefined) delete volta[id];
    else volta[id] = anterior;
    estado.escolhas = volta;
    desenhar();
    mostrarErro(String(erro.message || erro));
  }
}

function mostrarErro(texto) {
  const p = el("div.painel.aviso", {}, [
    el("b", { texto: "O voto não foi registrado" }),
    el("span", { texto }),
  ]);
  $("#tela").prepend(p);
  setTimeout(() => p.remove(), 4000);
}

/* ---------- desenho ------------------------------------------------------ */

function perguntaAtual() {
  return estado.perguntas.find((p) => p.id === estado.atual) || null;
}

function esperando(texto) {
  return el("div.espera", {}, [el("div.ponto"), el("div", { texto })]);
}

function desenhar() {
  const tela = limpar($("#tela"));

  if (!estado.atual) {
    tela.append(esperando("Esperando o professor abrir uma pergunta."));
    return;
  }

  const p = perguntaAtual();
  if (!p) {
    tela.append(
      esperando(
        "O professor abriu uma pergunta que esta página não conhece. " +
          "Recarregue a página."
      )
    );
    return;
  }

  if (p.contexto) tela.append(el("div.contexto", { texto: p.contexto }));
  tela.append(el("h1", { texto: p.enunciado }));

  if (p.tipo === "data") {
    desenharData(tela);
    return;
  }

  if (p.tipo === "bloco") {
    desenharBloco(tela, p);
    return;
  }

  const total = estado.resultados?.total || 0;
  const contagem = estado.resultados?.contagem || null;

  const opcoes = el("div.opcoes");
  p.opcoes.forEach((texto, i) => {
    const classes = [];
    if (estado.escolha === i) classes.push("escolhida");
    if (estado.revelado && estado.certa === i) classes.push("certa");
    if (estado.revelado && estado.escolha === i && estado.certa !== i) {
      classes.push("errada");
    }

    const filhos = [
      el("span.letra", { texto: LETRAS[i] }),
      el("span", {}, [el("span", { texto })]),
    ];

    const b = el(`button.opcao${classes.map((c) => `.${c}`).join("")}`, {
      type: "button",
      disabled: !estado.aberto,
    }, filhos);

    if (contagem && total > 0) {
      const n = contagem[i] || 0;
      const frac = Math.round((n / total) * 100);
      const corpo = b.lastElementChild;
      corpo.append(
        el("div.barra", {}, [el("i", { style: `width:${frac}%` })]),
        el("div.votos", { texto: `${n} de ${total} (${frac}%)` })
      );
    }

    if (estado.aberto) b.addEventListener("click", () => votar(i));
    opcoes.append(b);
  });
  tela.append(opcoes);

  if (!estado.aberto && !estado.revelado) {
    tela.append(
      el("div.painel", {}, [
        el("b", { texto: "Votação encerrada" }),
        el("span", { texto: "Olhe para o telão: o resultado vem aí." }),
      ])
    );
  } else if (estado.aberto && estado.escolha === null) {
    tela.append(
      el("div.painel", {}, [
        el("b", { texto: "Toque na sua resposta" }),
        el("span", { texto: "Dá para trocar enquanto a votação estiver aberta." }),
      ])
    );
  } else if (estado.aberto) {
    tela.append(
      el("div.painel.ok", {}, [
        el("b", { texto: `Resposta ${LETRAS[estado.escolha]} registrada` }),
        el("span", { texto: "Se mudar de ideia, é só tocar em outra." }),
      ])
    );
  }

  if (estado.revelado && estado.porque) {
    tela.append(
      el("div.painel.ok", {}, [
        el("b", {
          texto:
            estado.certa === null
              ? "Comentário"
              : `Resposta: ${LETRAS[estado.certa]}`,
        }),
        el("span", { texto: estado.porque }),
      ])
    );
  }
}

/* ---------- bloco: várias perguntas na mesma tela ------------------------- */

/*
 * Cada item é uma pergunta comum (cl1, cl2...), com voto, gabarito e contagem
 * próprios. O bloco só muda o desenho: as opções viram uma fileira de botões
 * curtos embaixo de cada enunciado, para caberem seis perguntas na rolagem.
 */
function desenharBloco(tela, p) {
  const itens = p.itens
    .map((id) => estado.perguntas.find((x) => x.id === id))
    .filter(Boolean);

  itens.forEach((item, k) => {
    const escolha = estado.escolhas[item.id];
    const gab = estado.revelado ? estado.itens?.[item.id] : null;
    const res = estado.revelado ? estado.resultadosItens?.[item.id] : null;
    const total = res?.total || 0;

    const fileira = el("div.fileira");
    p.opcoes.forEach((texto, i) => {
      const classes = [];
      if (escolha === i) classes.push("escolhida");
      if (gab && gab.certa === i) classes.push("certa");
      if (gab && escolha === i && gab.certa !== i) classes.push("errada");
      const filhos = [el("span", { texto })];
      if (res?.contagem && total > 0) {
        const frac = Math.round(((res.contagem[i] || 0) / total) * 100);
        filhos.push(el("span.votos", { texto: `${frac}%` }));
      }
      const b = el(`button.curta${classes.map((c) => `.${c}`).join("")}`, {
        type: "button",
        disabled: !estado.aberto,
      }, filhos);
      if (estado.aberto) b.addEventListener("click", () => votarItem(item.id, i));
      fileira.append(b);
    });

    const cartao = el(`div.item${escolha !== undefined ? ".feito" : ""}`, {}, [
      el("div.item-titulo", { texto: `${k + 1}. ${item.titulo}` }),
      el("div.item-enunciado", { texto: item.enunciado }),
      fileira,
    ]);
    if (gab?.porque) cartao.append(el("div.item-porque", { texto: gab.porque }));
    tela.append(cartao);
  });

  const feitas = itens.filter((it) => estado.escolhas[it.id] !== undefined).length;
  if (estado.aberto) {
    tela.append(
      el(`div.painel${feitas === itens.length ? ".ok" : ""}`, {}, [
        el("b", { texto: `${feitas} de ${itens.length} respondidas` }),
        el("span", { texto: "Dá para trocar qualquer resposta enquanto a votação estiver aberta." }),
      ])
    );
  } else if (!estado.revelado) {
    tela.append(
      el("div.painel", {}, [
        el("b", { texto: "Votação encerrada" }),
        el("span", { texto: "Olhe para o telão: o resultado vem aí." }),
      ])
    );
  }
}

/* ---------- perguntas de data (o quiz dos aniversários) ------------------- */

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const DIAS_NO_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "05-11" vira "5 de novembro". */
function porExtenso(data) {
  const [d, m] = String(data).split("-").map(Number);
  // Em português o primeiro dia do mês é ordinal: 1º de janeiro, 2 de janeiro.
  return `${d === 1 ? "1º" : d} de ${MESES[m - 1] || "?"}`;
}

async function enviarData(dia, mes) {
  if (!estado.aberto || !estado.atual) return;
  const anterior = estado.data;
  const data = `${String(dia).padStart(2, "0")}-${String(mes).padStart(2, "0")}`;
  estado.data = data;
  desenhar();
  try {
    await pedir("/quiz/responder", {
      method: "POST",
      body: JSON.stringify({ pergunta: estado.atual, data, quem: estado.aparelho }),
    });
  } catch (erro) {
    estado.data = anterior;
    desenhar();
    mostrarErro(String(erro.message || erro));
  }
}

function desenharData(tela) {
  const dia = el("select.data-campo", { disabled: !estado.aberto });
  const mes = el("select.data-campo", { disabled: !estado.aberto });
  MESES.forEach((nome, i) => {
    mes.append(el("option", { value: String(i + 1), texto: nome }));
  });

  // O número de dias segue o mês escolhido: 31 de fevereiro não é opção.
  function encherDias() {
    const m = Number(mes.value) || 1;
    const escolhido = Number(dia.value) || 0;
    limpar(dia);
    for (let d = 1; d <= DIAS_NO_MES[m - 1]; d += 1) {
      dia.append(el("option", { value: String(d), texto: String(d) }));
    }
    if (escolhido && escolhido <= DIAS_NO_MES[m - 1]) dia.value = String(escolhido);
  }

  if (estado.data) {
    const [d, m] = estado.data.split("-").map(Number);
    mes.value = String(m);
    encherDias();
    dia.value = String(d);
  } else {
    encherDias();
  }
  mes.addEventListener("change", encherDias);

  const enviar = el("button.opcao.enviar", {
    type: "button",
    disabled: !estado.aberto,
    texto: estado.data ? "Trocar a data" : "Registrar",
  });
  enviar.addEventListener("click", () => enviarData(dia.value, mes.value));

  tela.append(el("div.data-escolha", {}, [dia, mes, enviar]));

  if (estado.aberto && !estado.data) {
    tela.append(
      el("div.painel", {}, [
        el("b", { texto: "Escolha o dia e o mês" }),
        el("span", { texto: "Sem o ano, e sem o seu nome: ninguém vê quem respondeu o quê." }),
      ])
    );
  } else if (estado.aberto) {
    tela.append(
      el("div.painel.ok", {}, [
        el("b", { texto: `${porExtenso(estado.data)} registrado` }),
        el("span", { texto: "Se errou, é só escolher de novo enquanto estiver aberto." }),
      ])
    );
  } else if (!estado.revelado) {
    tela.append(
      el("div.painel", {}, [
        el("b", { texto: "Respostas encerradas" }),
        el("span", { texto: "Olhe para o telão." }),
      ])
    );
  }

  const d = estado.revelado ? estado.resultados?.datas : null;
  if (!d) return;

  if (!d.coincidencias.length) {
    tela.append(
      el("div.painel", {}, [
        el("b", { texto: "Nenhuma data repetida" }),
        el("span", {
          texto: `${d.total} respostas, ${d.distintas} datas diferentes.`,
        }),
      ])
    );
    return;
  }

  const lista = el("div.opcoes");
  d.coincidencias.forEach(({ data, n }) => {
    lista.append(
      el("button.opcao.certa", { type: "button", disabled: true }, [
        el("span.letra", { texto: String(n) }),
        el("span", {}, [
          el("span", { texto: porExtenso(data) }),
          el("div.votos", { texto: `${n} pessoas nesta data` }),
        ]),
      ])
    );
  });
  tela.append(
    el("div.painel.ok", {}, [
      el("b", {
        texto:
          d.coincidencias.length === 1
            ? "Uma data repetida"
            : `${d.coincidencias.length} datas repetidas`,
      }),
      el("span", { texto: `${d.total} respostas ao todo.` }),
    ]),
    lista
  );
}

/* ---------- início ------------------------------------------------------- */

async function iniciar() {
  try {
    const dados = await (await fetch("perguntas.json")).json();
    estado.perguntas = dados.perguntas || [];
  } catch {
    limpar($("#tela")).append(
      el("div.painel.aviso", {}, [
        el("b", { texto: "Não consegui carregar as perguntas" }),
        el("span", { texto: "Verifique a conexão e recarregue a página." }),
      ])
    );
    return;
  }

  await sincronizar();
  desenhar();
  setInterval(sincronizar, INTERVALO_MS);

  // Voltar para a aba depois de olhar o telão precisa mostrar o estado de
  // agora, e não o de trinta segundos atrás.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) sincronizar();
  });
}

iniciar();
