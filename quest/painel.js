/* ==========================================================================
   Quest do planejamento · painel do telão.

   Uso na aula: abrir o painel, digitar a senha, e deixar no telão enquanto os
   grupos fazem a quest. Os três primeiros a terminar aparecem no pódio, com o
   botão que abre os slides deles. No fim: "revelar o placar" mostra quem foi
   barrado menos vezes (o prêmio), e "abrir a troca" sorteia quem avalia quem
   entre os grupos que terminaram.
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";

const INTERVALO_MS = 3000;
// ?detalhe=1 é para o computador do professor, e não para o telão: com a senha,
// cada cartão mostra as barradas do grupo, para achar quem empacou.
const DETALHE = new URLSearchParams(location.search).get("detalhe") === "1";
const ETAPAS = 7;
const GRUPOS_DA_TURMA = 14;
const $ = (s) => document.querySelector(s);

const estado = { temas: {}, dados: null, confirmarApagar: 0 };

function senha() {
  return $("#senha").value.trim();
}

function recado(texto, ruim = false) {
  const n = $("#recado");
  n.textContent = texto;
  n.className = ruim ? "ruim" : "";
  if (texto && !ruim) setTimeout(() => { if (n.textContent === texto) n.textContent = ""; }, 3000);
}

async function pedir(caminho, opcoes = {}) {
  const r = await fetch(`${CONFIG.proxy}${caminho}`, {
    ...opcoes,
    headers: { "Content-Type": "application/json", "X-Prof-Token": senha(), ...(opcoes.headers || {}) },
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `erro ${r.status}`);
  return dados;
}

const hora = (ms) =>
  new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function el(tag, attrs = {}, filhos = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "texto") n.textContent = v;
    else if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const f of [].concat(filhos)) if (f != null) n.append(f);
  return n;
}

async function atualizar() {
  try {
    estado.dados = await pedir("/quest/painel");
    desenhar();
  } catch (erro) {
    recado(String(erro.message || erro), true);
  }
}

function desenhar() {
  const { grupos = [], controle = {} } = estado.dados || {};
  const porNumero = Object.fromEntries(grupos.map((g) => [g.grupo, g]));
  const numeros = [...new Set([...Array.from({ length: GRUPOS_DA_TURMA }, (_, i) => i + 1), ...grupos.map((g) => g.grupo)])];
  const terminaram = grupos.filter((g) => g.fim_ms).sort((a, b) => a.fim_ms - b.fim_ms);
  const ordem = Object.fromEntries(terminaram.map((g, i) => [g.grupo, i + 1]));

  $("#resumo").textContent =
    `${grupos.length} grupos na quest · ${terminaram.length} terminaram` +
    (controle.troca ? " · troca aberta" : "");

  const grade = $("#grade");
  grade.replaceChildren(
    ...numeros.map((n) => {
      const g = porNumero[n];
      if (!g) {
        return el("div", { class: "cartao vazio" }, [
          el("div", { class: "topo" }, [el("span", { class: "n", texto: `Grupo ${n}` })]),
          el("div", { class: "tema", texto: "ainda não começou" }),
        ]);
      }
      const barras = el("div", { class: "barras" },
        Array.from({ length: ETAPAS }, (_, i) => el("i", { class: i < g.etapa ? "feita" : "" })));
      const status = (g.fim_ms
        ? `${ordem[g.grupo]}º a terminar · ${hora(g.fim_ms)}`
        : `etapa ${g.etapa + 1} de ${ETAPAS}`) +
        (DETALHE && g.barrados !== undefined ? ` · ${g.barrados} barr.` : "");
      return el("div", { class: `cartao${g.fim_ms ? " fim" : ""}` }, [
        el("div", { class: "topo" }, [
          el("span", { class: "n", texto: g.grupo === 20 ? "Teste" : `Grupo ${g.grupo}` }),
          el("span", { class: "st", texto: status }),
        ]),
        el("div", { class: "tema", texto: estado.temas[g.tema] || g.tema }),
        barras,
        g.fim_ms ? el("button", { texto: "abrir os slides", onclick: () => abrirSlides(g.grupo) }) : null,
      ]);
    })
  );

  const podio = $("#podio");
  podio.replaceChildren(
    terminaram.length
      ? el("div", {}, [
          el("h2", { texto: "Os três primeiros a terminar apresentam" }),
          el("ol", {}, terminaram.slice(0, 3).map((g) =>
            el("li", { texto: `Grupo ${g.grupo}, ${estado.temas[g.tema] || g.tema}, às ${hora(g.fim_ms)}` }))),
        ])
      : ""
  );

  const placar = $("#placar");
  $("#b-revelar").textContent = controle.revelado ? "esconder o placar" : "revelar o placar";
  $("#b-troca").textContent = controle.troca ? "fechar a troca" : "abrir a troca";
  // Com a senha o Worker manda as barradas sempre; o placar só aparece quando
  // o professor revela.
  if (!controle.revelado) {
    placar.replaceChildren();
    return;
  }
  // Prêmio: quem terminou com menos barradas; o horário só desempata. Quem não
  // terminou vem depois, pela etapa em que parou.
  const ranking = [...grupos].sort((a, b) => {
    if (Boolean(a.fim_ms) !== Boolean(b.fim_ms)) return a.fim_ms ? -1 : 1;
    if (a.fim_ms && b.fim_ms) return a.barrados - b.barrados || a.fim_ms - b.fim_ms;
    return b.etapa - a.etapa || a.barrados - b.barrados;
  });
  placar.replaceChildren(
    el("h2", { texto: "Placar: quem foi barrado menos vezes" }),
    el("table", {}, [
      el("thead", {}, el("tr", {}, ["", "grupo", "tema", "barradas", "envios", "situação"].map((t) => el("th", { texto: t })))),
      el("tbody", {}, ranking.map((g, i) =>
        el("tr", { class: i === 0 && g.fim_ms ? "premio" : "" }, [
          el("td", { texto: `${i + 1}º` }),
          el("td", { texto: g.grupo === 20 ? "teste" : String(g.grupo) }),
          el("td", { texto: estado.temas[g.tema] || g.tema }),
          el("td", { texto: String(g.barrados ?? "") }),
          el("td", { texto: String(g.tentativas ?? "") }),
          el("td", { texto: g.fim_ms ? `terminou às ${hora(g.fim_ms)}` : `parou na etapa ${g.etapa + 1}` }),
        ]))),
    ])
  );
}

function abrirSlides(grupo) {
  const proxy = new URLSearchParams(location.search).get("proxy");
  const extra = proxy ? `&proxy=${encodeURIComponent(proxy)}` : "";
  window.open(`slides.html?grupo=${grupo}${extra}`, "_blank", "noopener");
}

async function controlar(acao, extra = {}) {
  if (!senha()) return recado("digite a senha", true);
  try {
    await pedir("/quest/controle", { method: "POST", body: JSON.stringify({ acao, ...extra }) });
    try { sessionStorage.setItem("cdad2-quest-senha", senha()); } catch { /* sem armazenamento */ }
    recado("feito");
    atualizar();
  } catch (erro) {
    recado(String(erro.message || erro), true);
  }
}

