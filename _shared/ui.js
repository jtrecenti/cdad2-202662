/* ==========================================================================
   Pequenos utilitários de interface. Sem framework, de propósito: os apps
   precisam abrir rápido em qualquer máquina da sala e sobreviver a um deploy
   estático no GitHub Pages.
   ========================================================================== */

/** el("div.classe", {attrs}, [filhos]) */
export function el(seletor, atributos = {}, filhos = []) {
  const [tag, ...classes] = String(seletor).split(".");
  const nó = document.createElement(tag || "div");
  if (classes.length) nó.className = classes.join(" ");
  for (const [k, v] of Object.entries(atributos || {})) {
    if (v == null || v === false) continue;
    if (k === "class") nó.className = [nó.className, v].filter(Boolean).join(" ");
    else if (k === "texto") nó.textContent = v;
    else if (k === "html") nó.innerHTML = v;
    else if (k === "dataset") Object.assign(nó.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") {
      nó.addEventListener(k.slice(2).toLowerCase(), v);
    } else nó.setAttribute(k, v === true ? "" : v);
  }
  for (const filho of [].concat(filhos)) {
    if (filho == null || filho === false) continue;
    nó.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return nó;
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export function limpar(nó) {
  while (nó.firstChild) nó.removeChild(nó.firstChild);
  // `append(null)` escreve a string "null" na tela. Como a maior parte do código
  // monta listas com condicionais (`condicao ? nó : null`), o append passa a
  // ignorar nulos: é onde o "null" aparecia depois do feedback.
  const originalAppend = nó.append.bind(nó);
  nó.append = (...filhos) => originalAppend(...filhos.filter((f) => f != null && f !== false));
  return nó;
}

/** Escapa texto para interpolar em HTML. */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

/* ---------- topo e passos ------------------------------------------------ */

export function montarTopo({ exercicio, titulo, aula, direita = [] }) {
  const alvo = document.body;
  const topo = el("header.topo", {}, [
    el("div.topo-interno", {}, [
      el("img.logo", {
        src: "../_shared/img/logo-insper-branco.png",
        alt: "Insper",
      }),
      el("div", {}, [
        el("div.trilha", { texto: `CDAD II · 2026/2 · ${exercicio}${aula ? " · " + aula : ""}` }),
        el("h1", { texto: titulo }),
      ]),
      el("div.topo-dir", {}, direita),
    ]),
  ]);
  alvo.prepend(topo);
  return topo;
}

export function montarPassos(nomes) {
  const barra = el("nav.passos", { "aria-label": "etapas" },
    nomes.map((n, i) => el("span", { texto: `${i + 1}. ${n}`, dataset: { passo: String(i) } })));
  const topo = $(".topo");
  if (topo) topo.after(barra);
  else document.body.prepend(barra);
  return {
    ir(indice) {
      $$("span", barra).forEach((s, i) => {
        s.classList.toggle("atual", i === indice);
        s.classList.toggle("feito", i < indice);
      });
    },
  };
}

/* ---------- avisos ------------------------------------------------------- */

export function aviso(tipo, titulo, texto) {
  return el(`div.aviso.${tipo}`, {}, [
    titulo ? el("strong", { texto: titulo }) : null,
    texto ? el("span", { html: paragrafos(texto) }) : null,
  ]);
}

let caixaToast;
export function toast(msg, ms = 2600) {
  if (!caixaToast) {
    caixaToast = el("div", {
      style:
        "position:fixed;left:50%;bottom:1.4rem;transform:translateX(-50%);z-index:10050;" +
        "display:flex;flex-direction:column;gap:.4rem;align-items:center;pointer-events:none",
    });
    document.body.append(caixaToast);
  }
  const nó = el("div", {
    texto: msg,
    style:
      "background:#1a1a1a;color:#fff;padding:.55rem 1rem;border-radius:3px;font-size:.85rem;" +
      "box-shadow:0 6px 20px -8px rgba(0,0,0,.6);opacity:0;transition:opacity .18s",
  });
  caixaToast.append(nó);
  requestAnimationFrame(() => (nó.style.opacity = "1"));
  setTimeout(() => {
    nó.style.opacity = "0";
    setTimeout(() => nó.remove(), 250);
  }, ms);
}

/* ---------- texto -------------------------------------------------------- */

/** Markdown mínimo: **negrito**, *itálico*, `código`, listas e parágrafos. */
export function paragrafos(texto) {
  const linhas = String(texto ?? "").split(/\n/);
  let html = "";
  let emLista = false;
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  for (const linha of linhas) {
    const item = linha.match(/^\s*[-*•]\s+(.*)$/);
    if (item) {
      if (!emLista) {
        html += "<ul>";
        emLista = true;
      }
      html += `<li>${inline(item[1])}</li>`;
      continue;
    }
    if (emLista) {
      html += "</ul>";
      emLista = false;
    }
    if (linha.trim()) html += `<p>${inline(linha)}</p>`;
  }
  if (emLista) html += "</ul>";
  return html;
}

export function contarPalavras(texto) {
  return String(texto || "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Marca no texto os termos do glossário, com a definição no tooltip.
 * `glossario` é uma lista de {termo, definicao}. Devolve um fragmento.
 *
 * O aluno está no 4º semestre: ele já viu esbulho e dosimetria em aula, mas
 * não necessariamente lembra. Explicar ali, no lugar onde a palavra aparece,
 * é melhor do que mandar procurar.
 */
export function comGlossario(texto, glossario = []) {
  const frag = document.createDocumentFragment();
  const termos = (glossario || []).filter((g) => g?.termo);
  if (!termos.length) {
    frag.append(String(texto ?? ""));
    return frag;
  }
  const padrao = new RegExp(
    `(${termos.map((g) => g.termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi"
  );
  const definicao = (palavra) =>
    termos.find((g) => g.termo.toLowerCase() === palavra.toLowerCase())?.definicao ??
    termos.find((g) => palavra.toLowerCase().startsWith(g.termo.toLowerCase()))?.definicao;

  let fim = 0;
  const bruto = String(texto ?? "");
  for (const achado of bruto.matchAll(padrao)) {
    const def = definicao(achado[0]);
    if (!def) continue;
    frag.append(bruto.slice(fim, achado.index));
    frag.append(el("span.termo", { texto: achado[0], title: def }));
    fim = achado.index + achado[0].length;
  }
  frag.append(bruto.slice(fim));
  return frag;
}

/**
 * Painel "o que a lei diz sobre este tema", recolhível, com o glossário.
 *
 * A turma está no 4º semestre e já viu o direito material de todos os temas,
 * mas voltar a uma matéria que ficou dois semestres para trás é mais fácil com
 * os dispositivos à mão. Os projetos 1 e 4 usam o mesmo painel.
 */
export function fichaJuridica(tema, { aberto = false } = {}) {
  if (!tema?.base_legal && !tema?.glossario?.length) return null;
  const corpo = el("div.corpo-ficha");
  if (tema.base_legal) {
    corpo.append(el("p", {}, [comGlossario(tema.base_legal, tema.glossario)]));
  }
  if (tema.glossario?.length) {
    corpo.append(
      el("span.rotulo", { texto: "glossário do tema" }),
      el("dl.glossario", {}, tema.glossario.flatMap((g) => [
        el("dt", { texto: g.termo }),
        el("dd", { texto: g.definicao }),
      ]))
    );
  }
  const ficha = el("details.ficha", { style: "margin-top:.6rem" }, [
    el("summary", { texto: "O que a lei diz sobre este tema" }),
    corpo,
  ]);
  if (aberto) ficha.open = true;
  return ficha;
}

/* ---------- tabelas e arquivos ------------------------------------------ */

export function tabela(colunas, linhas, { numericas = [] } = {}) {
  return el("div.rolagem", {}, [
    el("table", {}, [
      el("thead", {}, [el("tr", {}, colunas.map((c) => el("th", { texto: c })))]),
      el(
        "tbody",
        {},
        linhas.map((linha) =>
          el(
            "tr",
            {},
            colunas.map((c) =>
              el(numericas.includes(c) ? "td.num" : "td", {
                texto: linha[c] == null || linha[c] === "" ? "—" : String(linha[c]),
              })
            )
          )
        )
      ),
    ]),
  ]);
}

export function paraCSV(colunas, linhas) {
  const campo = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [colunas.join(","), ...linhas.map((l) => colunas.map((c) => campo(l[c])).join(","))].join(
    "\n"
  );
}

/**
 * `bom: true` só para CSV, senão o Excel abre acentos errados.
 *
 * Antes de baixar, avisa os guardrails: a janela de salvamento do navegador
 * rouba o foco da aba, e isso era registrado como se o aluno tivesse saído para
 * outro programa. Baixar o próprio trabalho não é violação.
 */
export function baixar(nome, conteudo, tipo = "text/plain;charset=utf-8", bom = false) {
  window.dispatchEvent(new CustomEvent("cdad:acao-legitima", { detail: { ms: 20000, motivo: `download ${nome}` } }));
  const partes = bom ? ["﻿", conteudo] : [conteudo];
  const url = URL.createObjectURL(new Blob(partes, { type: tipo }));
  const a = el("a", { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- modal -------------------------------------------------------- */

/**
 * Janela sobreposta, usada para texto largo (sentença inteira), registro de
 * eventos e confirmação antes de entregar. Fecha no Esc e no clique fora.
 */
export function modal({ titulo, conteudo, leitura = false, acoes = [] }) {
  const corpo = el(`div.conteudo${leitura ? ".leitura" : ""}`);
  corpo.append(...[].concat(conteudo).filter(Boolean));

  const fechar = () => {
    caixa.remove();
    document.removeEventListener("keydown", aoTeclar);
  };
  const aoTeclar = (e) => {
    if (e.key === "Escape") fechar();
  };

  const quadro = el("div.quadro", {}, [
    el("header", {}, [
      el("h3", { texto: titulo }),
      el("button.secundario", { type: "button", texto: "fechar", onclick: fechar }),
    ]),
    corpo,
    acoes.length ? el("div.acoes", { style: "padding:0 1.2rem 1.2rem;margin:0" }, acoes) : null,
  ]);

  const caixa = el("div.modal", { role: "dialog", "aria-modal": "true" }, [quadro]);
  caixa.addEventListener("click", (e) => {
    if (e.target === caixa) fechar();
  });
  document.addEventListener("keydown", aoTeclar);
  document.body.append(caixa);
  return { fechar, quadro };
}

/* ---------- diversos ---------------------------------------------------- */

export function agora() {
  return new Date().toISOString();
}

/** Embaralhamento determinístico a partir de uma semente textual (ex.: e-mail). */
export function embaralharCom(semente, lista) {
  let h = 2166136261;
  for (const c of String(semente)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1e6) / 1e6;
  };
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

export async function sha256(texto) {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function formatar(n, casas = 3) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function pct(n, casas = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`;
}
