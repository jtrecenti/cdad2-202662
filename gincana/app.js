/* ==========================================================================
   Gincana do Pipeline (aula 5).

   A atividade acontece no papel: cada mesa monta o encadeamento com as cartas
   do baralho. Este app não substitui isso, faz as três coisas que o papel não
   faz sozinho:

     1. dá o mesmo cronômetro para a sala inteira, disparado pelo professor;
     2. recolhe a ordem de cada grupo antes de o tempo acabar;
     3. roda o código que aquela ordem produz, no navegador, para a turma ver.

   Uma página só, dois modos. `?prof=1` pede a senha (conferida no Worker) e
   abre o painel de controle; sem ela, é a tela do aluno.

   O gabarito não vive aqui: quem confere é o Worker. O aluno recebe "recebido",
   nunca "certo" ou "errado".
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import {
  $, aviso, el, limpar, montarTopo, toast,
} from "../_shared/ui.js";
import {
  garantirModoProfessor, modoProfessor, pedirSenhaProfessor, quemEntrou,
  querEntrarComoProfessor, senhaProfessor,
} from "../_shared/liberacao.js";
import { carregar, rodar } from "../_shared/pyodide.js";

// ?demo=1 roda a gincana inteira no navegador, sem Worker e sem rede.
const DEMO = new URLSearchParams(location.search).get("demo") === "1";
const INTERVALO_SONDA = 2000;
const CHAVE_GRUPO = "gincana:grupo";
// Quantas vezes um grupo pode rodar o próprio código por rodada. O limite é
// o que separa "testar uma hipótese" de "tentar até acertar": com 40 cartas
// e cinco tentativas, força bruta não fecha, e raciocinar fecha.
const LIMITE_EXECUCOES = 5;

const estado = {
  cartas: new Map(),
  rodadas: [],
  rodada: null, // a rodada aberta pelo professor
  agoraOffset: 0, // relógio do servidor menos o do navegador
  py: null,
  carregandoPy: null,
  impressaoPy: null,
  gabarito: null,
  entradas: [],
  jaMandou: false,
  versaoVista: null,
};

/* ---------- utilidades ---------------------------------------------------- */

/**
 * As rotas do professor exigem a senha em toda chamada, e não só na entrada.
 * Uma sessão aberta antes de a senha passar a ser guardada tem o modo professor
 * ligado e nenhuma senha: aí vale pedir de novo, em vez de devolver "senha
 * inválida" sem explicação.
 */
async function garantirSenhaProf() {
  if (senhaProfessor()) return true;
  if (DEMO) return true;
  return pedirSenhaProfessor();
}

function agoraServidor() {
  return Date.now() + estado.agoraOffset;
}

function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

