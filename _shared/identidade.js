/* ==========================================================================
   Identificação do aluno / grupo.

   Princípio de avaliação protegida: nada acontece antes da identificação, e ela
   vale para toda a sessão (sessionStorage, some quando a aba fecha). Só e-mail
   institucional.

   Nos projetos em grupo não há nome de grupo: o grupo É a lista de e-mails.
   Nome de grupo dava trabalho, gerava divergência de grafia entre integrantes e
   não servia para nada que os e-mails já não resolvam. Onde algo precisa de um
   rótulo curto (nome de arquivo, sorteio determinístico), usamos uma chave
   derivada dos e-mails ordenados.
   ========================================================================== */

import { CONFIG } from "./config.js";
import { el, $, aviso } from "./ui.js";

const CHAVE = (exercicio) => `cdad2:identidade:${exercicio}`;

function validarEmail(valor) {
  const v = String(valor || "").trim().toLowerCase();
  if (!v) return null;
  return v.endsWith(CONFIG.dominioEmail) && /^[^\s@]+@[^\s@]+$/.test(v) ? v : null;
}

/** Chave estável do grupo: e-mails ordenados, sem domínio. Ex.: "ana+joao+marina". */
export function chaveDoGrupo(identidade) {
  const nomes = (identidade.integrantes || [identidade.email])
    .map((e) => e.split("@")[0].replace(/[^a-z0-9.]/gi, ""))
    .sort();
  return nomes.join("+").slice(0, 60);
}

/** Rótulo curto para mostrar na tela. */
export function rotuloDoGrupo(identidade) {
  if (!identidade.em_grupo) return identidade.email;
  const n = identidade.integrantes.length;
  const primeiros = identidade.integrantes.map((e) => e.split("@")[0]).slice(0, 2).join(", ");
  return n > 2 ? `${primeiros} e mais ${n - 2}` : primeiros;
}

/**
 * Mostra a cortina de identificação e resolve com
 *   { email, integrantes: [...], em_grupo, grupo }
 * `grupo` é a chave derivada dos e-mails, mantida por compatibilidade.
 */
