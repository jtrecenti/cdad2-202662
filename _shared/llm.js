/* ==========================================================================
   Cliente do gateway de LLM.

   As chaves das APIs NUNCA ficam no app (é um site estático: qualquer aluno
   leria o código-fonte). Quem guarda as chaves é o Worker Cloudflare em
   ../../proxy, que também: aceita só as tarefas cadastradas, limita o tamanho
   do pedido, limita a taxa por IP e confere a origem.

   Modelos: "simples" -> gpt-4.1-mini (extração/classificação/correção)
            "complexo" -> gemini (feedback pela rubrica, leitura de imagem)
   ========================================================================== */

import { CONFIG } from "./config.js";
import { SESSAO } from "./firebase.js";

/* ---------- fila e espera -------------------------------------------------
   A sala inteira aperta o mesmo botão no mesmo minuto, e cada grupo dispara dez
   leituras seguidas. Sem freio, a rajada bate no limite do gateway (e no da API
   do modelo) e o aluno vê "muitos pedidos em pouco tempo" no meio da aula.

   Duas medidas, as duas do lado do aluno:
   - uma fila só por aba: os pedidos saem espaçados, nunca dez no mesmo instante;
   - espera crescente com sorteio (jitter) quando vem 429 ou 5xx. O sorteio é o
     que impede que trinta navegadores repitam todos no mesmo instante.
   -------------------------------------------------------------------------- */

const ESPACO_MINIMO_MS = 250;
const ESPERA_MAXIMA_MS = 20000;

let fila = Promise.resolve();
let ultimoPedidoEm = 0;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera crescente com sorteio: 1s, 2s, 4s, 8s, cada uma com ±30%. */
function esperaDoRecuo(tentativa, cabecalhoRetryAfter) {
  const pedida = Number(cabecalhoRetryAfter) * 1000;
  const base = Number.isFinite(pedida) && pedida > 0 ? pedida : 1000 * 2 ** tentativa;
  const sorteio = 0.7 + Math.random() * 0.6;
  return Math.min(Math.round(base * sorteio), ESPERA_MAXIMA_MS);
}

/** Põe a chamada na fila da aba e garante o espaço mínimo entre pedidos. */
function naFila(tarefa) {
  const minhaVez = fila.then(async () => {
    const desdeOUltimo = Date.now() - ultimoPedidoEm;
    if (desdeOUltimo < ESPACO_MINIMO_MS) await dormir(ESPACO_MINIMO_MS - desdeOUltimo);
    ultimoPedidoEm = Date.now();
  });
  // a fila não pode quebrar se uma chamada falhar
  fila = minhaVez.catch(() => {});
  return minhaVez;
}

export class ErroLLM extends Error {
  constructor(mensagem, status, detalhe) {
    super(mensagem);
    this.name = "ErroLLM";
    this.status = status;
    this.detalhe = detalhe;
  }
}

/**
 * chamar({ tarefa, modelo, sistema, usuario, json, esquema, imagens, maxTokens })
 * Devolve { texto, dados, modelo, uso }. `dados` só vem quando json = true.
 */