async function api(caminho, opcoes = {}) {
  if (DEMO) return apiDemo(caminho, opcoes);
  const r = await fetch(`${CONFIG.proxy}${caminho}`, {
    ...opcoes,
    headers: {
      "Content-Type": "application/json",
      ...(opcoes.prof ? { "X-Prof-Token": senhaProfessor() } : {}),
      ...(opcoes.headers || {}),
    },
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `erro ${r.status}`);
  return dados;
}

/* ---------- ensaio local (?demo=1) ---------------------------------------- */

/**
 * O mesmo contrato do Worker, guardado no localStorage. Existe para ensaiar a
 * aula sem depender de rede, e para desenvolver a tela sem publicar o Worker.
 *
 * Só serve para ensaio: o relógio é o da máquina, o gabarito não é conferido e
 * as abas não conversam entre si. Em sala, é o Worker que vale.
 */
function demoLer(chave, padrao) {
  try {
    return JSON.parse(localStorage.getItem(`gincana:demo:${chave}`)) ?? padrao;
  } catch {
    return padrao;
  }
}

function demoGravar(chave, valor) {
  localStorage.setItem(`gincana:demo:${chave}`, JSON.stringify(valor));
}

async function apiDemo(caminho, opcoes = {}) {
  const corpo = opcoes.body ? JSON.parse(opcoes.body) : {};
  const [rota] = caminho.split("?");
  const query = new URLSearchParams(caminho.split("?")[1] || "");

  if (rota === "/gincana/estado" && opcoes.method !== "POST") {
    return { estado: demoLer("estado", null), agora_ms: Date.now() };
  }
  if (rota === "/gincana/estado") {
    const estadoNovo = {
      rodada: String(corpo.rodada),
      segundos: Number(corpo.segundos) || 300,
      inicio_ms: Date.now(),
      aberto_por: "ensaio",
      versao: Date.now(),
    };
    demoGravar("estado", estadoNovo);
    return { ok: true, estado: estadoNovo, agora_ms: Date.now() };
  }
  if (rota === "/gincana/responder") {
    const e = demoLer("estado", null);
    if (!e || e.rodada !== corpo.rodada) return { ok: false, aceito: false, motivo: "rodada_fechada" };
    const restante = e.inicio_ms + e.segundos * 1000 - Date.now();
    if (restante < -2500) return { ok: false, aceito: false, motivo: "fora_do_tempo" };
    const todas = demoLer("respostas", {});
    todas[corpo.rodada] = todas[corpo.rodada] || {};
    todas[corpo.rodada][corpo.grupo] = {
      grupo: corpo.grupo, rodada: corpo.rodada, cartas: corpo.cartas,
      hora_ms: Date.now(), restante_ms: Math.max(0, restante),
      execucoes: Number(corpo.execucoes) || 0,
    };
    demoGravar("respostas", todas);
    return { ok: true, aceito: true, restante_ms: Math.max(0, restante) };
  }
  if (rota === "/gincana/respostas") {
    const rodada = query.get("rodada");
    const todas = demoLer("respostas", {});
    const lista = Object.values(todas[rodada] || {})
      // no ensaio não há gabarito: o veredito fica em branco de propósito
      .map((x) => ({ ...x, conhecida: false, certa: null }))
      .sort((a, b) => (b.restante_ms || 0) - (a.restante_ms || 0));
    return { rodada, respostas: lista, gabarito: null };
  }
  if (rota === "/gincana/limpar") {
    const todas = demoLer("respostas", {});
    delete todas[corpo.rodada];
    demoGravar("respostas", todas);
    return { ok: true };
  }
  throw new Error(`rota ${rota} não existe no ensaio`);
}

/** Monta o código a partir dos ids, do jeito que o tabuleiro pede. */
function montarCodigo(ids, dividirEm = null) {
  const linhas = ids
    .map((id) => estado.cartas.get(id)?.codigo)
    .filter(Boolean)
    .map((c) => c.split("\n").map((l) => `    ${l}`).join("\n"));
  if (!linhas.length) return "";
  if (dividirEm == null || dividirEm >= linhas.length) {
    return `(\n${linhas.join("\n")}\n)`;
  }
  const a = linhas.slice(0, dividirEm).join("\n");
  const b = linhas.slice(dividirEm).join("\n");
  return `resumo = (\n${a}\n)\n\n(\n${b}\n)`;
}

/**
 * Onde termina o bloco de pandas, nas rodadas de dois blocos. Descobrimos pela
 * primeira carta de gráfico: é o que o tabuleiro mostra, e evita pedir ao aluno
 * que informe a divisão.
 */
function corteDosBlocos(ids) {
  const i = ids.findIndex((id) => estado.cartas.get(id)?.naipe === "grafico");
  return i > 0 ? i : null;
}

/* ---------- alarme -------------------------------------------------------- */

let audio = null;

function bipe(vezes = 3) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    for (let i = 0; i < vezes; i += 1) {
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.connect(vol);
      vol.connect(audio.destination);
      osc.type = "sine";
      osc.frequency.value = i === vezes - 1 ? 660 : 880;
      const t = audio.currentTime + i * 0.28;
      vol.gain.setValueAtTime(0.0001, t);
      vol.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      osc.start(t);
      osc.stop(t + 0.26);
    }
  } catch {
    /* som é conforto, não requisito: sem ele a tela ainda avisa */
  }
}

/* ---------- estado vindo do servidor -------------------------------------- */

async function sondar() {
  try {
    const { estado: e, agora_ms } = await api("/gincana/estado");
    estado.agoraOffset = agora_ms - Date.now();
    const mudou = (e?.versao || null) !== estado.versaoVista;
    estado.rodada = e || null;
    if (mudou) {
      estado.versaoVista = e?.versao || null;
      estado.jaMandou = false;
      aoMudarRodada();
    }
  } catch {
    /* rede instável em sala é normal: a próxima sonda resolve */
  }
}

function rodadaAtual() {
  if (!estado.rodada) return null;
  return estado.rodadas.find((r) => r.id === estado.rodada.rodada) || null;
}

