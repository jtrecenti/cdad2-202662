/* ==========================================================================
   Guardrails de avaliação protegida.

   Porta, para os apps dos projetos, o que a avaliação diagnóstica já fazia
   (ver ../avaliacao-quarto/_guardrails.html):

     1. bloqueia colar (Ctrl+V, arraste, botão do meio) nos campos de texto;
     2. bloqueia copiar/recortar os enunciados (deixa copiar o que o aluno
        escreveu, para ele conseguir levar o texto para o BlackBoard);
     3. registra perda de foco (troca de aba, minimizar, outro programa) e,
        em cada violação, guarda uma captura DESTA página;
     4. opcionalmente exige tela cheia e registra a saída dela;
     5. desabilita o menu de contexto e mostra um banner de aviso.

   O que isso é e o que não é: não é vigilância da máquina do aluno (uma página
   não tem acesso à tela do sistema nem a outros programas). É registro de
   sinais fracos, avisado de forma transparente, que serve para conversar com o
   aluno depois. O sinal mais confiável continua sendo o log de foco.
   ========================================================================== */

import { registrarEvento, registrarEventoSaida, registrarCaptura } from "./firebase.js";
import { el, toast, modal } from "./ui.js";

const HTML2CANVAS = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
const INTERVALO_MIN_CAPTURA = 2500;
const MAX_CAPTURAS = 60;

const estado = {
  ligado: false,
  perdasFoco: 0,
  violacoes: 0,
  // Contagem por episódio, para quando a violação vale nota (opção
  // `episodios`). Uma troca de aba dispara blur e visibilitychange, e o
  // contador `violacoes` registra as duas: para registro serve, para descontar
  // nota seria cobrar duas vezes pela mesma saída. Aqui a saída conta uma vez,
  // da hora em que o aluno sai até a hora em que volta.
  fora: false,
  saidas: 0,
  outras: 0,
  ultimaCaptura: { ts: 0, id: null },
  eventos: [],
  // Linha do tempo do trabalho, e não da vigilância: em que horário cada etapa
  // foi concluída e em que horário a entrega foi fechada. Sem isso o registro
  // mostrava só o que o aluno fez de errado, e nada do que ele fez.
  etapas: [],
  entregueEm: null,
  opcoes: null,
  // Janela de tolerância: durante ela, perder o foco não é violação. Quem abre a
  // janela é o próprio app (ver `cdad:acao-legitima` em ui.baixar), porque a
  // caixa de salvar arquivo do navegador tira o foco da aba e isso não é fuga.
  toleranciaAte: 0,
  motivoTolerancia: null,
};

function emTolerancia() {
  return Date.now() < estado.toleranciaAte;
}

/* ---------- captura da própria página ------------------------------------ */

function carregarHtml2canvas() {
  if (window.html2canvas || document.querySelector("script[data-h2c]")) return;
  const s = document.createElement("script");
  s.src = HTML2CANVAS;
  s.async = true;
  s.dataset.h2c = "1";
  document.head.append(s);
}

async function capturar() {
  if (!window.html2canvas) return null;
  try {
    const canvas = await window.html2canvas(document.body, {
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      scale: 0.5,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      // imagens externas sujam o canvas e inviabilizam o toDataURL
      ignoreElements: (nó) =>
        nó.tagName === "IMG" &&
        nó.src &&
        !nó.src.startsWith("data:") &&
        !nó.src.startsWith(location.origin),
    });
    return canvas.toDataURL("image/jpeg", 0.5);
  } catch {
    return null;
  }
}

async function capturarParaViolacao() {
  if (!estado.opcoes?.capturas) return null;
  const agora = Date.now();
  // violações vêm em rajada; reaproveita a captura recente
  if (agora - estado.ultimaCaptura.ts < INTERVALO_MIN_CAPTURA) return estado.ultimaCaptura.id;
  if (estado.capturas >= MAX_CAPTURAS) return null;
  estado.ultimaCaptura.ts = agora;
  const dataURL = await capturar();
  const id = await registrarCaptura(dataURL);
  if (id) {
    estado.capturas += 1;
    estado.ultimaCaptura = { ts: agora, id };
  }
  return id;
}

/* ---------- registro ----------------------------------------------------- */

