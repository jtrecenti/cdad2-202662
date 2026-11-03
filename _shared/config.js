/* ==========================================================================
   Configuração compartilhada dos apps.
   Este é o único arquivo que precisa ser editado para apontar os apps para
   outro Firebase, outro proxy ou outra turma.
   ========================================================================== */

const PADROES = {
  turma: "cdad2-2026-2",

  /* Firebase Realtime Database do projeto `jtrecenti`.
     As regras liberam APENAS escrita (ver firebase/database.rules.json):
     o aluno grava a submissão e não consegue ler nada, nem o dele. */
  rtdb: "https://jtrecenti-default-rtdb.firebaseio.com",
  nos: {
    submissoes: "cdad2_2026_2_submissoes",
    eventos: "cdad2_2026_2_eventos",
    capturas: "cdad2_2026_2_capturas",
  },

  /* Worker Cloudflare que guarda as chaves das APIs de LLM e os gabaritos, e que
     corrige os projetos 7 e 8 (ver proxy/README.md).
     Em desenvolvimento: abra o app com ?proxy=http://localhost:8787 */
  proxy: "https://cdad-proxy.julio-trecenti.workers.dev",

  dominioEmail: "@al.insper.edu.br",

  /* Nomes lógicos; o Worker faz o mapeamento para os modelos de verdade. */
  modelos: {
    simples: "simples", // gpt-4.1-mini: extração, classificação, correção objetiva
    complexo: "complexo", // gemini: feedback pela rubrica, leitura de imagem
  },
};

const params = new URLSearchParams(location.search);

export const CONFIG = {
  ...PADROES,
  proxy: (params.get("proxy") || PADROES.proxy).replace(/\/+$/, ""),
  /* ?semregistro=1 desliga a gravação no Firebase (para testar em sala sem
     poluir a base). Não desliga os guardrails. */
  registrar: params.get("semregistro") !== "1",
  /* ?fakellm=1 responde localmente, sem chamar API de LLM (ver simulacoes.js). */
  simularLLM: params.get("fakellm") === "1",
};

/** Caminho até a pasta _shared, a partir de qualquer app. */
export const SHARED = new URL(".", import.meta.url).pathname;