function tempoRestante() {
  if (!estado.rodada?.inicio_ms) return null;
  const fim = estado.rodada.inicio_ms + estado.rodada.segundos * 1000;
  return fim - agoraServidor();
}

/* ---------- tela do aluno ------------------------------------------------- */

function telaAluno() {
  const app = limpar($("#app"));
  app.append(
    el("section.cartao", { id: "painel-rodada" }),
    el("section.cartao", { id: "painel-resposta" }),
  );
  desenharAluno();
}

function desenharAluno() {
  const alvo = limpar($("#painel-rodada"));
  const r = rodadaAtual();

  if (!r) {
    alvo.append(
      el("h2", { texto: "Esperando o professor" }),
      aviso("info", null,
        "Quando a rodada abrir, o problema e o cronômetro aparecem aqui. " +
        "Enquanto isso, separe o baralho em duas pilhas pela cor da tarja."),
      grupoInput(),
    );
    limpar($("#painel-resposta"));
    return;
  }

  alvo.append(
    el("div.linha-titulo", {}, [
      el("h2", { texto: `${r.rotulo} · ${r.titulo}` }),
    ]),
    el("p.destaque", { texto: r.pergunta }),
    el("div.etiquetas", {}, [
      el("span.etiqueta", { texto: `${r.n_cartas} cartas` }),
      el("span.etiqueta", {
        texto: r.pontua ? "vale ponto" : "aquecimento, não pontua",
      }),
      el("span.etiqueta", { texto: `procurem nas cartas ${
        r.naipe === "pandas" ? "turquesa" : r.naipe === "gráfico" ? "roxas" : "das duas cores"
      }` }),
    ]),
  );

  if (r.figura) {
    alvo.append(el("img", {
      src: r.figura, alt: "o gráfico que a rodada pede",
      style: "max-width:min(100%,34rem);border:var(--borda);border-radius:var(--raio);margin-top:.6rem",
    }));
  }

  alvo.append(painelTempo());
  desenharResposta(r);
}

function painelTempo() {
  return el("div.painel-tempo", { id: "painel-tempo" }, [
    el("div.cronometro", { id: "cronometro", texto: "" }),
    el("div.barra-tempo", {}, [el("i", { id: "barra-tempo" })]),
    el("p.ajuda", { id: "aviso-tempo", texto: "" }),
  ]);
}

function grupoInput() {
  const guardado = localStorage.getItem(CHAVE_GRUPO) || "";
  const campo = el("input", {
    id: "grupo", type: "text", inputmode: "numeric", maxlength: "3",
    placeholder: "ex.: 7", value: guardado,
    style: "width:6rem;font-weight:700;text-align:center",
  });
  campo.addEventListener("input", () => {
    localStorage.setItem(CHAVE_GRUPO, campo.value.trim());
  });
  return el("div", { style: "margin-top:.8rem" }, [
    el("label", { for: "grupo", texto: "Número do seu grupo" }),
    campo,
  ]);
}

