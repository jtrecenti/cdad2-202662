/* ==========================================================================
   Gravação no Firebase Realtime Database.

   Princípio de avaliação protegida: o cliente só escreve. As regras negam
   leitura (`.read: false`), então nem o aluno nem um colega conseguem ler
   submissões, nem as próprias. Quem lê é o professor, com credencial de dono.

   Um aluno com console aberto ainda pode forjar ou repetir escritas. O sinal
   confiável não é a submissão isolada, é o conjunto: sessão, sequência de
   eventos de foco, hash do conteúdo e horário.
   ========================================================================== */

import { CONFIG } from "./config.js";
import { agora } from "./ui.js";

export const SESSAO =
  crypto.randomUUID?.() ?? `sess-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

function endpoint(no) {
  return `${CONFIG.rtdb}/${no}.json`;
}

function base(extra = {}) {
  return {
    turma: CONFIG.turma,
    sessao: SESSAO,
    hora_cliente: agora(),
    fuso_min: new Date().getTimezoneOffset(),
    user_agent: navigator.userAgent,
    url: location.href,
    ...extra,
  };
}

/**
 * Grava uma submissão. `dados` deve trazer pelo menos:
 *   exercicio, etapa, identificacao {email, grupo, integrantes}
 * Devolve {ok, status, id} e nunca lança: um erro de rede não pode
 * impedir o aluno de continuar o projeto.
 */
export async function registrarSubmissao(dados) {
  if (!CONFIG.registrar) {
    return { ok: true, status: 0, id: null, desligado: true };
  }
  const corpo = base(dados);
  // campos obrigatórios nas regras do RTDB
  corpo.exercicio = String(dados.exercicio ?? "sem_exercicio");
  corpo.aluno = String(dados.identificacao?.email ?? dados.aluno ?? "sem_email");
  try {
    const resposta = await fetch(endpoint(CONFIG.nos.submissoes), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      keepalive: true,
    });
    const texto = await resposta.text();
    let id = null;
    try {
      id = JSON.parse(texto)?.name ?? null;
    } catch {
      /* resposta não-JSON: segue sem id */
    }
    return { ok: resposta.ok, status: resposta.status, id, resposta: texto.slice(0, 200) };
  } catch (erro) {
    return { ok: false, status: 0, id: null, resposta: String(erro).slice(0, 200) };
  }
}

/** Evento de monitoramento (foco, tentativa de colar, tela cheia, etc.). */
export function registrarEvento(tipo, detalhe, extra = {}) {
  if (!CONFIG.registrar) return Promise.resolve({ ok: true, desligado: true });
  const corpo = base({
    tipo_evento: String(tipo),
    detalhe: detalhe == null ? null : String(detalhe).slice(0, 500),
    ...extra,
  });
  return fetch(endpoint(CONFIG.nos.eventos), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    keepalive: true,
  })
    .then((r) => ({ ok: r.ok, status: r.status }))
    .catch(() => ({ ok: false, status: 0 }));
}

/** Envia com sendBeacon (para `pagehide`, quando o fetch normal morre). */
export function registrarEventoSaida(tipo, detalhe) {
  if (!CONFIG.registrar || !navigator.sendBeacon) return;
  const corpo = base({ tipo_evento: String(tipo), detalhe: detalhe ?? null });
  try {
    navigator.sendBeacon(
      endpoint(CONFIG.nos.eventos),
      new Blob([JSON.stringify(corpo)], { type: "application/json" })
    );
  } catch {
    /* silencioso */
  }
}

/** Guarda uma captura (dataURL JPEG) e devolve o id para referenciar no evento. */
export async function registrarCaptura(dataURL) {
  if (!CONFIG.registrar || !dataURL) return null;
  const id = crypto.randomUUID?.() ?? `cap-${Date.now()}`;
  try {
    await fetch(`${CONFIG.rtdb}/${CONFIG.nos.capturas}/${id}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataURL),
      keepalive: true,
    });
    return id;
  } catch {
    return null;
  }
}
