/* ==========================================================================
   Projeto 8 (aula 27, em casa) - Competição de modelo preditivo.

   O aluno treina onde quiser e sobe um CSV de predições. Não há mais editor de
   código aqui: quem faz um modelo decente vai querer o Colab, com as bibliotecas
   que conhece, e não um textarea no navegador.

   O que este app faz de fato:
   - confere o arquivo ANTES de deixar submeter (colunas, ids, faixa das
     probabilidades, duplicidade), porque submissão é recurso escasso: são 3;
   - manda as predições para o Worker, que tem os rótulos e devolve a AUC;
   - mostra o ranking com a melhor submissão de cada pessoa.
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import { ativar } from "../_shared/guardrails.js";
import { exigirIdentificacao } from "../_shared/identidade.js";
import { registrarSubmissao } from "../_shared/firebase.js";
import { exigirLiberacao } from "../_shared/liberacao.js";
import { $, el, limpar, aviso, toast, montarTopo, formatar, paragrafos, esc } from "../_shared/ui.js";

const EXERCICIO = "ex08";
const MAX_SUBMISSOES = 3;

const estado = {
  identidade: null,
  guarda: null,
  idsEsperados: null,   // Set com os ids do teste
  predicoes: null,      // {id: prob} já conferido
  arquivo: null,
  submissoes: 0,
  melhorAuc: null,
};

/* ---------- arranque ---------------------------------------------------- */

async function iniciar() {
  montarTopo({
    exercicio: "Projeto 8",
    aula: "aula 27",
    titulo: "Competição: prever recurso negado",
  });
  const liberacao = await exigirLiberacao(EXERCICIO);
  if (!liberacao.liberado) return;

  estado.identidade = await exigirIdentificacao({
    exercicio: EXERCICIO,
    emGrupo: false,
    titulo: "Projeto 8 · quem está fazendo",
    explicacao:
      "Projeto individual, para fazer em casa. As submissões ficam registradas no seu e-mail, " +
      "e são 3 por pessoa.",
  });
  // Em casa, com código: nada de bloquear cópia e cola. O que fica registrado é a
  // submissão, não o comportamento.
  estado.guarda = ativar({
    exercicio: EXERCICIO,
    colar: true,
    copiar: true,
    capturas: false,
    banner: false,
  });

  const [treino, teste] = await Promise.all([
    fetch("dados/p08_treino.csv").then((r) => r.text()),
    fetch("dados/p08_teste.csv").then((r) => r.text()),
  ]);
  const linhasTeste = teste.trim().split(/\r?\n/);
  const cabecalhoTeste = linhasTeste[0].split(",");
  const iIdTeste = cabecalhoTeste.indexOf("id");
  estado.idsEsperados = new Set(linhasTeste.slice(1).map((l) => l.split(",")[iIdTeste]));
  const nTreino = treino.trim().split(/\r?\n/).length - 1;

  $("#info-dados").textContent = `${nTreino} de treino · ${estado.idsEsperados.size} de teste`;
  limpar($("#fichas-competicao")).append(
    el("div.ficha", {}, [
      el("span.rotulo", { texto: "métrica" }),
      el("div.numerao", { texto: "AUC" }),
      el("div.miudo", { texto: "área sob a curva ROC" }),
    ]),
    el("div.ficha.destaque", {}, [
      el("span.rotulo", { texto: "modelo baseline" }),
      el("div.numerao", { texto: "0,724" }),
      el("div.miudo", {
        texto:
          "regressão logística com dummies em todas as colunas, sem ajuste nenhum. É o piso: espera-se que o " +
          "modelo de vocês fique acima disso",
      }),
    ]),
    el("div.ficha", {}, [
      el("span.rotulo", { texto: "chute aleatório" }),
      el("div.numerao", { texto: "0,500" }),
      el("div.miudo", { texto: "abaixo disso, algo está invertido" }),
    ])
  );

  $("#link-treino").href = "dados/p08_treino.csv";
  $("#link-teste").href = "dados/p08_teste.csv";
  $("#link-colab").href = "https://colab.research.google.com/#create=true";
  $("#contador-submissoes").textContent = `0 de ${MAX_SUBMISSOES} submissões`;

  $("#arquivo-predicoes").addEventListener("change", (e) => lerArquivo(e.target.files?.[0]));
  ligarArraste();
  $("#b-submeter").addEventListener("click", submeter);
  $("#b-placar").addEventListener("click", atualizarPlacar);
  atualizarPlacar();
}