function ligar() {
  $("#b-revelar").addEventListener("click", () =>
    controlar(estado.dados?.controle?.revelado ? "esconder" : "revelar"));
  $("#b-troca").addEventListener("click", () =>
    controlar(estado.dados?.controle?.troca ? "fechar_troca" : "troca"));
  // Dois cliques em três segundos, e não uma janela de confirmação: janela
  // modal no meio da aula trava a tela projetada.
  $("#b-apagar").addEventListener("click", () => {
    const agora = Date.now();
    if (agora - estado.confirmarApagar > 3000) {
      estado.confirmarApagar = agora;
      return recado("clique de novo para apagar a quest inteira", true);
    }
    estado.confirmarApagar = 0;
    controlar("limpar");
  });
  $("#b-tema").addEventListener("click", () => {
    const escuro = document.documentElement.dataset.tema !== "escuro";
    document.documentElement.dataset.tema = escuro ? "escuro" : "";
    $("#b-tema").textContent = escuro ? "claro" : "escuro";
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") $("#controle").classList.toggle("recolhida");
  });
}

async function iniciar() {
  try {
    const s = sessionStorage.getItem("cdad2-quest-senha");
    if (s) $("#senha").value = s;
  } catch { /* sem armazenamento */ }
  ligar();
  try {
    const temas = (await fetch("temas.json").then((r) => r.json())).temas || [];
    estado.temas = Object.fromEntries(temas.map((t) => [t.id, t.titulo]));
  } catch { /* sem os títulos, o painel mostra o id do tema */ }
  await atualizar();
  setInterval(atualizar, INTERVALO_MS);
}

iniciar();
