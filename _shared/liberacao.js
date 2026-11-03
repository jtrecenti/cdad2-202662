/* ==========================================================================
   Liberação dos projetos por data, e acesso do professor.

   O aluno vê todos os cards no portal (saber o que vem por aí é bom), mas só
   entra no projeto depois da data em `liberacao.json`.

   O modo professor não é mais um parâmetro de URL: `?prof=1` apenas ABRE a
   caixa de senha, e a senha é conferida pelo Worker contra o secret PROF_TOKEN.
   Sem a senha não há liberação, então descobrir a URL não basta. Depois de
   entrar, o modo vale para a sessão do navegador.

   Isso não pretende ser inviolável: quem edita o JavaScript no console do
   próprio navegador contorna qualquer trava de front-end. O que protege de fato
   é o gabarito estar no servidor (projetos 7 e 8) e a submissão ficar registrada
   com horário.
   ========================================================================== */

import { CONFIG } from "./config.js";
import { aviso, el, $ } from "./ui.js";

const CHAVE_PROF = "cdad2:modo-professor";
const CHAVE_QUEM = "cdad2:quem-professor";
// A senha fica guardada na sessão porque algumas rotas do Worker precisam dela
// a cada chamada, e não só na entrada: é o caso das rotas /gincana/*, que o
// professor usa a aula inteira. Guardar em claro não piora o modelo de ameaça
// que já existe (o corretor do projeto 3 mantém a senha num campo visível a
// sessão toda), e some ao fechar a aba.
const CHAVE_SENHA = "cdad2:senha-professor";
// Acesso antecipado a UM projeto, para reposição: guardado por projeto, e sem
// nenhum poder de professor. Ver a rota /acesso/entrar no Worker.
const CHAVE_ACESSO = (id) => `cdad2:acesso:${id}`;
const FUSO = "America/Sao_Paulo";

let cache = null;

/** Verdadeiro se alguma senha da equipe já foi conferida nesta sessão. */
export function modoProfessor() {
  return sessionStorage.getItem(CHAVE_PROF) === "1";
}

/** Nome de quem entrou (professor, colega ou monitor), para mostrar e registrar. */
export function quemEntrou() {
  return sessionStorage.getItem(CHAVE_QUEM) || null;
}

/**
 * A senha conferida nesta sessão, para as rotas do Worker que exigem
 * `X-Prof-Token` a cada chamada. Vazia se ninguém entrou, ou se a sessão vem
 * de antes desta chave existir: nesse caso, peça a senha de novo.
 */
export function senhaProfessor() {
  return sessionStorage.getItem(CHAVE_SENHA) || "";
}

/** ?prof (com ou sem valor) pede a senha; ?prof=0 sai do modo professor. */
export function querEntrarComoProfessor() {
  const params = new URLSearchParams(location.search);
  if (!params.has("prof")) return false;
  if (params.get("prof") === "0") {
    sessionStorage.removeItem(CHAVE_PROF);
    sessionStorage.removeItem(CHAVE_QUEM);
    sessionStorage.removeItem(CHAVE_SENHA);
    return false;
  }
  return !modoProfessor();
}

