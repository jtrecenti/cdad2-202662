/* ==========================================================================
   Modo de simulação do LLM (?fakellm=1).

   Serve para dois usos legítimos:
   - testar o app (interface, travas, submissão) sem gastar chamada de API;
   - dar aula com o app funcionando caso a API esteja fora do ar.

   As respostas são construídas a partir do próprio prompt, então têm a forma
   certa e conteúdo obviamente falso. Todo texto simulado começa com
   "[SIMULADO]" para ninguém confundir com feedback de verdade.
   ========================================================================== */

const MARCA = "[SIMULADO]";

function idsDecisoes(prompt) {
  return [...prompt.matchAll(/^### (\S+)$/gm)].map((m) => m[1]);
}

function variaveis(prompt) {
  return [...prompt.matchAll(/^- (\w+) \(tipo: ([\w_]+); papel: ([\w_]+)\)/gm)].map((m) => ({
    nome: m[1],
    tipo: m[2],
    papel: m[3],
  }));
}

function criteriosDaRubrica(prompt) {
  return [...prompt.matchAll(/^\[([\w_]+)\] (.+?) \(peso/gm)].map((m) => m[1]);
}

function valorFalso(v, i) {
  if (v.papel === "identificacao" || v.tipo === "identificador") return null; // preenchido pelo app
  // a cada 5 casos o "modelo" devolve o número formatado, como acontece de
  // verdade. É assim que se testa a coerção e o aviso de valor fora do tipo.
  if (v.tipo === "numerica_continua") {
    const valor = (1000 + i * 137) % 9000;
    return i % 5 === 0 ? `R$ ${valor.toLocaleString("pt-BR")},00` : valor;
  }
  if (v.tipo === "numerica_discreta") return i % 4;
  if (v.tipo === "categorica_binaria") {
    // de vez em quando sai com a acentuação estragada ("N'ao"), que é o que o
    // modelo leve faz de verdade. Serve para testar a uniformização de grafia.
    if (i % 7 === 0) return "N'ao";
    return i % 3 === 0 ? "não" : "sim";
  }
  if (i % 7 === 0) return "não informado";
  return ["categoria A", "categoria B", "categoria C"][i % 3];
}

/**
 * O ex01 faz uma chamada por sentença, então a simulação devolve
 * {id, valores}, o mesmo formato pedido no prompt de extração.
 */
function extrair(prompt) {
  const caso = prompt.match(/^SENTEN[ÇC]A \(id ([^,]+),/m);
  const id = caso ? caso[1].trim() : idsDecisoes(prompt)[0] || "D001";
  const semente = [...id].reduce((soma, c) => soma + c.charCodeAt(0), 0);
  const vars = variaveis(prompt);
  return {
    id,
    valores: Object.fromEntries(
      vars.map((v, j) => [v.nome, v.papel === "identificacao" ? id : valorFalso(v, semente + j)])
    ),
  };
}

function feedback(prompt) {
  const ids = criteriosDaRubrica(prompt);
  const niveis = ["parcial", "adequado", "insuficiente", "adequado"];
  return {
    criterios: ids.map((id, i) => ({
      id,
      nivel: niveis[i % niveis.length],
      comentario: `${MARCA} comentário de teste para o critério ${id}. Nenhum modelo foi chamado.`,
      evidencia: `${MARCA} trecho fictício`,
      sugestao: `${MARCA} pergunta que levaria o grupo a revisar ${id}.`,
    })),
    resumo: `${MARCA} este feedback é falso, gerado localmente para testar a interface.`,
    proximo_passo: `${MARCA} rode sem ?fakellm=1 para receber o feedback de verdade.`,
    pontos_fortes: [`${MARCA} ponto forte de exemplo`],
  };
}

function correcaoFolha(prompt) {
  const ids = [...prompt.matchAll(/^Q(\d+)/gm)].map((m) => m[1]);
  const lista = ids.length ? ids : ["1", "2", "3"];
  return {
    aluno: { nome: `${MARCA} Aluno de Teste`, email: "teste@al.insper.edu.br" },
    respostas: lista.map((id) => ({ questao: id, valor_lido: "0,1234", confianca: "media" })),
    observacoes: `${MARCA} leitura simulada, nenhuma imagem foi analisada.`,
  };
}

/** Devolve {texto, dados} imitando a resposta do gateway. */
export function simular({ tarefa, usuario }) {
  const prompt = String(usuario || "");
  let dados;
  if (tarefa === "ex01_extrair") dados = extrair(prompt);
  else if (tarefa === "ex03_corrigir") dados = correcaoFolha(prompt);
  else dados = feedback(prompt);
  return {
    texto: JSON.stringify(dados),
    dados,
    modelo: "simulado",
    uso: null,
  };
}
