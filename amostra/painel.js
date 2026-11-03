/* ==========================================================================
   Amostra da sala · painel do professor

   A ordem de uso, na aula:

     1. vista "as médias", antes de soltar: o eixo, a média das 8.505 em
        vermelho e o QR. A sala sorteia e envia; o contador sobe.
     2. "soltar": as médias da sala caem nas caixinhas. Passar o mouse num
        ponto mostra de quem é. "ver histograma" troca pontos por barras.
     3. "+30", várias vezes: amostras simuladas em cinza, até o sino aparecer.
        "curva normal" desenha a normal que o TCL promete, com desvio DP/raiz(n).
     4. vista "os intervalos": o mesmo, com um intervalo por linha, e os que
        não contêm a média em vermelho.

   Os slides abrem o painel já na vista certa: painel.html?vista=media ou
   painel.html?vista=ic.

   As simuladas são sorteadas aqui, no navegador do professor, com a mesma base
   e o mesmo tamanho de amostra dos celulares. Elas nunca vão para o servidor.
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import {
  AMOSTRA, carregarPopulacao, sortear, valores, media, desvioPopulacional,
  intervalo, fmt,
} from "./amostra.js";

const INTERVALO_MS = 2000;
const W = 1200;
const H = 520;
const M = { e: 70, d: 40, t: 58, b: 70 };
const NS = "http://www.w3.org/2000/svg";
const ENDERECO = {
  media: "jtrecenti.github.io/cdad2-202662/amostra",
  ic: "jtrecenti.github.io/cdad2-202662/amostra/?etapa=ic",
};
const QR = { media: "qr.svg", ic: "qr-ic.svg" };
const TITULO = {
  media: "Quanto tempo, em média, os 8.505 recursos levaram da distribuição ao julgamento?",
  ic: "O intervalo de 95% de cada um contém a média das 8.505?",
};

const $ = (s) => document.querySelector(s);

const estado = {
  vista: new URLSearchParams(location.search).get("vista") === "ic" ? "ic" : "media",
  solto: { media: false, ic: false },
  modo: "pontos",
  normal: false,
  pop: null,
  mu: 0,
  sigma: 0,
  respostas: { media: [], ic: [] },
  simuladas: [],
  simuladosIC: [],
  vistos: new Set(),
  confirmarApagar: 0,
};

/* ---------- senha e conversa com o Worker -------------------------------- */

function senha() {
  return $("#senha").value.trim();
}

function lembrarSenha() {
  try { sessionStorage.setItem("cdad2-amostra-senha", senha()); } catch { /* sem armazenamento */ }
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

function recado(texto, ruim = false) {
  const n = $("#recado");
  n.textContent = texto;
  n.className = ruim ? "aviso-senha" : "";
  if (texto && !ruim) setTimeout(() => { if (n.textContent === texto) n.textContent = ""; }, 3000);
}

async function atualizar() {
  if (!senha()) {
    recado("digite a senha", true);
    return;
  }
  try {
    const dados = await pedir(`/amostra/resultados?etapa=${estado.vista}`);
    estado.respostas[estado.vista] = dados.respostas || [];
    lembrarSenha();
    if ($("#recado").className === "aviso-senha") recado("");
  } catch (erro) {
    // Um ciclo sem dados não importa; a tela projetada não pode piscar erro.
    if (!estado.respostas[estado.vista].length) recado(String(erro.message || erro), true);
  }
  desenhar();
}

/* ---------- escalas -------------------------------------------------------- */

const epTeorico = () => estado.sigma / Math.sqrt(AMOSTRA.n);

function eixoDaVista() {
  const ep = epTeorico();
  const raio = estado.vista === "media" ? 4.5 * ep : 7 * ep;
  const passo = estado.vista === "media" ? 0.25 : 0.5;
  return [
    Math.floor((estado.mu - raio) / passo) * passo,
    Math.ceil((estado.mu + raio) / passo) * passo,
  ];
}

/** Caixinha de uns 1/3 de erro-padrão: fina o bastante para o sino aparecer. */
function larguraFaixa() {
  const alvo = epTeorico() / 3;
  const opcoes = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
  return opcoes.reduce((melhor, w) => (Math.abs(w - alvo) < Math.abs(melhor - alvo) ? w : melhor));
}

function svgEl(tag, attrs = {}, pai = null) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) n.setAttribute(k, v);
  }
  if (pai) pai.appendChild(n);
  return n;
}

