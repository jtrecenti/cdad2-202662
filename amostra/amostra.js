/* ==========================================================================
   Amostra da sala (aula 11) · o que o celular e o painel compartilham

   O celular sorteia a amostra do aluno a partir do login, e o painel sorteia
   as amostras simuladas do botão "+30". As duas coisas precisam da mesma base,
   do mesmo tamanho de amostra e das mesmas contas, e é por isso que moram aqui.

   Sobre a base: é a das Câmaras Criminais do TJSP (pesquisa da ABJ), a mesma
   dos projetos 2, 5 e 8, com as 8.505 linhas que sobram depois da limpeza de
   scripts/preparar_dados.py. Na aula ela é a população: a pergunta é sobre
   esses 8.505, e não sobre todos os recursos do TJSP (a base já é um recorte).
   O arquivo é público, então um aluno curioso consegue calcular o parâmetro:
   "em teoria" ninguém tem acesso, e a atividade não vale nota.

   Por que 100, e não 30: o tempo é muito torto (assimetria 2,2, máximo de 21
   anos). Com 30, o intervalo de 95% com z = 1,96 acerta só uns 92% das vezes,
   e o painel parecia ter bug; com 100, acerta uns 94%. E a raiz de 100 é 10,
   o que deixa a conta do erro-padrão de cabeça.
   ========================================================================== */

export const AMOSTRA = {
  n: 100,
  // Muda a semente de todo mundo de uma vez. Trocar entre semestres, para a
  // amostra de um login não se repetir de uma turma para outra.
  sal: "cdad2-2026-2-aula11",
};

let cache = null;

export async function carregarPopulacao() {
  if (!cache) {
    const r = await fetch("populacao.json");
    if (!r.ok) throw new Error(`não consegui carregar a base (${r.status})`);
    cache = await r.json();
  }
  return cache;
}

/** Minúsculas, sem espaço e sem o domínio, se a pessoa colou o e-mail inteiro. */
export function normalizarLogin(texto) {
  const v = String(texto || "").trim().toLowerCase().replace(/@.*$/, "");
  return /^[a-z0-9._-]{2,40}$/.test(v) ? v : null;
}

/* ---------- sorteio determinístico --------------------------------------- */

/*
 * cyrb53 transforma o login num número, e mulberry32 transforma o número numa
 * sequência de sorteios. Os dois cabem em dez linhas e não dependem de
 * biblioteca: o mesmo login dá a mesma amostra em qualquer celular, na etapa
 * da média e na do intervalo.
 */
function cyrb53(texto, semente = 0) {
  let h1 = 0xdeadbeef ^ semente;
  let h2 = 0x41c6ce57 ^ semente;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sementeDoLogin(login) {
  return cyrb53(`${AMOSTRA.sal}|${login}`) % 4294967296;
}

/**
 * Sorteia `n` linhas sem reposição (Fisher-Yates parcial). Sem semente, usa
 * Math.random: é o caso das amostras simuladas do painel.
 */
export function sortear(linhas, n, semente = null) {
  const aleatorio = semente == null ? Math.random : mulberry32(semente);
  const idx = Array.from(linhas.keys());
  for (let i = 0; i < n; i += 1) {
    const j = i + Math.floor(aleatorio() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).map((i) => linhas[i]);
}

/* ---------- contas -------------------------------------------------------- */

export const valores = (linhas) => linhas.map((l) => l[2]);

export function media(v) {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Desvio-padrão da amostra, com n - 1, como o `.std()` do pandas. */
export function desvio(v) {
  const m = media(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
}

/** Desvio-padrão da população, com n: é o sigma que o painel usa. */
export function desvioPopulacional(v) {
  const m = media(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length);
}

export function intervalo(v, z = 1.96) {
  const m = media(v);
  const s = desvio(v);
  const ep = s / Math.sqrt(v.length);
  return { media: m, dp: s, ep, lo: m - z * ep, hi: m + z * ep, z };
}

export function fmt(x, casas = 2) {
  return Number(x).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}