/** Caixa de senha. Resolve com true quando o Worker confirma. */
export function pedirSenhaProfessor() {
  return new Promise((resolve) => {
    const erro = el("div");
    const campo = el("input", {
      type: "password",
      id: "senha-prof",
      autocomplete: "current-password",
      placeholder: "senha do professor",
    });
    const botao = el("button.principal", { type: "button", texto: "Entrar" });

    const cortina = el("div.cortina", { role: "dialog", "aria-modal": "true" }, [
      el("div.caixa", {}, [
        el("h2", { texto: "Área da equipe" }),
        el("p.miudo", {
          texto:
            "Professor, colegas e monitores. Libera todos os projetos antes da data e mostra " +
            "as ferramentas de correção. Cada pessoa tem a sua senha, conferida no servidor.",
        }),
        erro,
        el("div.campo", {}, [el("label.rotulo", { for: "senha-prof", texto: "senha" }), campo]),
        el("div.acoes", {}, [
          botao,
          el("button.secundario", {
            type: "button",
            texto: "sou aluno, voltar",
            onclick: () => {
              cortina.remove();
              resolve(false);
            },
          }),
        ]),
      ]),
    ]);

    async function entrar() {
      botao.disabled = true;
      erro.replaceChildren(el("span.carregando", { texto: "conferindo" }));
      try {
        const resposta = await fetch(`${CONFIG.proxy}/prof/entrar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ senha: campo.value }),
        });
        const dados = await resposta.json().catch(() => ({}));
        if (resposta.ok && dados.ok) {
          sessionStorage.setItem(CHAVE_PROF, "1");
          sessionStorage.setItem(CHAVE_SENHA, campo.value);
          if (dados.quem) sessionStorage.setItem(CHAVE_QUEM, String(dados.quem));
          cortina.remove();
          resolve(true);
          return;
        }
        erro.replaceChildren(
          el("div.aviso.erro", {}, [
            el("span", { texto: dados.erro || "senha incorreta" }),
          ])
        );
      } catch (e) {
        erro.replaceChildren(
          el("div.aviso.erro", {}, [
            el("span", { texto: `não consegui falar com o servidor: ${e.message || e}` }),
          ])
        );
      }
      botao.disabled = false;
    }

    botao.addEventListener("click", entrar);
    campo.addEventListener("keydown", (e) => {
      if (e.key === "Enter") entrar();
    });
    document.body.append(cortina);
    setTimeout(() => campo.focus(), 50);
  });
}

/** Abre a caixa de senha se a URL pediu, e devolve o estado final do modo. */
export async function garantirModoProfessor() {
  if (querEntrarComoProfessor()) await pedirSenhaProfessor();
  return modoProfessor();
}

/** Verdadeiro se a senha de acesso deste projeto já foi conferida nesta sessão. */
export function temAcesso(id) {
  return sessionStorage.getItem(CHAVE_ACESSO(id)) === "1";
}

/** Nome de quem entrou com senha de acesso, para mostrar no topo. */
export function quemTemAcesso(id) {
  return sessionStorage.getItem(`${CHAVE_ACESSO(id)}:quem`) || null;
}

/** Caixa de senha do acesso antecipado. Resolve com true quando o Worker confirma. */
export function pedirSenhaAcesso(id) {
  return new Promise((resolve) => {
    const erro = el("div");
    const campo = el("input", {
      type: "password",
      id: "senha-acesso",
      autocomplete: "one-time-code",
      placeholder: "senha combinada com o professor",
    });
    const botao = el("button.principal", { type: "button", texto: "Entrar" });

    const cortina = el("div.cortina", { role: "dialog", "aria-modal": "true" }, [
      el("div.caixa", {}, [
        el("h2", { texto: "Acesso combinado" }),
        el("p.miudo", {
          texto:
            "Se o professor combinou com você uma data diferente para este projeto, use aqui a " +
            "senha que ele mandou. Ela abre só este projeto, e só para você.",
        }),
        erro,
        el("div.campo", {}, [el("label.rotulo", { for: "senha-acesso", texto: "senha" }), campo]),
        el("div.acoes", {}, [
          botao,
          el("a.botao.secundario", { href: "../", texto: "voltar para os projetos" }),
        ]),
      ]),
    ]);

    async function entrar() {
      botao.disabled = true;
      erro.replaceChildren(el("span.carregando", { texto: "conferindo" }));
      try {
        const resposta = await fetch(`${CONFIG.proxy}/acesso/entrar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ senha: campo.value, exercicio: id }),
        });
        const dados = await resposta.json().catch(() => ({}));
        if (resposta.ok && dados.ok) {
          sessionStorage.setItem(CHAVE_ACESSO(id), "1");
          if (dados.quem) sessionStorage.setItem(`${CHAVE_ACESSO(id)}:quem`, String(dados.quem));
          cortina.remove();
          resolve(true);
          return;
        }
        erro.replaceChildren(
          el("div.aviso.erro", {}, [el("span", { texto: dados.erro || "senha incorreta" })])
        );
      } catch (e) {
        erro.replaceChildren(
          el("div.aviso.erro", {}, [
            el("span", { texto: `não consegui falar com o servidor: ${e.message || e}` }),
          ])
        );
      }
      botao.disabled = false;
    }

    botao.addEventListener("click", entrar);
    campo.addEventListener("keydown", (e) => {
      if (e.key === "Enter") entrar();
    });
    document.body.append(cortina);
    setTimeout(() => campo.focus(), 50);
  });
}

export async function carregarLiberacao(caminho = "liberacao.json") {
  if (cache) return cache;
  cache = await fetch(caminho).then((r) => r.json());
  return cache;
}