export async function chamar({
  tarefa,
  modelo = CONFIG.modelos.simples,
  sistema,
  usuario,
  json = false,
  esquema = null,
  imagens = null,
  maxTokens = 1800,
  temperatura = 0.2,
  tentativas = 5,
  aoEsperar = null,
} = {}) {
  if (!tarefa) throw new ErroLLM("tarefa não informada", 0);

  // ?fakellm=1: resposta local com a forma certa e conteúdo falso, para testar
  // a interface sem gastar chamada de API.
  if (CONFIG.simularLLM) {
    const { simular } = await import("./simulacoes.js");
    await new Promise((r) => setTimeout(r, 500));
    return simular({ tarefa, usuario });
  }

  // O aluno escreve com pressa e frequentemente sem acento; o modelo imita o
  // registro do que recebe e devolve feedback sem acentuação, o que fica ruim de
  // ler e passa a impressão de descuido. A instrução no sistema não bastou: aqui
  // ela vai no fim do pedido, que é a posição mais próxima da geração.
  const usuarioFinal =
    tarefa.includes("feedback") || tarefa.includes("corrigir")
      ? `${usuario}\n\nIMPORTANTE: escreva a sua resposta em português do Brasil com ACENTUAÇÃO ` +
        "correta (variável, análise, hipótese, você, não, método), mesmo que o texto do aluno " +
        "esteja sem acento."
      : usuario;

  const corpo = {
    tarefa,
    modelo,
    sistema,
    usuario: usuarioFinal,
    json,
    esquema,
    imagens,
    max_tokens: maxTokens,
    temperatura,
    turma: CONFIG.turma,
    // o gateway conta os pedidos por sessão, e não só por IP: a sala toda sai
    // pelo mesmo IP da rede do Insper
    sessao: SESSAO,
  };

  let ultimoErro;
  for (let i = 0; i < tentativas; i += 1) {
    if (i > 0) {
      const espera = esperaDoRecuo(i - 1, ultimoErro?.retryAfter);
      aoEsperar?.({ tentativa: i + 1, de: tentativas, esperaMs: espera, erro: ultimoErro });
      await dormir(espera);
    }
    await naFila(tarefa);
    try {
      const resposta = await fetch(`${CONFIG.proxy}/llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const texto = await resposta.text();
      let dados = null;
      try {
        dados = JSON.parse(texto);
      } catch {
        /* resposta não-JSON */
      }
      if (!resposta.ok) {
        const msg = dados?.erro || `falha no gateway (HTTP ${resposta.status})`;
        // 4xx é problema do pedido: repetir não resolve
        if (resposta.status >= 400 && resposta.status < 500 && resposta.status !== 429) {
          throw new ErroLLM(msg, resposta.status, dados);
        }
        ultimoErro = new ErroLLM(msg, resposta.status, dados);
        // o gateway diz em quantos segundos vale a pena voltar
        ultimoErro.retryAfter = resposta.headers.get("Retry-After");
      } else {
        // Pedimos JSON e não veio: isso acontece, por exemplo, quando a URL do
        // gateway está errada e algum intermediário devolve HTTP 200 com uma
        // página de erro. Sem este erro explícito, o app seguia com a tabela
        // vazia como se tudo tivesse dado certo.
        if (json && !dados?.dados) {
          const erro = new ErroLLM(
            "o servidor de avaliação respondeu algo inesperado (não era o JSON esperado). " +
              "Verifique a URL do gateway em _shared/config.js e avise o professor.",
            resposta.status,
            texto.slice(0, 300)
          );
          erro.fatal = true; // repetir não conserta configuração errada
          throw erro;
        }
        return {
          texto: dados?.texto ?? texto,
          dados: dados?.dados ?? null,
          modelo: dados?.modelo ?? modelo,
          uso: dados?.uso ?? null,
        };
      }
    } catch (erro) {
      // 4xx que não é 429 é problema do pedido: repetir não resolve
      if (erro?.fatal) throw erro;
      if (erro instanceof ErroLLM && erro.status >= 400 && erro.status < 500 && erro.status !== 429) {
        throw erro;
      }
      ultimoErro = erro;
    }
  }

  if (ultimoErro instanceof ErroLLM && ultimoErro.status === 429) {
    throw new ErroLLM(
      `o servidor está atendendo muita gente ao mesmo tempo e não abriu vaga depois de ` +
        `${tentativas} tentativas. Espere um minuto e clique de novo: o que já foi lido não se perde.`,
      429,
      ultimoErro.detalhe
    );
  }
  throw ultimoErro instanceof ErroLLM
    ? ultimoErro
    : new ErroLLM(
        "não consegui falar com o servidor de avaliação. Verifique a internet e tente de novo.",
        0,
        String(ultimoErro)
      );
}

/** Monta o texto de uma rubrica (JSON) para entrar no prompt. */
export function rubricaEmTexto(rubrica) {
  const linhas = [`RUBRICA: ${rubrica.titulo}`];
  if (rubrica.instrucoes) linhas.push(rubrica.instrucoes);
  linhas.push(
    "\nESCALA (use exatamente estes três níveis, sem inventar outros):\n" +
      "- insuficiente: não atende (nota 0)\n" +
      "- abaixo_do_esperado: atende em parte (nota 0,5)\n" +
      "- esperado: atende (nota 1,0)"
  );
  for (const c of rubrica.criterios) {
    linhas.push(
      `\n[${c.id}] ${c.nome}\n` +
        `  O que avaliar: ${c.descricao}` +
        (c.niveis
          ? "\n" +
            Object.entries(c.niveis)
              .map(([nivel, texto]) => `  - ${nivel}: ${texto}`)
              .join("\n")
          : "") +
        (c.penalizar ? `\n  Penalizar explicitamente: ${c.penalizar}` : "")
    );
  }
  if (rubrica.observacoes) linhas.push(`\nOBSERVAÇÕES: ${rubrica.observacoes}`);
  return linhas.join("\n");
}

/**
 * Acha o critério da rubrica correspondente ao id que o modelo devolveu.
 *
 * O modelo às vezes traduz ou encurta o id ("consonance" em vez de
 * "consonancia"). Sem tolerância, a interface mostrava o id cru em vez do nome
 * do critério. A busca vai do exato ao aproximado, e devolve null se nada casar.
 */
export function criterioDaRubrica(rubrica, id) {
  if (!rubrica?.criterios || !id) return null;
  const normalizar = (s) =>
    String(s)
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const alvo = normalizar(id);
  return (
    rubrica.criterios.find((c) => c.id === id) ||
    rubrica.criterios.find((c) => normalizar(c.id) === alvo) ||
    rubrica.criterios.find(
      (c) => normalizar(c.id).startsWith(alvo.slice(0, 6)) || alvo.startsWith(normalizar(c.id).slice(0, 6))
    ) ||
    null
  );
}

/** Esquema de saída comum a todos os feedbacks por rubrica. */
export const ESQUEMA_FEEDBACK = {
  type: "object",
  required: ["criterios", "resumo", "proximo_passo"],
  properties: {
    criterios: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "nivel", "comentario"],
        properties: {
          id: { type: "string" },
          nivel: { type: "string", enum: ["insuficiente", "abaixo_do_esperado", "esperado"] },
          comentario: { type: "string" },
          evidencia: { type: "string" },
          sugestao: { type: "string" },
        },
      },
    },
    resumo: { type: "string" },
    proximo_passo: { type: "string" },
    pontos_fortes: { type: "array", items: { type: "string" } },
  },
};

export const SISTEMA_FEEDBACK = [
  "Você é monitor de uma disciplina de graduação em Direito sobre ciência de dados",
  "(Insper, CDAD II). Os alunos estão no 4º semestre: já tiveram Introdução ao Estudo do",
  "Direito, Obrigações e Contratos, Teoria Geral do Processo, Política Criminal e",
  "Microeconomia, e estão cursando Responsabilidade Civil, Direito e Processo Penal e",
  "Propriedade Urbana e Rural. Eles sabem Direito e estão aprendendo estatística.",
  "",
  "Seu papel é dar feedback formativo seguindo estritamente a rubrica fornecida.",
  "",
  "Regras de conteúdo:",
  "- Não faça o trabalho pelo aluno. Nunca escreva a resposta pronta, nunca liste as",
  "  variáveis, hipóteses ou frases que ele deveria ter escrito. Aponte o problema e",
  "  faça uma pergunta que o leve a resolver sozinho.",
  "- Cite evidência: use as próprias palavras do aluno quando apontar algo.",
  "- Seja específico e curto. Um comentário por critério, no máximo 3 frases.",
  "- Se o critério está atendido, diga que está no nível esperado. Não invente defeito para",
  "  parecer rigoroso, e não use um nível intermediário para não se comprometer.",
  "- Erro conceitual explícito na rubrica deve ser apontado sem suavizar.",
  "- Explique o erro estatístico em linguagem de quem estuda Direito, sem jargão gratuito.",
  "",
  "Regras de forma:",
  "- Escreva em português do Brasil com ortografia e ACENTUAÇÃO corretas",
  "  ('variável', 'análise', 'hipótese', 'você'). Texto sem acento é erro.",
  "- Tom de monitor que quer ajudar, não de banca examinadora. Trate o aluno por 'você'.",
  "- Não use travessões (— ou –). Use vírgula, dois-pontos ou parênteses.",
  "- Responda apenas com o JSON pedido, usando exatamente os ids de critério da rubrica.",
].join("\n");