function anotar(tipo, detalhe, extra) {
  estado.eventos.push({
    tipo,
    detalhe,
    hora: new Date().toISOString(),
    // O registro continua depois da entrega, mas marcado: o que aconteceu
    // depois de fechar os arquivos não diz nada sobre o trabalho entregue.
    ...(estado.entregueEm ? { apos_entrega: true } : null),
    ...(extra || {}),
  });
  if (estado.eventos.length > 400) estado.eventos.shift();
}

function evento(tipo, detalhe, extra) {
  anotar(tipo, detalhe, extra);
  registrarEvento(tipo, detalhe, { exercicio: estado.opcoes.exercicio, ...(extra || {}) });
}

function saiu() {
  if (estado.fora) return;
  estado.fora = true;
  estado.saidas += 1;
}

function voltou() {
  estado.fora = false;
}

async function violacao(tipo, detalhe, extra = {}) {
  estado.violacoes += 1;
  if (tipo !== "aba_escondida" && tipo !== "foco_perdido") estado.outras += 1;
  atualizarBanner();
  const captura = await capturarParaViolacao();
  evento(tipo, detalhe, { ...extra, captura_id: captura });
}

/* ---------- banner ------------------------------------------------------- */

let banner, contador;

function montarBanner() {
  // Fixo, não sticky: sticky esconderia permanentemente uma faixa do conteúdo
  // ao rolar. Com fixo + padding no body, nada fica embaixo dele.
  banner = el("div", {
    id: "faixa-guardrails",
    style:
      "position:fixed;top:0;left:0;right:0;z-index:9000;background:#7a1020;color:#fff;" +
      "font-size:.8rem;line-height:1.3;padding:.4rem .9rem;display:flex;gap:.6rem;" +
      "align-items:center;box-shadow:0 1px 4px rgba(0,0,0,.3)",
  });
  banner.append(
    el("span", { texto: "⚠️" }),
    el("span", {
      texto: estado.opcoes.textoBanner ||
        "Projeto monitorado: bloqueio para cópia e cola (Ctrl+C e Ctrl+V) e registro de " +
        "saída desta aba, com captura desta página. Baixar seus arquivos não conta.",
    })
  );
  // Clicável: o aluno pode ver exatamente o que foi registrado sobre ele. Se o
  // dado existe e vai ser usado numa conversa depois, esconder seria pior.
  contador = el("button", {
    type: "button",
    title: "ver o que foi registrado",
    style:
      "margin-left:auto;background:rgba(255,255,255,.18);padding:.1rem .55rem;" +
      "border-radius:999px;white-space:nowrap;font-variant-numeric:tabular-nums;" +
      "border:1px solid rgba(255,255,255,.35);color:#fff;font-size:.75rem;cursor:pointer",
    onclick: mostrarRegistro,
  });
  banner.append(contador);
  document.body.prepend(banner);
  // a altura muda quando o texto quebra em telas estreitas
  const ajustarEspaco = () => {
    document.body.style.paddingTop = `${banner.offsetHeight}px`;
  };
  ajustarEspaco();
  if (window.ResizeObserver) new ResizeObserver(ajustarEspaco).observe(banner);
  else window.addEventListener("resize", ajustarEspaco);
  atualizarBanner();
}

function atualizarBanner() {
  if (!contador) return;
  const entregue = estado.entregueEm
    ? ` · entregue ${new Date(estado.entregueEm).toLocaleTimeString("pt-BR")}`
    : "";
  contador.textContent = estado.opcoes?.episodios
    ? `violações: ${estado.saidas + estado.outras}${entregue}`
    : `saídas de foco: ${estado.perdasFoco} · violações: ${estado.violacoes}${entregue}`;
}