function ligarArraste() {
  const zona = $("#zona-upload");
  zona.addEventListener("dragover", (e) => {
    e.preventDefault();
    zona.classList.add("sobre");
  });
  zona.addEventListener("dragleave", () => zona.classList.remove("sobre"));
  zona.addEventListener("drop", (e) => {
    e.preventDefault();
    zona.classList.remove("sobre");
    lerArquivo(e.dataTransfer?.files?.[0]);
  });
}

/* ---------- conferência do arquivo -------------------------------------- */

/**
 * Confere o CSV antes de permitir a submissão. Cada item devolve
 * {ok, texto} e um único item com ok=false já bloqueia: com 3 submissões, gastar
 * uma com arquivo torto seria injusto.
 */
function conferir(texto, nome) {
  const itens = [];
  const linhas = texto.trim().split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) {
    return { itens: [{ ok: false, texto: "o arquivo está vazio ou tem só o cabeçalho" }], predicoes: null };
  }

  const separador = linhas[0].includes(";") && !linhas[0].includes(",") ? ";" : ",";
  const cabecalho = linhas[0].split(separador).map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ""));
  const iId = cabecalho.indexOf("id");
  const iProb = cabecalho.findIndex((c) => ["prob", "probabilidade", "p", "negou", "pred"].includes(c));

  itens.push({
    ok: iId >= 0 && iProb >= 0,
    texto:
      iId >= 0 && iProb >= 0
        ? `colunas encontradas: ${cabecalho[iId]} e ${cabecalho[iProb]}`
        : `preciso de uma coluna "id" e uma coluna "prob". Achei: ${cabecalho.join(", ")}`,
  });
  if (iId < 0 || iProb < 0) return { itens, predicoes: null };

  const predicoes = {};
  const problemas = { naoNumerico: 0, foraDaFaixa: 0, duplicados: 0, desconhecidos: [] };
  for (const linha of linhas.slice(1)) {
    const campos = linha.split(separador);
    const id = (campos[iId] || "").trim().replace(/^"|"$/g, "");
    const bruto = (campos[iProb] || "").trim().replace(/^"|"$/g, "").replace(",", ".");
    const valor = Number(bruto);
    if (!id) continue;
    if (!Number.isFinite(valor)) {
      problemas.naoNumerico += 1;
      continue;
    }
    if (valor < 0 || valor > 1) problemas.foraDaFaixa += 1;
    if (id in predicoes) problemas.duplicados += 1;
    if (!estado.idsEsperados.has(id) && problemas.desconhecidos.length < 5) {
      problemas.desconhecidos.push(id);
    }
    predicoes[id] = valor;
  }

  const nPredicoes = Object.keys(predicoes).length;
  const faltando = [...estado.idsEsperados].filter((id) => !(id in predicoes));

  itens.push({
    ok: nPredicoes === estado.idsEsperados.size && faltando.length === 0,
    texto:
      faltando.length === 0
        ? `${nPredicoes} predições, uma para cada processo do teste`
        : `faltam ${faltando.length} processos do teste (ex.: ${faltando.slice(0, 3).join(", ")})`,
  });
  itens.push({
    ok: problemas.naoNumerico === 0,
    texto: problemas.naoNumerico
      ? `${problemas.naoNumerico} linha(s) com probabilidade que não é número`
      : "todas as probabilidades são números",
  });
  itens.push({
    ok: problemas.foraDaFaixa === 0,
    texto: problemas.foraDaFaixa
      ? `${problemas.foraDaFaixa} valor(es) fora do intervalo de 0 a 1 (é probabilidade, não classe)`
      : "todas as probabilidades estão entre 0 e 1",
  });
  itens.push({
    ok: problemas.duplicados === 0,
    texto: problemas.duplicados
      ? `${problemas.duplicados} id(s) repetido(s): ficaria valendo o último`
      : "nenhum id repetido",
  });
  if (problemas.desconhecidos.length) {
    itens.push({
      ok: false,
      texto: `ids que não estão no teste: ${problemas.desconhecidos.join(", ")}`,
    });
  }

  // Um sinal de erro comum: mandar 0 e 1 em vez de probabilidade.
  const valores = Object.values(predicoes);
  const soZeroUm = valores.length && valores.every((v) => v === 0 || v === 1);
  if (soZeroUm) {
    itens.push({
      ok: true,
      aviso: true,
      texto:
        "todas as predições são 0 ou 1. Funciona, mas a AUC fica bem pior do que com " +
        "probabilidade: use predict_proba, não predict.",
    });
  }

  const tudoOk = itens.every((i) => i.ok);
  return { itens, predicoes: tudoOk ? predicoes : null, nome };
}