function desenharResposta(r) {
  const alvo = limpar($("#painel-resposta"));
  estado.entradas = [];

  alvo.append(
    el("h3", { texto: "A ordem das cartas" }),
    el("p.ajuda", {
      texto: "Monte no tabuleiro primeiro. Depois digite aqui os códigos, na " +
             "mesma ordem, uma caixa por carta.",
    }),
    grupoInput(),
  );

  const caixas = el("div.cartas-entrada", { style: "margin-top:.7rem" });
  for (let i = 0; i < r.n_cartas; i += 1) {
    const input = el("input", {
      type: "text", maxlength: "3", "aria-label": `carta ${i + 1}`,
      autocomplete: "off", spellcheck: "false",
    });
    input.addEventListener("input", () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      // pula sozinho para a próxima caixa quando o código fica completo
      if (input.value.length === 3 && estado.entradas[i + 1]) {
        estado.entradas[i + 1].focus();
      }
      atualizarPrevia(r);
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
    el("div.glossario", { id: "glossario" }),
    el("div", { style: "margin-top:1rem;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap" }, [
      el("button.secundario", { id: "b-rodar-aluno", texto: "Rodar e ver o resultado" }),
      el("span.contador", { id: "contador-execucoes" }),
      el("span.ajuda", { id: "status-python-aluno" }),
    ]),
    el("div.saida-execucao", { id: "saida-aluno" }),
    el("div", { style: "margin-top:1rem;display:flex;gap:.6rem;align-items:center" }, [
      el("button.primario", { id: "b-enviar", texto: "Enviar a ordem" }),
      el("span", { id: "status-envio", class: "ajuda" }),
    ]),
  );

  $("#b-enviar").addEventListener("click", () => enviar(r));
  $("#b-rodar-aluno").addEventListener("click", () => rodarComoAluno(r));
  atualizarContador(r);
  habilitarRodarAluno();
  if (!estado.py) statusPython("carregando o Python do navegador…");
  atualizarPrevia(r);
}

function idsDigitados() {
  return estado.entradas.map((i) => i.value.trim().toUpperCase()).filter(Boolean);
}

function atualizarPrevia(r) {
  for (const input of estado.entradas) {
    const v = input.value.trim().toUpperCase();
    input.classList.toggle("ok", Boolean(v) && estado.cartas.has(v));
    input.classList.toggle("ruim", Boolean(v) && !estado.cartas.has(v));
  }

  const ids = idsDigitados().filter((id) => estado.cartas.has(id));
  const previa = limpar($("#previa"));
  if (!ids.length) {
    previa.append(el("p.vazio", { texto: "digite os códigos acima para ver o código aparecer" }));
  } else {
    previa.append(el("pre", {}, [
      el("code", { texto: montarCodigo(ids, r.dois_blocos ? corteDosBlocos(ids) : null) }),
    ]));
  }

  // o verso da carta, na tela: é a mesma frase impressa atrás dela
  const gloss = limpar($("#glossario"));
  for (const id of ids) {
    const c = estado.cartas.get(id);
    gloss.append(el("div", {}, [
      el("code", { texto: `${id} ` }),
      el("span", { texto: c.verso }),
    ]));
  }
}

async function enviar(r) {
  const grupo = ($("#grupo")?.value || "").trim();
  const status = $("#status-envio");
  if (!grupo) {
    toast("Escreva o número do grupo.");
    return;
  }
  const ids = idsDigitados();
  if (!ids.length) {
    toast("Digite ao menos uma carta.");
    return;
  }
  const desconhecidas = ids.filter((id) => !estado.cartas.has(id));
  if (desconhecidas.length) {
    toast(`Não existe carta ${desconhecidas.join(", ")}.`);
    return;
  }

  status.textContent = "enviando…";
  try {
    const resposta = await api("/gincana/responder", {
      method: "POST",
      body: JSON.stringify({
        grupo, rodada: r.id, cartas: ids, execucoes: execucoesFeitas(r.id),
      }),
    });
    if (resposta.aceito) {
      estado.jaMandou = true;
      status.replaceChildren(el("span.etiqueta.ok", {
        texto: `recebido com ${mmss(resposta.restante_ms)} de sobra`,
      }));
      toast("Ordem recebida.");
    } else {
      const motivos = {
        fora_do_tempo: "o tempo acabou antes de chegar",
        rodada_fechada: "esta rodada não está mais aberta",
        nao_comecou: "a rodada ainda não começou",
      };
      status.replaceChildren(el("span.etiqueta.erro", {
        texto: motivos[resposta.motivo] || "não foi aceito",
      }));
    }
  } catch (erro) {
    status.replaceChildren(el("span.etiqueta.erro", { texto: String(erro.message || erro) }));
  }
}

/* ---------- relógio (roda nos dois modos) --------------------------------- */

function tique() {
  const painel = $("#painel-tempo");
  if (!painel) return;
  const restante = tempoRestante();
  const cron = $("#cronometro");
  const barra = $("#barra-tempo");
  const av = $("#aviso-tempo");

  if (restante == null) {
    cron.textContent = "";
    painel.classList.remove("acabando", "acabou");
    if (barra) barra.style.width = "0%";
    if (av) av.textContent = "a rodada ainda não começou";
    return;
  }

  cron.textContent = mmss(restante);
  const total = estado.rodada.segundos * 1000;
  if (barra) barra.style.width = `${Math.max(0, Math.min(100, (restante / total) * 100))}%`;

  const acabou = restante <= 0;
  const acabando = !acabou && restante <= total / 3;
  painel.classList.toggle("acabando", acabando);
  painel.classList.toggle("acabou", acabou);

  if (acabou && !painel.dataset.alarmou) {
    painel.dataset.alarmou = "1";
    bipe();
    const b = $("#b-enviar");
    if (b) b.disabled = true;
    if (av) av.textContent = estado.jaMandou
      ? "tempo esgotado. A sua ordem foi recebida."
      : "tempo esgotado. Esta rodada não aceita mais envios.";
  } else if (!acabou) {
    delete painel.dataset.alarmou;
    if (av) av.textContent = estado.jaMandou
      ? "ordem já enviada. Dá para reenviar até o tempo acabar."
      : "";
  }
}

function ehProfessor() {
  return DEMO ? querEntrarComoProfessor() : modoProfessor();
}

function aoMudarRodada() {
  const painel = $("#painel-tempo");
  if (painel) delete painel.dataset.alarmou;
  if (ehProfessor()) desenharProfessor();
  else desenharAluno();
}

/* ---------- tela do professor --------------------------------------------- */

function telaProfessor() {
  const app = limpar($("#app"));
  app.append(
    el("section.cartao", { id: "controle" }),
    el("section.cartao", { id: "painel-respostas" }),
    el("section.cartao", { id: "painel-execucao" }, [
      el("h3", { texto: "Rodar o código de um grupo" }),
      el("p.ajuda", { id: "status-python", texto: "o Python do navegador carrega quando você mandar rodar a primeira vez" }),
      el("div.saida-execucao", { id: "saida-execucao" }),
    ]),
  );
  desenharProfessor();
}

function desenharProfessor() {
  const alvo = limpar($("#controle"));
  const atual = estado.rodada;

  alvo.append(el("h2", { texto: "Controle da gincana" }));

  const grade = el("div.grade-rodadas");
  for (const r of estado.rodadas) {
    const b = el("button.secundario", {
      texto: `${r.id} · ${r.titulo}`,
      title: `${r.n_cartas} cartas · sugestão ${r.minutos} min`,
    });
    if (atual?.rodada === r.id) b.classList.add("atual");
    b.addEventListener("click", () => abrirRodada(r));
    grade.append(b);
  }
  alvo.append(
    el("p.ajuda", { texto: "Escolha a rodada e o tempo. O cronômetro começa para a sala inteira no clique." }),
    grade,
  );

  const minutos = el("input", {
    id: "minutos", type: "number", min: "0.5", max: "30", step: "0.5",
    value: String(rodadaAtual()?.minutos ?? 5), style: "width:5.5rem",
  });
  alvo.append(
    el("div", { style: "margin-top:.9rem;display:flex;gap:.7rem;align-items:end;flex-wrap:wrap" }, [
      el("div", {}, [el("label", { for: "minutos", texto: "Minutos" }), minutos]),
      el("button.secundario", { id: "b-recarregar", texto: "Atualizar respostas" }),
      el("button.secundario", { id: "b-limpar", texto: "Apagar respostas desta rodada" }),
      el("button.secundario", { id: "b-aquecer", texto: "Carregar o Python agora" }),
    ]),
    painelTempo(),
  );

  $("#b-recarregar").addEventListener("click", carregarRespostas);
  $("#b-limpar").addEventListener("click", limparRodada);
  $("#b-aquecer").addEventListener("click", aquecerPython);

  if (atual) {
    const r = rodadaAtual();
    alvo.append(el("p.destaque", {
      texto: r ? `Aberta: ${r.rotulo} · ${r.titulo}` : `Aberta: ${atual.rodada}`,
    }));
  }
  carregarRespostas();
}

async function abrirRodada(r) {
  if (!(await garantirSenhaProf())) return;
  const minutos = Number($("#minutos")?.value || r.minutos || 5);
  try {
    const dados = await api("/gincana/estado", {
      method: "POST", prof: true,
      body: JSON.stringify({ rodada: r.id, segundos: Math.round(minutos * 60) }),
    });
    estado.agoraOffset = dados.agora_ms - Date.now();
    estado.rodada = dados.estado;
    estado.versaoVista = dados.estado.versao;
    const painel = $("#painel-tempo");
    if (painel) delete painel.dataset.alarmou;
    desenharProfessor();
    toast(`${r.rotulo} aberta, ${minutos} min.`);
  } catch (erro) {
    toast(String(erro.message || erro), 4000);
  }
}

async function limparRodada() {
  if (!estado.rodada) return;
  if (!(await garantirSenhaProf())) return;
  try {
    await api("/gincana/limpar", {
      method: "POST", prof: true,
      body: JSON.stringify({ rodada: estado.rodada.rodada }),
    });
    toast("Respostas apagadas.");
    carregarRespostas();
  } catch (erro) {
    toast(String(erro.message || erro), 4000);
  }
}

async function carregarRespostas() {
  const alvo = limpar($("#painel-respostas"));
  if (!estado.rodada) {
    alvo.append(el("p.ajuda", { texto: "Nenhuma rodada aberta." }));
    return;
  }
  const r = rodadaAtual();
  alvo.append(el("h3", { texto: "O que os grupos mandaram" }));

  if (!DEMO && !senhaProfessor()) {
    alvo.append(aviso("info", null,
      "Entre com a senha da equipe para ver os envios: abra a rodada e a caixa "
      + "de senha aparece."));
    return;
  }

  let dados;
  try {
    dados = await api(`/gincana/respostas?rodada=${encodeURIComponent(estado.rodada.rodada)}`, { prof: true });
  } catch (erro) {
    alvo.append(aviso("erro", "Não consegui ler as respostas", String(erro.message || erro)));
    return;
  }

  estado.gabarito = dados.gabarito || null;
  if (dados.gabarito) {
    const g = dados.gabarito;
    const seq = g.gabarito2
      ? `${g.gabarito.join(" > ")}   //   ${g.gabarito2.join(" > ")}`
      : g.gabarito.join(" > ");
    const b = el("button.secundario", { texto: "rodar o gabarito" });
    b.addEventListener("click", executarGabarito);
    alvo.append(el("div", { style: "display:flex;gap:.6rem;align-items:center;flex-wrap:wrap" }, [
      el("span.ajuda", {}, [
        el("strong", { texto: "gabarito: " }),
        el("code", { texto: seq }),
        el("span", { texto: ` (+${g.n_alternativas} equivalentes)` }),
      ]),
      b,
    ]));
  }

  if (!dados.respostas.length) {
    alvo.append(el("p.ajuda", { texto: "ninguém enviou ainda" }));
    return;
  }

  const conferiu = dados.respostas.some((x) => x.certa != null);
  const certas = dados.respostas.filter((x) => x.certa).length;
  alvo.append(el("p", {}, [
    el("strong", { texto: `${dados.respostas.length} envios` }),
    el("span", { texto: conferiu ? `, ${certas} com a ordem certa` : "" }),
  ]));

  for (const resp of dados.respostas) {
    // `certa` vem null quando não há gabarito (o ensaio local): aí a linha fica
    // neutra, e não vermelha, para não acusar de errado o que não foi conferido
    const classe = resp.certa == null ? "" : resp.certa ? ".certa" : ".errada";
    const veredito = resp.certa == null
      ? "sem gabarito aqui" : resp.certa ? "ordem certa" : "ordem diferente";
    const linha = el(`div.resposta${classe}`, {}, [
      el("div.linha1", {}, [
        el("strong", { texto: `Grupo ${resp.grupo}` }),
        el("code", { texto: resp.cartas.join(" > ") }),
        el("span.etiqueta", { texto: veredito }),
        el("span.tempo", {
          texto: `${mmss(resp.restante_ms || 0)} de sobra`
            + (resp.execucoes ? ` · ${resp.execucoes} execuç${resp.execucoes === 1 ? "ão" : "ões"}` : ""),
        }),
        el("button.secundario", { texto: "rodar", dataset: { grupo: resp.grupo } }),
      ]),
    ]);
    linha.querySelector("button").addEventListener("click", () => {
      executar(resp, r);
    });
    alvo.append(linha);
  }
}

/* ---------- rodar código, nas duas telas ---------------------------------- */

/**
 * Baixar o Pyodide com pandas e plotnine leva mais de dois minutos na primeira
 * vez. O professor tem um botão para fazer isso antes da aula; na tela do
 * aluno o download começa sozinho quando a página abre, para estar pronto na
 * hora de rodar. Por isso o roteiro pede que abram o app no início da aula.
 */
async function aquecerPython() {
  const b = $("#b-aquecer");
  if (b) b.disabled = true;
  try {
    await garantirPython();
    toast("Python pronto. Rodar o código agora é instantâneo.");
  } catch (erro) {
    toast(String(erro.message || erro), 4000);
    if (b) b.disabled = false;
  }
}

function statusPython(texto) {
  for (const id of ["#status-python", "#status-python-aluno"]) {
    const alvo = $(id);
    if (alvo) alvo.textContent = texto;
  }
}

async function garantirPython() {
  if (estado.py) return estado.py;
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
    habilitarRodarAluno();
    return py;
  })();

  return estado.carregandoPy;
}