/** Janela com tudo o que foi registrado nesta sessão. */
function mostrarRegistro() {
  const NOMES = {
    sessao_inicio: "abriu o projeto",
    aba_escondida: "saiu desta aba",
    aba_visivel: "voltou para esta aba",
    foco_perdido: "clicou fora da janela",
    foco_recuperado: "voltou para a janela",
    colar_bloqueado: "tentou colar",
    copiar_bloqueado: "tentou copiar o enunciado",
    recortar_bloqueado: "tentou recortar",
    arrastar_bloqueado: "tentou arrastar texto",
    menu_contexto_bloqueado: "abriu o menu do botão direito",
    tela_cheia_saiu: "saiu da tela cheia",
    tela_cheia_entrou: "entrou em tela cheia",
    acao_legitima: "ação do próprio app (não conta)",
    foco_perdido_tolerado: "saiu da janela durante uma ação do app (não conta)",
    aba_escondida_tolerada: "saiu da aba durante uma ação do app (não conta)",
    etapa_concluida: "concluiu uma etapa",
    entrega_fechada: "fechou a entrega",
  };
  const eventos = [...estado.eventos].reverse();
  const linhas = eventos.map((e) =>
    el("tr", {}, [
      el("td", { texto: new Date(e.hora).toLocaleTimeString("pt-BR") }),
      el("td", { texto: NOMES[e.tipo] || e.tipo }),
      el("td.miudo", { texto: [e.detalhe, e.apos_entrega ? "(depois da entrega)" : ""].filter(Boolean).join(" ") }),
    ])
  );

  const etapas = estado.etapas.length
    ? el("div", {}, [
        el("span.rotulo", { texto: "etapas concluídas" }),
        el("table", {}, [
          el("thead", {}, [
            el("tr", {}, ["hora", "etapa", "detalhe"].map((c) => el("th", { texto: c }))),
          ]),
          el("tbody", {}, estado.etapas.map((p) =>
            el("tr", {}, [
              el("td", { texto: new Date(p.hora).toLocaleTimeString("pt-BR") }),
              el("td", { texto: p.etapa }),
              el("td.miudo", { texto: p.detalhe || "" }),
            ])
          )),
        ]),
      ])
    : el("p.miudo", { texto: "nenhuma etapa concluída ainda." });

  modal({
    titulo: "O que foi registrado nesta sessão",
    conteudo: [
      el("p.enunciado", {
        texto: estado.opcoes.episodios
          ? `Até agora: ${estado.saidas} saída(s) desta aba e ${estado.outras} tentativa(s) ` +
            "de copiar, colar ou abrir o menu do botão direito. " + (estado.opcoes.textoRegistro || "")
          : `Até agora: ${estado.perdasFoco} saída(s) desta aba e ${estado.violacoes} evento(s) ` +
            "de cópia, cola ou saída de tela cheia. Nada disso é nota: serve para o professor " +
            "conversar com você se algo destoar muito.",
      }),
      el("p.miudo", {
        texto:
          "A página só enxerga o que acontece dentro dela. Não há acesso à sua tela, a outros " +
          "programas nem à câmera. Baixar arquivos do próprio projeto não conta.",
      }),
      etapas,
      estado.entregueEm
        ? el("p.miudo", {
            texto:
              `Entrega fechada às ${new Date(estado.entregueEm).toLocaleTimeString("pt-BR")}. ` +
              "O que for registrado a partir daí aparece marcado como posterior à entrega.",
          })
        : null,
      el("span.rotulo", { texto: "eventos da sessão" }),
      eventos.length
        ? el("div.rolagem", { style: "max-height:24rem" }, [
            el("table", {}, [
              el("thead", {}, [
                el("tr", {}, ["hora", "o que aconteceu", "detalhe"].map((c) => el("th", { texto: c }))),
              ]),
              el("tbody", {}, linhas),
            ]),
          ])
        : el("p.miudo", { texto: "nenhum evento registrado ainda." }),
    ],
  });
}

/* ---------- alvos editáveis --------------------------------------------- */

function editavel(nó) {
  let atual = nó;
  while (atual && atual.nodeType === 1) {
    if (atual.tagName === "INPUT" || atual.tagName === "TEXTAREA") return true;
    if (atual.isContentEditable) return true;
    atual = atual.parentNode;
  }
  return false;
}

/* ---------- tela cheia --------------------------------------------------- */

let cortinaTelaCheia;

function emTelaCheia() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function mostrarCortinaTelaCheia(primeiraVez) {
  if (cortinaTelaCheia) return;
  cortinaTelaCheia = el("div.cortina", { style: "z-index:9800" }, [
    el("div.caixa", {}, [
      el("h2", { texto: "Este projeto roda em tela cheia" }),
      el("p", {
        texto: primeiraVez
          ? "Entre em tela cheia para começar. Sair da tela cheia durante o projeto é registrado."
          : "Você saiu da tela cheia e isso foi registrado. Volte para continuar.",
      }),
      el("div.acoes", {}, [
        el("button.principal", {
          type: "button",
          texto: "Entrar em tela cheia",
          onclick: async () => {
            try {
              await (document.documentElement.requestFullscreen?.() ??
                document.documentElement.webkitRequestFullscreen?.());
            } catch {
              toast("O navegador recusou a tela cheia. Chame o professor.");
            }
          },
        }),
      ]),
    ]),
  ]);
  document.body.append(cortinaTelaCheia);
}

