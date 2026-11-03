/* ==========================================================================
   Bloco de anotações do aluno.

   Veio de uma revisão dos monitores: durante o projeto surgem ideias sobre as
   variáveis, e anotar isso em um editor de texto conta como saída da aba. O
   aluno acabava escolhendo entre perder a ideia e levar uma violação. Um lugar
   para rascunhar dentro da própria página resolve os dois.

   O texto fica só no navegador (localStorage) e não vai junto da entrega. Isso
   é dito na cara do painel: rascunho que é enviado ao professor deixa de ser
   rascunho, e o aluno volta a escrever em outro lugar.
   ========================================================================== */

import { el, $ } from "./ui.js";

const PREFIXO = "cdad:notas:";

/**
 * blocoDeNotas({ exercicio }) monta o botão flutuante e o painel.
 * Devolve { texto, abrir, fechar, alternar }.
 */
export function blocoDeNotas({ exercicio = "sem_exercicio", dica = "" } = {}) {
  const chave = PREFIXO + exercicio;
  if ($("#bloco-notas")) return null;

  const area = el("textarea", {
    id: "notas-texto",
    rows: "10",
    maxlength: "4000",
    placeholder:
      "Rascunhe aqui: ideias de variáveis, o que você viu numa sentença, o que ficou em " +
      "dúvida para perguntar ao professor.",
    "aria-label": "suas anotações",
  });
  try {
    area.value = localStorage.getItem(chave) || "";
  } catch {
    /* navegador sem localStorage: o bloco funciona, só não persiste */
  }

  const contagem = el("span.miudo", { texto: "" });
  const atualizarContagem = () => {
    contagem.textContent = `${area.value.length} de 4000 caracteres · salvo neste navegador`;
  };
  atualizarContagem();

  let temporizador = null;
  area.addEventListener("input", () => {
    atualizarContagem();
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      try {
        localStorage.setItem(chave, area.value);
      } catch {
        /* cota cheia ou modo anônimo: não vale interromper a prova por isso */
      }
    }, 400);
  });

  // `el` só entende tag.classe: o id vai como atributo, senão vira um elemento
  // desconhecido chamado "section#bloco-notas" e nada disso funciona.
  const painel = el("section.notas", { id: "bloco-notas", hidden: true, "aria-label": "bloco de anotações" }, [
    el("header", {}, [
      el("strong", { texto: "Minhas anotações" }),
      el("button.secundario", {
        type: "button",
        texto: "fechar",
        onclick: () => alternar(false),
      }),
    ]),
    el("div.notas-corpo", {}, [
      el("p.miudo", {
        texto:
          dica ||
          "Só para você. Fica guardado neste navegador, não é enviado ao professor e não " +
          "entra nos arquivos da entrega. Escrever aqui não conta como saída da aba.",
      }),
      area,
      contagem,
    ]),
  ]);

  const botao = el("button.notas-botao", {
    id: "abrir-notas",
    type: "button",
    "aria-expanded": "false",
    "aria-controls": "bloco-notas",
    texto: "✎ Anotações",
    onclick: () => alternar(),
  });

  function alternar(abrir) {
    const mostrar = abrir === undefined ? painel.hidden : abrir;
    painel.hidden = !mostrar;
    botao.setAttribute("aria-expanded", String(mostrar));
    botao.classList.toggle("aberto", mostrar);
    if (mostrar) area.focus();
  }

  document.body.append(botao, painel);
  return {
    texto: () => area.value,
    abrir: () => alternar(true),
    fechar: () => alternar(false),
    alternar,
  };
}

export default { blocoDeNotas };