/**
 * Começa o download em segundo plano, com um atraso sorteado. Sem o atraso, a
 * turma inteira pede os mesmos 40 MB no mesmo segundo quando a aula começa, e
 * a rede da sala é o gargalo.
 */
function aquecerEmSegundoPlano() {
  const atraso = Math.floor(Math.random() * 15000);
  setTimeout(() => {
    garantirPython().catch(() => statusPython("não consegui carregar o Python"));
  }, atraso);
}

/**
 * Roda a sequência de cartas e devolve o que saiu: gráfico, tabela ou erro.
 *
 * O resultado precisa de um nome (`_ultimo`) porque pandas devolve tabela e
 * plotnine devolve gráfico, e cada um é mostrado de um jeito.
 *
 * Rodar isto é seguro: o texto não vem digitado, é a concatenação de cartas
 * conhecidas do baralho, na ordem escolhida.
 */
async function rodarIds(ids, doisBlocos) {
  const py = await garantirPython();
  const corte = doisBlocos ? corteDosBlocos(ids) : null;
  const bloco = (lista) =>
    lista.map((i) => estado.cartas.get(i).codigo
      .split("\n").map((l) => `    ${l}`).join("\n")).join("\n");
  const corpo = corte
    ? `resumo = (\n${bloco(ids.slice(0, corte))}\n)\n_ultimo = (\n${bloco(ids.slice(corte))}\n)`
    : `_ultimo = (\n${bloco(ids)}\n)`;

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
            buf, format="png", width=7, height=4.2, dpi=110, verbose=False)
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