function esconderCortinaTelaCheia() {
  cortinaTelaCheia?.remove();
  cortinaTelaCheia = null;
}

function aoMudarTelaCheia() {
  if (emTelaCheia()) {
    esconderCortinaTelaCheia();
    evento("tela_cheia_entrou", "fullscreenchange");
  } else {
    violacao("tela_cheia_saiu", "fullscreenchange");
    mostrarCortinaTelaCheia(false);
  }
}

/* ---------- API ---------------------------------------------------------- */

/**
 * ativar({ exercicio, colar:false, copiar:false, telaCheia:false, capturas:true })
 * `colar:false` = colar bloqueado. Deixe `colar:true` em apps em que colar é
 * parte do trabalho (por exemplo, subir um CSV de predições).
 */
export function ativar(opcoes = {}) {
  if (estado.ligado) return api;
  estado.opcoes = {
    exercicio: "sem_exercicio",
    colar: false,
    copiar: false,
    telaCheia: false,
    capturas: true,
    banner: true,
    ...opcoes,
  };
  estado.ligado = true;

  if (estado.opcoes.capturas) carregarHtml2canvas();
  if (estado.opcoes.banner) montarBanner();

  document.body.style.userSelect = "none";
  document.body.style.webkitUserSelect = "none";
  const estilo = el("style", {
    html:
      "input,textarea,[contenteditable=true],pre,code,.selecionavel{" +
      "user-select:text!important;-webkit-user-select:text!important}",
  });
  document.head.append(estilo);

  // Bloqueios na fase de captura, para vencer handlers de editores de código.
  if (!estado.opcoes.colar) {
    document.addEventListener(
      "paste",
      (e) => {
        let colado = "";
        try {
          colado = (e.clipboardData || window.clipboardData)?.getData("text") || "";
        } catch {
          /* sem acesso ao clipboard */
        }
        e.preventDefault();
        e.stopPropagation();
        violacao("colar_bloqueado", `alvo=${e.target?.tagName}`, {
          conteudo_colado: colado ? colado.slice(0, 5000) : null,
        });
        toast("🚫 Colar está desabilitado neste projeto.");
      },
      true
    );
    document.addEventListener(
      "beforeinput",
      (e) => {
        if (
          e.inputType === "insertFromPaste" ||
          e.inputType === "insertFromPasteAsQuotation" ||
          e.inputType === "insertFromDrop"
        ) {
          e.preventDefault();
          e.stopPropagation();
          violacao("colar_bloqueado", `beforeinput=${e.inputType}`);
          toast("🚫 Colar está desabilitado neste projeto.");
        }
      },
      true
    );
    document.addEventListener(
      "drop",
      (e) => {
        // uploads legítimos (input[type=file]) não passam por aqui
        if (e.target?.type === "file") return;
        let arrastado = "";
        try {
          arrastado = e.dataTransfer?.getData("text") || "";
        } catch {
          /* ignora */
        }
        e.preventDefault();
        e.stopPropagation();
        violacao("arrastar_bloqueado", "drop", {
          conteudo_colado: arrastado ? arrastado.slice(0, 5000) : null,
        });
        toast("🚫 Arrastar texto está desabilitado.");
      },
      true
    );
  }

  if (!estado.opcoes.copiar) {
    const bloquearCopia = (nome) => (e) => {
      if (editavel(e.target)) return; // o aluno pode copiar o que ele mesmo escreveu
      e.preventDefault();
      e.stopPropagation();
      violacao(`${nome}_bloqueado`, nome);
      toast("🚫 Copiar os enunciados não é permitido.");
    };
    document.addEventListener("copy", bloquearCopia("copiar"), true);
    document.addEventListener("cut", bloquearCopia("recortar"), true);
    document.addEventListener(
      "dragstart",
      (e) => {
        if (!editavel(e.target)) e.preventDefault();
      },
      true
    );
  }

  document.addEventListener(
    "contextmenu",
    (e) => {
      e.preventDefault();
      violacao("menu_contexto_bloqueado", `alvo=${e.target?.tagName}`);
    },
    true
  );

  // O app avisa quando uma ação dele vai tirar o foco (baixar arquivo, por
  // exemplo). Dentro da janela, a perda de foco é registrada como evento comum.
  window.addEventListener("cdad:acao-legitima", (e) => {
    const ms = Number(e.detail?.ms) || 15000;
    estado.toleranciaAte = Date.now() + ms;
    estado.motivoTolerancia = e.detail?.motivo || null;
    evento("acao_legitima", estado.motivoTolerancia);
  });

  let escondida = document.hidden;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden === escondida) return;
    escondida = document.hidden;
    if (document.hidden) {
      if (emTolerancia()) {
        evento("aba_escondida_tolerada", estado.motivoTolerancia);
        return;
      }
      estado.perdasFoco += 1;
      saiu();
      atualizarBanner();
      violacao("aba_escondida", "visibilitychange");
    } else {
      voltou();
      atualizarBanner();
      evento("aba_visivel", "visibilitychange");
    }
  });

  let temporizadorBlur = null;
  window.addEventListener("blur", () => {
    if (temporizadorBlur) return; // blur/focus vêm em rajada
    temporizadorBlur = setTimeout(() => (temporizadorBlur = null), 300);
    if (emTolerancia()) {
      evento("foco_perdido_tolerado", estado.motivoTolerancia);
      return;
    }
    if (!document.hidden) {
      estado.perdasFoco += 1;
      saiu();
      atualizarBanner();
      violacao("foco_perdido", "window.blur");
    }
  });
  window.addEventListener("focus", () => {
    voltou();
    evento("foco_recuperado", "window.focus");
  });

  const aoSair = () => registrarEventoSaida("saida_pagina", "pagehide");
  window.addEventListener("pagehide", aoSair);
  window.addEventListener("beforeunload", aoSair);

  if (estado.opcoes.telaCheia) {
    document.addEventListener("fullscreenchange", aoMudarTelaCheia);
    document.addEventListener("webkitfullscreenchange", aoMudarTelaCheia);
    if (!emTelaCheia()) mostrarCortinaTelaCheia(true);
  }

  evento("sessao_inicio", location.pathname);
  return api;
}