async function lerArquivo(arquivo) {
  if (!arquivo) return;
  const texto = await arquivo.text();
  const { itens, predicoes } = conferir(texto, arquivo.name);
  estado.predicoes = predicoes;
  estado.arquivo = arquivo.name;

  const alvo = limpar($("#conferencia"));
  alvo.append(
    el("span.rotulo", { texto: `conferência de ${arquivo.name}` }),
    el(
      "div.conferencia",
      {},
      itens.map((i) =>
        el(`div.item.${i.ok ? "ok" : "erro"}`, {}, [
          el("span.marca", { texto: i.ok ? (i.aviso ? "!" : "✓") : "✗" }),
          el("span", { texto: i.texto }),
        ])
      )
    )
  );

  if (predicoes) {
    alvo.append(
      aviso("ok", "Arquivo válido", "Dá para submeter. Confira o apelido antes: a turma vê isso.")
    );
    $("#s-submeter").classList.remove("travada");
  } else {
    alvo.append(
      aviso(
        "erro",
        "Arquivo com problema",
        "Corrija e suba de novo. Nenhuma submissão foi gasta: a conferência acontece antes."
      )
    );
    $("#s-submeter").classList.add("travada");
  }
}

/* ---------- submissão --------------------------------------------------- */

async function submeter() {
  if (!estado.predicoes) return toast("Suba um arquivo válido primeiro.");
  const apelido = $("#apelido").value.trim();
  if (apelido.length < 3) return toast("Escolha um apelido para o ranking.");
  if (estado.submissoes >= MAX_SUBMISSOES) {
    return toast(`Você já usou as ${MAX_SUBMISSOES} submissões.`);
  }

  const botao = $("#b-submeter");
  const status = $("#status-submissao");
  botao.disabled = true;
  status.replaceChildren(el("span.carregando", { texto: "avaliando no servidor" }));

  const aucValidacao = Number($("#auc-validacao").value) || null;

  try {
    const resposta = await fetch(`${CONFIG.proxy}/ex08/avaliar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: estado.identidade.email,
        apelido,
        descricao: $("#descricao").value.trim(),
        predicoes: estado.predicoes,
      }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados?.erro || `servidor respondeu ${resposta.status}`);

    estado.submissoes = dados.submissoes_usadas ?? estado.submissoes + 1;
    estado.melhorAuc = Math.max(estado.melhorAuc ?? 0, dados.auc);
    status.replaceChildren(el("span.etiqueta.ok", { texto: "avaliado" }));
    $("#contador-submissoes").textContent =
      `${estado.submissoes} de ${dados.limite_submissoes ?? MAX_SUBMISSOES} submissões`;
    if (estado.submissoes >= (dados.limite_submissoes ?? MAX_SUBMISSOES)) {
      botao.disabled = true;
      botao.title = "Você usou as submissões disponíveis.";
    }

    const referencia =
      dados.referencia?.modelo_baseline ?? dados.referencia?.modelo_do_professor ?? null;
    const passou = referencia != null && dados.auc > referencia;
    limpar($("#painel-resultado")).append(
      el("div.grade.tres", {}, [
        el("div.ficha.destaque", {}, [
          el("span.rotulo", { texto: "sua AUC no teste" }),
          el("div.numerao", { texto: formatar(dados.auc, 4) }),
          el("div.miudo", { texto: `${dados.n_avaliado} processos avaliados` }),
        ]),
        el("div.ficha", {}, [
          el("span.rotulo", { texto: "modelo baseline" }),
          el("div.numerao", { texto: formatar(referencia, 4) }),
          el("div.miudo", {
            texto: passou ? "você passou do piso" : "ainda abaixo do piso esperado",
          }),
        ]),
        el("div.ficha", {}, [
          el("span.rotulo", { texto: "sua validação no treino" }),
          el("div.numerao", { texto: aucValidacao == null ? "—" : formatar(aucValidacao, 4) }),
          el("div.miudo", {
            texto:
              aucValidacao == null
                ? "você não informou"
                : Math.abs(aucValidacao - dados.auc) > 0.05
                ? "diferença grande: cuidado com sobreajuste"
                : "coerente com o teste",
          }),
        ]),
      ]),
      dados.registrado
        ? aviso("ok", "Submissão registrada", "O ranking usa a sua melhor submissão.")
        : aviso(
            "atencao",
            "Avaliado, mas não registrado no ranking",
            "O servidor calculou a métrica e não conseguiu gravar. Avise o professor, mostrando esta tela."
          )
    );

    await registrarSubmissao({
      exercicio: EXERCICIO,
      etapa: "submissao",
      identificacao: estado.identidade,
      apelido,
      descricao: $("#descricao").value.trim(),
      arquivo: estado.arquivo,
      auc_teste: dados.auc,
      auc_validacao: aucValidacao,
      submissao_numero: estado.submissoes,
      monitoramento: estado.guarda.resumo(),
    });
    atualizarPlacar();
  } catch (erro) {
    status.replaceChildren(el("span.etiqueta.erro", { texto: "recusado" }));
    limpar($("#painel-resultado")).append(
      aviso("erro", "Não foi possível avaliar", String(erro.message || erro))
    );
    botao.disabled = false;
  }
}

/* ---------- ranking ----------------------------------------------------- */

async function atualizarPlacar() {
  const status = $("#status-placar");
  status.replaceChildren(el("span.carregando", { texto: "buscando" }));
  try {
    const resposta = await fetch(`${CONFIG.proxy}/ex08/leaderboard`);
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados?.erro || `servidor respondeu ${resposta.status}`);
    const ranking = dados.ranking || [];
    status.replaceChildren(
      el("span.etiqueta", { texto: `${dados.n_participantes} participante(s)` })
    );
    const alvo = limpar($("#painel-placar"));
    if (!ranking.length) alvo.append(el("p.miudo", { texto: "ninguém submeteu ainda." }));
    const meuApelido = $("#apelido").value.trim();
    for (const linha of ranking) {
      alvo.append(
        el(`div.placar-linha${linha.apelido === meuApelido ? ".eu" : ""}`, {}, [
          el("span.pos", { texto: `${linha.posicao}º` }),
          el("span", { texto: linha.apelido }),
          el("span.auc", { texto: formatar(linha.auc, 4) }),
        ])
      );
    }
    desenharEscala(ranking, meuApelido);
  } catch (erro) {
    status.replaceChildren(el("span.etiqueta.alerta", { texto: "ranking indisponível" }));
    limpar($("#painel-placar")).append(
      el("p.miudo", {
        html: paragrafos(
          "O ranking depende de uma configuração no servidor que o professor faz separado. " +
            `A sua nota não depende disso.\n_${esc(String(erro.message || erro))}_`
        ),
      })
    );
    limpar($("#escala"));
  }
}

function desenharEscala(ranking, meuApelido) {
  const escala = limpar($("#escala"));
  if (!ranking.length) return;
  const minimo = 0.5;
  const maximo = Math.max(0.85, ...ranking.map((r) => r.auc));
  for (const linha of ranking) {
    const posicao = ((linha.auc - minimo) / (maximo - minimo)) * 100;
    escala.append(
      el(`div.marca${linha.apelido === meuApelido ? ".voce" : ""}`, {
        style: `left:${Math.min(Math.max(posicao, 0), 100)}%`,
        texto: formatar(linha.auc, 3),
        title: linha.apelido,
      })
    );
  }
}

iniciar().catch((erro) => {
  document.body.prepend(aviso("erro", "Erro ao iniciar", String(erro.message || erro)));
});