/** Desenha o que saiu da execução, com o código em um bloco recolhível. */
function mostrarSaida(alvo, titulo, ids, codigo, r, esperado = null) {
  limpar(alvo).append(
    el("p", {}, [
      el("strong", { texto: titulo }),
      el("code", { texto: ` ${ids.join(" > ")}` }),
    ]),
    el("details", {}, [
      el("summary", { texto: "o código" }),
      el("pre", {}, [el("code", { texto: codigo })]),
    ]),
  );

  if (r.erro) {
    alvo.append(aviso("erro", "O código não rodou", ""));
    alvo.append(el("pre", {}, [el("code", { texto: r.erro })]));
    return;
  }
  if (r.png) {
    alvo.append(el("img", { src: `data:image/png;base64,${r.png}`, alt: "gráfico produzido" }));
    return;
  }
  // O veredito compara impressões digitais: o gabarito não está aqui, e o
  // aluno também não vê a tabela certa. Só sabe se a dele bate.
  if (esperado && r.impressao) {
    const bate = r.impressao === esperado;
    alvo.append(aviso(bate ? "ok" : "atencao", null, bate
      ? "O resultado bate com o esperado. Pode enviar a ordem."
      : "O código roda, mas o resultado é outro. Confira as cartas e a ordem."));
  }

  if (r.tabela) {
    alvo.append(el("p.ajuda", {
      texto: r.linhas != null ? `${r.linhas} linhas · ${r.colunas.join(", ")}` : "",
    }));
    const colunas = Object.keys(r.tabela[0] || {});
    alvo.append(el("div", { style: "overflow-x:auto" }, [
      el("table.tabela", {}, [
        el("thead", {}, [el("tr", {}, colunas.map((c) => el("th", { texto: c })))]),
        el("tbody", {}, r.tabela.map((linha) =>
          el("tr", {}, colunas.map((c) => el("td", { texto: String(linha[c]) }))))),
      ]),
    ]));
  }
}