function desenharEixo(svg, x0, x1, x, titulo) {
  const g = svgEl("g", { class: "eixo" }, svg);
  const base = H - M.b;
  svgEl("line", { x1: M.e, x2: W - M.d, y1: base, y2: base }, g);
  const passo = x1 - x0 > 3 ? 0.5 : 0.25;
  // marcas nos múltiplos do passo, e não a partir da borda do eixo: com o
  // eixo começando em 1,25 as marcas saíam em 1,3, 1,8, 2,3...
  const primeira = Math.ceil(x0 / passo - 1e-9) * passo;
  for (let v = primeira; v <= x1 + 1e-9; v += passo) {
    const px = x(v);
    svgEl("line", { x1: px, x2: px, y1: base, y2: base + 7 }, g);
    const t = svgEl("text", { x: px, y: base + 28, "text-anchor": "middle" }, g);
    t.textContent = fmt(v, passo < 0.5 ? 2 : 1);
  }
  const t = svgEl("text", { x: (M.e + W - M.d) / 2, y: base + 60, "text-anchor": "middle", class: "titulo-eixo" }, g);
  t.textContent = titulo;
}

function desenharMu(svg, x) {
  const px = x(estado.mu);
  svgEl("line", { x1: px, x2: px, y1: M.t - 8, y2: H - M.b, class: "mu" }, svg);
  const t = svgEl("text", { x: px, y: M.t - 18, "text-anchor": "middle", class: "mu-texto" }, svg);
  t.textContent = `média das ${estado.pop.linhas.length.toLocaleString("pt-BR")}: ${fmt(estado.mu, 2)} anos`;
}

/* ---------- vista 1: as médias -------------------------------------------- */

function pontosMedia() {
  const alunos = estado.respostas.media.map((r) => ({
    chave: `a:${r.login}:${r.media}`,
    x: r.media,
    aluno: true,
    dica: `${r.nome}\n${fmt(r.media, 2)} anos`,
  }));
  const sim = estado.simuladas.map((m, i) => ({
    chave: `s:${i}`,
    x: m,
    aluno: false,
    dica: `amostra simulada\n${fmt(m, 2)} anos`,
  }));
  return [...alunos, ...sim];
}