export function exigirIdentificacao({
  exercicio,
  emGrupo = false,
  titulo = "Identificação",
  explicacao = "",
  minIntegrantes = 2,
  maxIntegrantes = 6,
  refazendo = false,
} = {}) {
  if (!refazendo) {
    const salvo = sessionStorage.getItem(CHAVE(exercicio));
    if (salvo) {
      try {
        const identidade = JSON.parse(salvo);
        setTimeout(() => mostrarNoTopo(identidade, { exercicio, emGrupo, titulo, explicacao }), 0);
        return Promise.resolve(identidade);
      } catch {
        sessionStorage.removeItem(CHAVE(exercicio));
      }
    }
  }

  return new Promise((resolve) => {
    const erro = el("div");
    const salvoAntes = (() => {
      try {
        return JSON.parse(sessionStorage.getItem(CHAVE(exercicio)) || "null");
      } catch {
        return null;
      }
    })();

    const campoEmail = el("input", {
      type: "email",
      id: "id-email",
      placeholder: `seunome${CONFIG.dominioEmail}`,
      autocomplete: "email",
      spellcheck: "false",
      value: salvoAntes?.email || "",
    });
    const campoIntegrantes = el("textarea", {
      id: "id-integrantes",
      placeholder: `um e-mail ${CONFIG.dominioEmail} por linha`,
      rows: "5",
      spellcheck: "false",
    });
    if (salvoAntes?.integrantes) campoIntegrantes.value = salvoAntes.integrantes.join("\n");

    const caixa = el("div.caixa", {}, [
      el("h2", { texto: titulo }),
      el("p.miudo", {
        texto:
          explicacao ||
          "Use seu e-mail do Insper. A submissão fica registrada no seu nome.",
      }),
      erro,
      el("div.campo", {}, [
        el("label.rotulo", {
          for: "id-email",
          texto: emGrupo ? "Seu e-mail (quem está submetendo)" : "Seu e-mail",
        }),
        campoEmail,
      ]),
      emGrupo
        ? el("div.campo", {}, [
            el("label.rotulo", {
              for: "id-integrantes",
              texto: `E-mails do grupo (${minIntegrantes} a ${maxIntegrantes}, incluindo o seu)`,
            }),
            campoIntegrantes,
            el("p.miudo", {
              style: "margin:.3rem 0 0",
              texto: "Não precisa de nome de grupo: os e-mails já identificam vocês.",
            }),
          ])
        : null,
      el("div.acoes", {}, [
        el("button.principal", {
          type: "button",
          texto: refazendo ? "Salvar" : "Começar",
          onclick: enviar,
        }),
        refazendo
          ? el("button.secundario", {
              type: "button",
              texto: "cancelar",
              onclick: () => {
                cortina.remove();
                resolve(salvoAntes);
              },
            })
          : null,
      ]),
    ]);

    const cortina = el("div.cortina", { role: "dialog", "aria-modal": "true" }, [caixa]);
    document.body.append(cortina);
    setTimeout(() => campoEmail.focus(), 50);
    campoEmail.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !emGrupo) enviar();
    });

    function mostrarErro(msg) {
      erro.replaceChildren(aviso("erro", null, msg));
    }

    function enviar() {
      const email = validarEmail(campoEmail.value);
      if (!email) {
        mostrarErro(`Informe um e-mail terminado em ${CONFIG.dominioEmail}.`);
        campoEmail.focus();
        return;
      }
      let integrantes = [email];
      if (emGrupo) {
        const brutos = campoIntegrantes.value
          .split(/[\n,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const validos = brutos.map(validarEmail);
        const invalidos = brutos.filter((_, i) => !validos[i]);
        if (invalidos.length) {
          mostrarErro(`Estes e-mails não são ${CONFIG.dominioEmail}: ${invalidos.join(", ")}`);
          return;
        }
        integrantes = [...new Set([email, ...validos])];
        if (integrantes.length < minIntegrantes) {
          mostrarErro(`O grupo precisa de pelo menos ${minIntegrantes} integrantes.`);
          return;
        }
        if (integrantes.length > maxIntegrantes) {
          mostrarErro(`No máximo ${maxIntegrantes} integrantes.`);
          return;
        }
      }
      const identidade = { email, integrantes, em_grupo: emGrupo };
      identidade.grupo = chaveDoGrupo(identidade);
      sessionStorage.setItem(CHAVE(exercicio), JSON.stringify(identidade));
      cortina.remove();
      mostrarNoTopo(identidade, { exercicio, emGrupo, titulo, explicacao });
      resolve(identidade);
    }
  });
}

/**
 * Coloca a identificação no cabeçalho, com um botão para corrigir. Dá para
 * ajustar o grupo mesmo depois de submeter: alguém sempre esquece um integrante,
 * e obrigar a recomeçar o projeto por isso seria pior.
 */
export function mostrarNoTopo(identidade, opcoes = {}) {
  const alvo = $(".topo-dir");
  if (!alvo) return;
  alvo.querySelector(".etiqueta-identidade")?.remove();
  alvo.querySelector(".botao-trocar-grupo")?.remove();

  const texto = identidade.em_grupo
    ? `${rotuloDoGrupo(identidade)} (${identidade.integrantes.length})`
    : identidade.email;
  const etiqueta = el("span.etiqueta.etiqueta-identidade", {
    texto,
    title: identidade.integrantes.join(", "),
  });
  const botao = el("button.secundario.botao-trocar-grupo", {
    type: "button",
    texto: identidade.em_grupo ? "corrigir grupo" : "corrigir e-mail",
    style: "padding:.2rem .5rem;font-size:.72rem",
    onclick: async () => {
      const nova = await exigirIdentificacao({ ...opcoes, refazendo: true });
      if (nova) {
        Object.assign(identidade, nova);
        window.dispatchEvent(new CustomEvent("cdad:identidade-mudou", { detail: nova }));
      }
    },
  });
  alvo.prepend(etiqueta, botao);
}