async function rodarNaTela(alvo, titulo, ids, doisBlocos, esperado = null) {
  limpar(alvo).append(el("p.carregando", { texto: `rodando ${titulo.toLowerCase()}…` }));
  let r;
  try {
    r = await rodarIds(ids, doisBlocos);
  } catch (erro) {
    limpar(alvo).append(
      aviso("erro", "Não consegui rodar", String(erro.message || erro)));
    return null;
  }
  mostrarSaida(alvo, titulo, ids,
    montarCodigo(ids, doisBlocos ? corteDosBlocos(ids) : null), r, esperado);
  return r;
}

/* ---------- execução na tela do professor --------------------------------- */

function executar(resp, r) {
  return rodarNaTela($("#saida-execucao"), `Grupo ${resp.grupo}`,
    resp.cartas, Boolean(r?.dois_blocos));
}

/**
 * O código do gabarito, para quando nenhum grupo acertar. O gabarito só existe
 * nesta tela: ele vem do Worker, na resposta de /gincana/respostas, e nunca
 * chega ao navegador do aluno.
 */
function executarGabarito() {
  const g = estado.gabarito;
  if (!g) return null;
  const ids = g.gabarito2 ? [...g.gabarito, ...g.gabarito2] : g.gabarito;
  return rodarNaTela($("#saida-execucao"), "Gabarito", ids, Boolean(g.gabarito2));
}