function desenharMedias(svg) {
  const [x0, x1] = eixoDaVista();
  const x = (v) => M.e + ((v - x0) / (x1 - x0)) * (W - M.e - M.d);
  desenharEixo(svg, x0, x1, x, `tempo médio nos ${AMOSTRA.n} recursos da amostra (anos)`);

  const pts = estado.solto.media ? pontosMedia() : [];
  if (pts.length) {
    const w = larguraFaixa();
    // Faixas centradas na média da base: a faixa 0 vai de mu - w/2 a mu + w/2,
    // e a linha vermelha passa pelo meio dela. As posições saem da mesma escala
    // x do eixo. Antes a largura em pixels vinha de dividir o eixo pelo número
    // de faixas arredondado, que não fechava com w, e as barras escorregavam
    // para a esquerda.
    const faixa = (v) => Math.round((v - estado.mu) / w);
    const iMin = faixa(x0);
    const iMax = faixa(x1);
    const porFaixa = new Map();
    for (const p of pts) {
      const i = Math.min(iMax, Math.max(iMin, faixa(p.x)));
      if (!porFaixa.has(i)) porFaixa.set(i, []);
      porFaixa.get(i).push(p);
    }
    const pilhas = [...porFaixa.entries()].sort((a, b) => a[0] - b[0]);
    const maior = Math.max(1, ...pilhas.map(([, p]) => p.length));
    const faixaPx = x(estado.mu + w) - x(estado.mu);
    const centro = (i) => x(estado.mu + i * w);
    const altura = H - M.t - M.b - 12;
    const g = svgEl("g", {}, svg);
    let unidade;

    if (estado.modo === "pontos") {
      const d = Math.min(faixaPx * 0.92, altura / maior);
      unidade = d;
      let atraso = 0;
      pilhas.forEach(([i, pilha]) => pilha.forEach((p, k) => {
        const c = svgEl("circle", {
          cx: centro(i),
          cy: H - M.b - (k + 0.5) * d,
          r: (d / 2) * 0.86,
          class: p.aluno ? "aluno" : "simulada",
          "data-dica": p.dica,
        }, g);
        if (!estado.vistos.has(p.chave)) {
          estado.vistos.add(p.chave);
          c.classList.add("cai");
          c.style.animationDelay = `${Math.min(atraso, 1800)}ms`;
          atraso += 35;
        }
      }));
    } else {
      const u = altura / maior;
      unidade = u;
      pilhas.forEach(([i, pilha]) => {
        const alunos = pilha.filter((p) => p.aluno);
        const nSim = pilha.length - alunos.length;
        const x0b = centro(i) - faixaPx / 2 + 1;
        const larg = faixaPx - 2;
        const nomes = alunos.map((p) => p.dica.split("\n")[0]);
        const dica = [
          `${fmt(estado.mu + (i - 0.5) * w, 2)} a ${fmt(estado.mu + (i + 0.5) * w, 2)} anos`,
          ...nomes,
          nSim ? `+ ${nSim} simulada${nSim > 1 ? "s" : ""}` : null,
        ].filter(Boolean).join("\n");
        if (alunos.length) {
          svgEl("rect", {
            x: x0b, width: larg, y: H - M.b - alunos.length * u, height: alunos.length * u,
            class: "barra-aluno", "data-dica": dica,
          }, g);
        }
        if (nSim) {
          svgEl("rect", {
            x: x0b, width: larg, y: H - M.b - pilha.length * u, height: nSim * u,
            class: "barra-simulada", "data-dica": dica,
          }, g);
        }
      });
      // no histograma não há queda: os pontos que chegarem já contam como vistos
      for (const p of pts) estado.vistos.add(p.chave);
    }

    if (estado.normal) {
      const ep = epTeorico();
      const fator = pts.length * w * unidade;
      const pdf = (v) => Math.exp(-0.5 * ((v - estado.mu) / ep) ** 2) / (ep * Math.sqrt(2 * Math.PI));
      let caminho = "";
      for (let k = 0; k <= 240; k += 1) {
        const v = x0 + ((x1 - x0) * k) / 240;
        caminho += `${k ? "L" : "M"}${x(v).toFixed(1)},${(H - M.b - fator * pdf(v)).toFixed(1)}`;
      }
      svgEl("path", { d: caminho, class: "normal" }, svg);
    }
  }
  desenharMu(svg, x);

  const alunos = estado.respostas.media.map((r) => r.media);
  const todas = pts.map((p) => p.x);
  const partes = [`<b>${alunos.length}</b> da sala`];
  if (estado.simuladas.length) partes.push(`<b>${estado.simuladas.length}</b> simuladas`);
  if (estado.solto.media && todas.length > 1) {
    const m = media(todas);
    const s = Math.sqrt(todas.reduce((a, v) => a + (v - m) ** 2, 0) / (todas.length - 1));
    partes.push(`média das médias <b>${fmt(m, 2)}</b>`);
    partes.push(`desvio das médias <b>${fmt(s, 2)}</b>`);
    partes.push(`DP/√n = ${fmt(epTeorico(), 2)}`);
  }
  $("#resumo").innerHTML = partes.join(" · ");
  $("#legenda").innerHTML = estado.solto.media
    ? '<span><i style="background:var(--verde)"></i>médias da sala</span>' +
      '<span><i style="background:var(--cinza)"></i>amostras simuladas</span>' +
      '<span><i style="background:var(--marca)"></i>média da base inteira</span>'
    : "";
}

/* ---------- vista 2: os intervalos ---------------------------------------- */

