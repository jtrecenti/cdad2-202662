/* ==========================================================================
   Simulador de estratégia de acordo · o modelo

   Adaptação do app em Streamlit da aula 20 de 2024 (main-cdad2,
   apostilas/10-corporativo/app_acordo.py). O que mudou:

   - cada processo recebe no máximo UMA proposta (no original, quem recusava
     voltava para a fila todo mês, o que inflava os acordos);
   - o orçamento vale só para os acordos (no original, as condenações também
     consumiam o orçamento e travavam a estratégia);
   - as condenações e os acordos são atualizados no tempo por uma taxa anual
     (correção mais juros; desde a Lei 14.905/2024, IPCA mais juros pela Selic
     menos o IPCA, o que na soma fica perto da Selic);
   - o autor pode saber mais do que o modelo sobre o próprio caso (seleção
     adversa): quem ganharia aceita menos, quem perderia aceita mais.

   Tudo aqui é simulado. Nenhum dado de processo real entra neste arquivo.
   ========================================================================== */

export const HORIZONTE = 60; // meses
export const N_PROCESSOS = 300;

/* Gerador com semente (mulberry32): a mesma semente dá a mesma carteira e os
   mesmos sorteios, então mexer num controle muda só o que ele controla. */
export function gerador(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A carteira: para cada processo, o valor em risco (o que se paga se perder),
   a probabilidade de perda que o modelo preditivo dá, e o mês em que sai a
   decisão final se ninguém fizer acordo. */
export function carteira(semente) {
  const r = gerador(semente);
  const processos = [];
  for (let i = 0; i < N_PROCESSOS; i++) {
    processos.push({
      id: `P${String(i + 1).padStart(3, "0")}`,
      valor: 5000 + r() * 75000,
      p: 0.1 + r() * 0.8,
      mes: Math.ceil(12 + r() * 48),
    });
  }
  return processos;
}

/* Chance de a outra parte aceitar uma proposta de `alcada` (fração do valor
   em risco). `meio` é a alçada em que metade aceita; `inclinacao` diz quão
   rápido a chance sobe em volta dela. */
export function aceite(alcada, meio, inclinacao) {
  return 1 / (1 + Math.exp(-inclinacao * (alcada - meio)));
}

/* Uma rodada da carteira inteira, com e sem a estratégia, usando os MESMOS
   sorteios de resultado nas duas: a diferença entre elas é só a estratégia. */
function rodada(proc, alvo, p, r) {
  const n = proc.length;
  const fator = (m) => Math.pow(1 + p.juros, m / 12);
  const perde = new Array(n);
  const sorteioAceite = new Array(n);
  for (let i = 0; i < n; i++) {
    perde[i] = r() < proc[i].p;
    sorteioAceite[i] = r();
  }

  const sem = new Float64Array(HORIZONTE + 1);
  const com = new Float64Array(HORIZONTE + 1);
  for (let i = 0; i < n; i++) {
    if (perde[i]) sem[proc[i].mes] += proc[i].valor * fator(proc[i].mes);
  }

  // Quem o autor sabe que ganharia exige mais; quem sabe que perderia, menos.
  const desloc = 0.25 * p.informacao;
  const fechado = new Uint8Array(n);
  let gastoAcordo = 0;
  let acordos = 0;
  let fila = 0;
  for (let m = 1; m <= HORIZONTE; m++) {
    let tentativas = 0;
    while (fila < alvo.length && tentativas < p.tentativas) {
      const i = alvo[fila++];
      if (proc[i].mes <= m) continue; // já decidido: não há o que propor
      tentativas++;
      const meio = p.meio + (perde[i] ? desloc : -desloc);
      if (sorteioAceite[i] < aceite(p.alcada, meio, p.inclinacao)) {
        const v = p.alcada * proc[i].valor * fator(m);
        if (gastoAcordo + v <= p.orcamento) {
          gastoAcordo += v;
          com[m] += v;
          fechado[i] = 1;
          acordos++;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (perde[i] && !fechado[i]) com[proc[i].mes] += proc[i].valor * fator(proc[i].mes);
  }
  return { sem, com, acordos, gastoAcordo };
}

/* Média de muitas rodadas. Devolve as curvas acumuladas mês a mês e os
   marcos que a aula usa: o vale (break-even), o payback e a economia final. */
export function simular(proc, p, sementeSorteios = 2026) {
  const alvo = proc
    .map((x, i) => i)
    .filter((i) => proc[i].p >= p.pmin)
    .sort((a, b) => proc[b].p - proc[a].p);
  const r = gerador(sementeSorteios);
  const sem = new Float64Array(HORIZONTE + 1);
  const com = new Float64Array(HORIZONTE + 1);
  let acordos = 0;
  let gasto = 0;
  for (let s = 0; s < p.simulacoes; s++) {
    const x = rodada(proc, alvo, p, r);
    for (let m = 1; m <= HORIZONTE; m++) {
      sem[m] += x.sem[m];
      com[m] += x.com[m];
    }
    acordos += x.acordos;
    gasto += x.gastoAcordo;
  }
  const meses = [];
  let aSem = 0;
  let aCom = 0;
  for (let m = 1; m <= HORIZONTE; m++) {
    aSem += sem[m] / p.simulacoes;
    aCom += com[m] / p.simulacoes;
    meses.push({ mes: m, sem: aSem, com: aCom, economia: aSem - aCom });
  }
  let vale = meses[0];
  for (const x of meses) if (x.economia < vale.economia) vale = x;
  const payback = vale.economia < 0
    ? meses.find((x) => x.mes > vale.mes && x.economia >= 0) || null
    : null;
  return {
    meses,
    alvo: alvo.map((i) => proc[i]),
    acordos: acordos / p.simulacoes,
    gastoAcordo: gasto / p.simulacoes,
    vale,
    payback,
    final: meses[meses.length - 1].economia,
  };
}