/** Converte "2026-08-12T08:00" (hora de Brasília) em Date. */
function paraData(texto) {
  if (!texto) return null;
  // Brasília não tem horário de verão desde 2019, então o deslocamento é fixo.
  const data = new Date(`${texto}:00-03:00`);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function formatarData(texto) {
  const data = paraData(texto);
  if (!data) return "data a definir";
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSO,
  });
}

/** Situação de um projeto: { liberado, chegou, porProfessor, libera_em, ... }. */
export function situacao(config, id) {
  const info = config?.exercicios?.[id] || {};
  const prof = modoProfessor();
  const data = paraData(info.libera_em);
  const chegou = !data || Date.now() >= data.getTime();

  // Reposição: `acesso_em` é a partir de quando a senha combinada vale, e
  // `oculto_ate` esconde o card do portal enquanto o projeto é de uma pessoa só.
  const dataAcesso = paraData(info.acesso_em);
  const janelaDeAcesso = Boolean(dataAcesso) && Date.now() >= dataAcesso.getTime();
  const comAcesso = janelaDeAcesso && temAcesso(id);
  const dataOculto = paraData(info.oculto_ate);
  const oculto = Boolean(dataOculto) && Date.now() < dataOculto.getTime();

  return {
    liberado: chegou || prof || comAcesso,
    porProfessor: !chegou && prof,
    porAcesso: !chegou && !prof && comAcesso,
    chegou,
    janelaDeAcesso,
    acesso_em: info.acesso_em || null,
    oculto: oculto && !prof,
    libera_em: info.libera_em || null,
    entrega_em: info.entrega_em || null,
    gabarito_em: info.gabarito_em || null,
    so_professor: Boolean(info.so_professor),
    presencial: Boolean(info.presencial),
  };
}

/**
 * Modo estudo: o projeto continua aberto depois do prazo, para consulta.
 *
 * Passado o `entrega_em`, o projeto deixa de ser avaliação e vira material de
 * estudo. Aí não faz sentido pedir identificação, bloquear cópia e cola ou
 * gravar submissão: quem entra agora está treinando, e registrar isso só
 * sujaria a base de quem entregou no prazo.
 *
 * `?estudo=1` força o modo antes do prazo, o que serve para conferir a tela.
 * `?estudo=0` faz o contrário, e é como o professor reabre o projeto para uma
 * entrega combinada fora da data.
 */
export function modoEstudo(s) {
  const forcado = new URLSearchParams(location.search).get("estudo");
  if (forcado === "1") return true;
  if (forcado === "0") return false;
  const prazo = paraData(s?.entrega_em);
  return Boolean(prazo) && Date.now() > prazo.getTime();
}

/** O aviso de que a página está em modo estudo, para pôr no topo. */
export function avisoEstudo() {
  return aviso(
    "info",
    "Modo estudo",
    "O prazo de entrega deste projeto já passou, então ele está aberto para "
    + "treinar: nada é registrado, não é preciso se identificar e não há "
    + "bloqueio de cópia e cola. Refaça quantas vezes quiser.");
}

/**
 * Trava a página se o projeto ainda não foi liberado. Pede a senha antes, se a
 * URL trouxer ?prof.
 */
export async function exigirLiberacao(id, { caminho = "../liberacao.json" } = {}) {
  await garantirModoProfessor();

  let config;
  try {
    config = await carregarLiberacao(caminho);
  } catch {
    return { liberado: true, semConfig: true }; // sem o arquivo, não trava ninguém
  }
  let s = situacao(config, id);
  if (s.liberado) return s;

  // Quem combinou outra data com o professor entra aqui, com a senha dele.
  if (s.janelaDeAcesso) {
    document.body.innerHTML = "";
    if (await pedirSenhaAcesso(id)) {
      s = situacao(config, id);
      if (s.liberado) {
        location.reload();
        return s;
      }
    }
  }

  document.body.innerHTML = "";
  const caixa = el("div.cortina", {}, [
    el("div.caixa", {}, [
      el("h2", { texto: "Este projeto ainda não foi liberado" }),
      el("p", { html: `Ele abre em <strong>${formatarData(s.libera_em)}</strong>.` }),
      el("p.miudo", {
        texto:
          "Enquanto isso, a página inicial mostra do que se trata. Se você acha que deveria " +
          "estar liberado, fale com o professor.",
      }),
      el("div.acoes", {}, [
        el("a.botao.principal", { href: "../", texto: "Voltar para os projetos" }),
      ]),
    ]),
  ]);
  document.body.append(caixa);
  return s;
}