/* ---------- execução na tela do aluno ------------------------------------- */

/**
 * A contagem é por *abertura* da rodada, e não pela rodada. Se o professor
 * reabrir a mesma rodada (por causa de um problema técnico, por exemplo), a
 * `versao` muda e o grupo recomeça com as cinco execuções.
 */
function chaveExecucoes(rodada) {
  return `gincana:execucoes:${rodada}:${estado.rodada?.versao || 0}`;
}

function execucoesFeitas(rodada) {
  return Number(localStorage.getItem(chaveExecucoes(rodada)) || 0);
}

function habilitarRodarAluno() {
  const b = $("#b-rodar-aluno");
  if (!b) return;
  const r = rodadaAtual();
  if (!r) return;
  const restam = LIMITE_EXECUCOES - execucoesFeitas(r.id);
  b.disabled = !estado.py || restam <= 0;
}

function atualizarContador(r) {
  const alvo = $("#contador-execucoes");
  if (!alvo) return;
  const feitas = execucoesFeitas(r.id);
  const restam = LIMITE_EXECUCOES - feitas;
  alvo.textContent = restam > 0
    ? `${restam} de ${LIMITE_EXECUCOES} execuções restantes`
    : "acabaram as execuções desta rodada";
  alvo.classList.toggle("acabou", restam <= 0);
}

async function rodarComoAluno(r) {
  const ids = idsDigitados();
  if (!ids.length) {
    toast("Digite as cartas antes de rodar.");
    return;
  }
  const desconhecidas = ids.filter((id) => !estado.cartas.has(id));
  if (desconhecidas.length) {
    toast(`Não existe carta ${desconhecidas.join(", ")}.`);
    return;
  }
  if (execucoesFeitas(r.id) >= LIMITE_EXECUCOES) {
    toast("Acabaram as execuções desta rodada.");
    return;
  }

  // conta antes de rodar: uma tentativa que dá erro também é uma tentativa,
  // senão a trava não trava nada
  localStorage.setItem(chaveExecucoes(r.id), String(execucoesFeitas(r.id) + 1));
  atualizarContador(r);
  habilitarRodarAluno();

  const b = $("#b-rodar-aluno");
  if (b) b.disabled = true;
  await rodarNaTela($("#saida-aluno"), "O seu código", ids,
    Boolean(r.dois_blocos), r.impressao || null);
  habilitarRodarAluno();
}

/* ---------- partida ------------------------------------------------------- */

async function iniciar() {
  montarTopo({
    exercicio: "Aula 5",
    aula: "atividade em sala",
    titulo: "Gincana do Pipeline",
    direita: [],
  });

  const dados = await fetch("cartas.json").then((r) => r.json());
  for (const c of dados.cartas) estado.cartas.set(c.id, c);
  estado.rodadas = dados.rodadas;
  estado.impressaoPy = dados.impressao_py || null;

  const querProf = querEntrarComoProfessor();
  if (querProf && !DEMO) await garantirModoProfessor();

  await sondar();
  if (ehProfessor()) {
    telaProfessor();
    const quem = DEMO ? "ensaio" : quemEntrou();
    if (quem) toast(`modo professor: ${quem}`);
  } else {
    telaAluno();
    aquecerEmSegundoPlano();
  }

  setInterval(sondar, INTERVALO_SONDA);
  setInterval(tique, 250);
}

iniciar().catch((erro) => {
  limpar($("#app")).append(
    aviso("erro", "Não consegui abrir a gincana", String(erro.message || erro))
  );
});