function itensIC() {
  const contem = (r) => r.lo <= estado.mu && estado.mu <= r.hi;
  const alunos = estado.respostas.ic.map((r) => ({
    chave: `ai:${r.login}:${r.lo}:${r.hi}`,
    ...r,
    aluno: true,
    dentro: contem(r),
    dica: `${r.nome}\nde ${fmt(r.lo, 2)} a ${fmt(r.hi, 2)} anos (z = ${fmt(r.z, 2)})`,
  }));
  const sim = estado.simuladosIC.map((r, i) => ({
    chave: `si:${i}`,
    ...r,
    aluno: false,
    dentro: contem(r),
    dica: `amostra simulada\nde ${fmt(r.lo, 2)} a ${fmt(r.hi, 2)} anos`,
  }));
  return [...alunos, ...sim];
}

function desenharIntervalos(svg) {
  const [x0, x1] = eixoDaVista();
  const x = (v) => M.e + ((Math.min(x1, Math.max(x0, v)) - x0) / (x1 - x0)) * (W - M.e - M.d);
  desenharEixo(svg, x0, x1, x, "intervalo de 95% para o tempo médio (anos)");

  const itens = estado.solto.ic ? itensIC() : [];
  const altura = H - M.t - M.b - 12;
  const rh = Math.min(16, altura / Math.max(itens.length, 1));
  const g = svgEl("g", {}, svg);
  itens.forEach((it, k) => {
    const y = M.t + (k + 0.5) * rh;
    const tipo = !it.dentro ? "fora" : it.aluno ? "aluno" : "simulado";
    const grupo = svgEl("g", { "data-dica": it.dica }, g);
    svgEl("line", {
      x1: x(it.lo), x2: x(it.hi), y1: y, y2: y,
      class: `ic-${tipo}`, "stroke-width": Math.max(1, Math.min(!it.dentro ? 5 : 3.5, rh * 0.55)),
      "data-dica": it.dica,
    }, grupo);
    svgEl("circle", {
      cx: x(it.media), cy: y, r: Math.max(1.2, Math.min(4.5, rh * 0.32)),
      class: `ic-ponto-${tipo}`, "data-dica": it.dica,
    }, grupo);
    // alvo invisível e mais grosso, para o mouse achar linhas finas
    svgEl("line", {
      x1: x(it.lo), x2: x(it.hi), y1: y, y2: y, class: "alvo",
      "stroke-width": Math.max(8, rh), "data-dica": it.dica,
    }, grupo);
    if (!estado.vistos.has(it.chave)) {
      estado.vistos.add(it.chave);
      grupo.classList.add("abre");
      grupo.style.animationDelay = `${Math.min(k * 25, 1500)}ms`;
    }
  });
  desenharMu(svg, x);

  const fora = itens.filter((it) => !it.dentro).length;
  const partes = [`<b>${estado.respostas.ic.length}</b> da sala`];
  if (estado.simuladosIC.length) partes.push(`<b>${estado.simuladosIC.length}</b> simulados`);
  if (itens.length) {
    partes.push(
      `<span class="fora">${fora} de ${itens.length} (${fmt((100 * fora) / itens.length, 1)}%)</span> não contêm a média das ${estado.pop.linhas.length.toLocaleString("pt-BR")}`
    );
  }
  $("#resumo").innerHTML = partes.join(" · ");
  $("#legenda").innerHTML = estado.solto.ic
    ? '<span><i style="background:var(--verde)"></i>intervalos da sala</span>' +
      '<span><i style="background:var(--cinza)"></i>simulados</span>' +
      '<span><i style="background:var(--marca)"></i>não contêm a média</span>'
    : "";
}

/* ---------- desenho ---------------------------------------------------------- */

function desenhar() {
  if (!estado.pop) return;
  const svg = $("#svg");
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  $("#titulo").textContent = TITULO[estado.vista];
  $("#duas").classList.toggle("cheia", estado.solto[estado.vista]);
  $("#qr").src = QR[estado.vista];
  $("#endereco").textContent = ENDERECO[estado.vista];
  $("#contador").firstChild.textContent = String(estado.respostas[estado.vista].length);
  $("#b-soltar").textContent = estado.solto[estado.vista] ? "esconder" : "soltar";
  $("#b-modo").hidden = estado.vista !== "media";
  $("#c-normal").parentElement.hidden = estado.vista !== "media";
  $("#b-modo").textContent = estado.modo === "pontos" ? "ver histograma" : "ver pontos";

  if (estado.vista === "media") desenharMedias(svg);
  else desenharIntervalos(svg);
}

