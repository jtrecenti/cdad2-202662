/*
 * Tema claro ou escuro do site dos projetos.
 *
 * Script clássico, carregado no <head> antes da folha de estilo pintar: assim a
 * página já nasce no tema certo, sem piscar em branco. Sem escolha salva, segue
 * o sistema (a folha cuida disso com prefers-color-scheme). Com escolha salva,
 * põe data-theme no <html>, e a folha usa as cores daquele tema.
 *
 * O botão no canto alterna entre claro e escuro e lembra a escolha neste
 * navegador. Quem desenha em canvas pode ouvir o evento "tema" no window para
 * redesenhar com as cores novas.
 */
(function () {
  "use strict";

  var CHAVE = "cdad2-tema";
  var raiz = document.documentElement;

  function lerEscolha() {
    try {
      var v = window.localStorage.getItem(CHAVE);
      return v === "dark" || v === "light" ? v : null;
    } catch (e) {
      return null;
    }
  }

  function salvarEscolha(v) {
    try {
      window.localStorage.setItem(CHAVE, v);
    } catch (e) {
      /* navegação privada ou armazenamento bloqueado: vale só nesta página */
    }
  }

  function sistemaEscuro() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function temaAtual() {
    var escolha = raiz.getAttribute("data-theme");
    if (escolha === "dark" || escolha === "light") return escolha;
    return sistemaEscuro() ? "dark" : "light";
  }

  var inicial = lerEscolha();
  if (inicial) raiz.setAttribute("data-theme", inicial);

  function avisar() {
    var ev;
    try {
      ev = new CustomEvent("tema", { detail: { tema: temaAtual() } });
    } catch (e) {
      ev = document.createEvent("CustomEvent");
      ev.initCustomEvent("tema", false, false, { tema: temaAtual() });
    }
    window.dispatchEvent(ev);
  }

  function rotular(botao) {
    var escuro = temaAtual() === "dark";
    botao.textContent = escuro ? "☀" : "☾";
    var rotulo = escuro ? "Mudar para o tema claro" : "Mudar para o tema escuro";
    botao.setAttribute("aria-label", rotulo);
    botao.setAttribute("title", rotulo);
  }

  function montarBotao() {
    if (document.querySelector(".tema-botao")) return;
    var botao = document.createElement("button");
    botao.type = "button";
    botao.className = "tema-botao";
    rotular(botao);
    botao.addEventListener("click", function () {
      var novo = temaAtual() === "dark" ? "light" : "dark";
      raiz.setAttribute("data-theme", novo);
      salvarEscolha(novo);
      rotular(botao);
      avisar();
    });
    document.body.appendChild(botao);

    // Algumas páginas trocam o body inteiro (a cortina de liberação, por
    // exemplo). Se o botão sumir, ele volta.
    if (window.MutationObserver) {
      new MutationObserver(function () {
        if (!document.body.contains(botao)) document.body.appendChild(botao);
      }).observe(document.body, { childList: true });
    }

    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var mudou = function () {
        if (!raiz.getAttribute("data-theme")) {
          rotular(botao);
          avisar();
        }
      };
      if (mq.addEventListener) mq.addEventListener("change", mudou);
      else if (mq.addListener) mq.addListener(mudou);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montarBotao);
  else montarBotao();
})();