const api = {
  /** Resumo para anexar em cada submissão. */
  resumo() {
    return {
      perdas_foco: estado.perdasFoco,
      violacoes: estado.violacoes,
      saidas: estado.saidas,
      outras_violacoes: estado.outras,
      capturas: estado.capturas,
      tela_cheia: estado.opcoes?.telaCheia ? emTelaCheia() : null,
      etapas: estado.etapas,
      entregue_em: estado.entregueEm,
      eventos: estado.eventos.slice(-40),
    };
  },
  /** Registra um marco do projeto (etapa concluída, pré-registro travado...). */
  marco(tipo, detalhe, extra) {
    evento(tipo, detalhe, extra);
  },
  /**
   * Registra a conclusão de uma etapa do projeto, com o horário.
   *
   * O aluno vê isso no mesmo painel em que vê as violações, e o professor
   * recebe a lista junto de cada submissão: dá para saber em que ponto o grupo
   * empacou, que é a informação que faltava para conversar sobre o trabalho.
   */
  etapa(nome, detalhe) {
    const ja = estado.etapas.find((p) => p.etapa === nome);
    const registro = { etapa: nome, detalhe: detalhe || "", hora: new Date().toISOString() };
    // refazer uma etapa atualiza o horário, mas não duplica a linha
    if (ja) Object.assign(ja, registro);
    else estado.etapas.push(registro);
    evento("etapa_concluida", nome, { etapa_detalhe: detalhe || null });
  },
  /**
   * Marca o momento em que a entrega foi fechada.
   *
   * O registro não para: parar seria abrir uma porta (fechar cedo, trabalhar
   * fora, gerar de novo). O que muda é que tudo que vier depois fica marcado
   * como posterior à entrega, e o horário da entrega passa a existir no log.
   */
  entregar(detalhe, nome = "entrega") {
    const primeira = !estado.entregueEm;
    // registra antes de marcar a entrega, senão o próprio evento da entrega
    // sairia rotulado como posterior a ela
    api.etapa(nome, detalhe);
    evento("entrega_fechada", detalhe || null, { refeita: !primeira });
    estado.entregueEm = new Date().toISOString();
    atualizarBanner();
  },
  get perdasFoco() {
    return estado.perdasFoco;
  },
  /** Violações por episódio: cada saída da aba conta uma vez, mais as tentativas de colar. */
  get infracoes() {
    return estado.saidas + estado.outras;
  },
  get violacoes() {
    return estado.violacoes;
  },
};

export default { ativar, api };