/* ---------- simulação ------------------------------------------------------- */

function simular(qtd) {
  for (let i = 0; i < qtd; i += 1) {
    const v = valores(sortear(estado.pop.linhas, AMOSTRA.n));
    if (estado.vista === "media") estado.simuladas.push(media(v));
    else {
      const r = intervalo(v, 1.96);
      estado.simuladosIC.push({ media: r.media, lo: r.lo, hi: r.hi, z: 1.96 });
    }
  }
}

/* ---------- controles --------------------------------------------------------- */

function ligarControles() {
  $("#vista").addEventListener("change", (ev) => {
    estado.vista = ev.target.value;
    atualizar();
  });
  $("#b-soltar").addEventListener("click", () => {
    estado.solto[estado.vista] = !estado.solto[estado.vista];
    if (!estado.solto[estado.vista]) {
      // esconder e soltar de novo repete a queda: é o jeito de mostrar outra vez
      estado.vistos.clear();
    }
    desenhar();
  });
  $("#b-modo").addEventListener("click", () => {
    estado.modo = estado.modo === "pontos" ? "barras" : "pontos";
    desenhar();
  });
  $("#c-normal").addEventListener("change", (ev) => {
    estado.normal = ev.target.checked;
    desenhar();
  });
  $("#b-mais").addEventListener("click", () => {
    estado.solto[estado.vista] = true;
    simular(30);
    desenhar();
  });
  $("#b-sem-simuladas").addEventListener("click", () => {
    if (estado.vista === "media") estado.simuladas = [];
    else estado.simuladosIC = [];
    desenhar();
  });
  // Dois cliques em três segundos, e não uma janela de confirmação: janela
  // modal no meio da aula trava a tela projetada.
  $("#b-apagar").addEventListener("click", async () => {
    const agora = Date.now();
    if (agora - estado.confirmarApagar > 3000) {
      estado.confirmarApagar = agora;
      recado("clique de novo para apagar as respostas desta etapa", true);
      return;
    }
    estado.confirmarApagar = 0;
    try {
      await pedir("/amostra/limpar", { method: "POST", body: JSON.stringify({ etapa: estado.vista }) });
      estado.respostas[estado.vista] = [];
      estado.vistos.clear();
      recado("respostas apagadas");
      desenhar();
    } catch (erro) {
      recado(String(erro.message || erro), true);
    }
  });
  $("#b-tema").addEventListener("click", () => {
    const escuro = document.documentElement.dataset.tema !== "escuro";
    document.documentElement.dataset.tema = escuro ? "escuro" : "";
    $("#b-tema").textContent = escuro ? "claro" : "escuro";
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") $("#controle").classList.toggle("recolhida");
  });
  $("#senha").addEventListener("change", atualizar);

  const dica = $("#dica");
  const svg = $("#svg");
  svg.addEventListener("mousemove", (ev) => {
    const alvo = ev.target.closest("[data-dica]");
    if (!alvo) {
      dica.hidden = true;
      return;
    }
    dica.textContent = alvo.getAttribute("data-dica");
    dica.hidden = false;
    dica.style.left = `${ev.clientX + 16}px`;
    dica.style.top = `${ev.clientY + 16}px`;
  });
  svg.addEventListener("mouseleave", () => { dica.hidden = true; });
}

/* ---------- início ---------------------------------------------------------------- */

async function iniciar() {
  try {
    const s = sessionStorage.getItem("cdad2-amostra-senha");
    if (s) $("#senha").value = s;
  } catch { /* sem armazenamento */ }
  ligarControles();
  $("#vista").value = estado.vista;
  try {
    estado.pop = await carregarPopulacao();
  } catch (erro) {
    recado(String(erro.message || erro), true);
    return;
  }
  const v = valores(estado.pop.linhas);
  estado.mu = media(v);
  estado.sigma = desvioPopulacional(v);
  desenhar();
  await atualizar();
  setInterval(atualizar, INTERVALO_MS);
}

iniciar();
