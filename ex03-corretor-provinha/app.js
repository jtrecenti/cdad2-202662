/* ==========================================================================
   Projeto 3 (aula 10) - Corretor das folhas de resposta.

   Ferramenta do professor. A provinha é feita no papel (é isso que impede o
   LLM de resolver a prova no lugar do aluno). Depois, um modelo de visão lê a
   folha de respostas, o app compara com o gabarito e gera nota e feedback.

   Decisões que importam:
   - O gabarito NÃO é publicado com o app: você carrega o arquivo na hora.
   - A leitura do modelo é editável antes de fechar a nota. Letra à mão erra, e
     nota calculada em cima de leitura errada é pior que nota nenhuma.
   - As rotas de LLM usadas aqui exigem o PROF_TOKEN no Worker.
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import { registrarSubmissao } from "../_shared/firebase.js";
import { ErroLLM } from "../_shared/llm.js";
import {
  $, el, limpar, aviso, toast, montarTopo, tabela, paraCSV, baixar, formatar, agora,
} from "../_shared/ui.js";

const EXERCICIO = "ex03";
const CHAVE_TOKEN = "cdad2:prof_token";

const estado = {
  gabarito: null,
  fotos: [],      // {nome, base64, mime, url}
  folhas: [],     // {arquivo, aluno:{nome,email}, respostas:{q: valorTexto}, observacoes, corrigida}
  feedbacks: {},  // email -> texto
};

/* ---------- chamada direta ao gateway (com o token do professor) --------- */

async function chamarProf({ tarefa, sistema, usuario, imagens = null, json = true, maxTokens = 2500 }) {
  if (CONFIG.simularLLM) {
    const { simular } = await import("../_shared/simulacoes.js");
    await new Promise((r) => setTimeout(r, 400));
    return simular({ tarefa, usuario });
  }
  const resposta = await fetch(`${CONFIG.proxy}/llm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Prof-Token": $("#prof-token").value.trim(),
    },
    body: JSON.stringify({
      tarefa,
      modelo: "complexo",
      sistema,
      usuario,
      imagens,
      json,
      max_tokens: maxTokens,
      temperatura: 0,
    }),
  });
  const texto = await resposta.text();
  let dados = null;
  try {
    dados = JSON.parse(texto);
  } catch {
    /* resposta não-JSON */
  }
  if (!resposta.ok) {
    throw new ErroLLM(dados?.erro || `gateway respondeu ${resposta.status}`, resposta.status, dados);
  }
  return { texto: dados?.texto ?? texto, dados: dados?.dados ?? null, modelo: dados?.modelo };
}

/* ---------- arranque ---------------------------------------------------- */

function iniciar() {
  montarTopo({
    exercicio: "Projeto 3",
    aula: "aula 10",
    titulo: "Corretor das folhas de resposta",
    direita: [el("span.etiqueta", { texto: "uso do professor" })],
  });

  const salvo = localStorage.getItem(CHAVE_TOKEN);
  if (salvo) $("#prof-token").value = salvo;
  $("#prof-token").addEventListener("change", (e) =>
    localStorage.setItem(CHAVE_TOKEN, e.target.value.trim())
  );

  $("#arquivo-gabarito").addEventListener("change", carregarGabarito);
  $("#arquivo-fotos").addEventListener("change", carregarFotos);
  $("#b-limpar-fotos").addEventListener("click", () => {
    estado.fotos = [];
    desenharMiniaturas();
  });
  $("#b-ler").addEventListener("click", lerFolhas);
  $("#b-fechar-notas").addEventListener("click", fecharNotas);
  $("#b-feedbacks").addEventListener("click", gerarFeedbacks);
  $("#b-csv").addEventListener("click", baixarCSV);
  $("#b-md").addEventListener("click", baixarMarkdown);
  $("#b-registrar").addEventListener("click", registrar);
}

async function carregarGabarito(evento) {
  const arquivo = evento.target.files?.[0];
  if (!arquivo) return;
  try {
    estado.gabarito = JSON.parse(await arquivo.text());
    if (!Array.isArray(estado.gabarito.questoes)) throw new Error("formato inesperado");
    limpar($("#resumo-gabarito")).append(
      aviso(
        "ok",
        `Gabarito carregado: ${estado.gabarito.titulo}`,
        `${estado.gabarito.questoes.length} questões. ` +
          `Tolerâncias entre ${Math.min(...estado.gabarito.questoes.map((q) => q.tolerancia))} e ` +
          `${Math.max(...estado.gabarito.questoes.map((q) => q.tolerancia))}.`
      )
    );
    $("#s-fotos").classList.remove("travada");
  } catch (erro) {
    limpar($("#resumo-gabarito")).append(
      aviso("erro", "Gabarito inválido", String(erro.message || erro))
    );
  }
}

function carregarFotos(evento) {
  const arquivos = [...(evento.target.files || [])];
  let pendentes = arquivos.length;
  if (!pendentes) return;
  for (const arquivo of arquivos) {
    const leitor = new FileReader();
    leitor.onload = () => {
      const dataURL = String(leitor.result);
      estado.fotos.push({
        nome: arquivo.name,
        mime: arquivo.type || "image/jpeg",
        base64: dataURL.split(",")[1],
        url: dataURL,
      });
      pendentes -= 1;
      if (pendentes === 0) desenharMiniaturas();
    };
    leitor.readAsDataURL(arquivo);
  }
}

function desenharMiniaturas() {
  const alvo = limpar($("#miniaturas"));
  for (const foto of estado.fotos) {
    alvo.append(
      el("figure", {}, [
        el("img", { src: foto.url, alt: foto.nome }),
        el("figcaption", { texto: foto.nome }),
      ])
    );
  }
  $("#contador-fotos").textContent = `${estado.fotos.length} foto(s)`;
  $("#b-ler").disabled = estado.fotos.length === 0;
}

/* ---------- leitura pelo modelo de visão -------------------------------- */

function promptLeitura() {
  const questoes = estado.gabarito.questoes
    .map((q) => `Q${q.id} (${q.unidade})`)
    .join("\n");
  return [
    "Esta imagem é a FOLHA DE RESPOSTAS de uma prova de estatística, preenchida à mão.",
    "Leia o nome e o e-mail no cabeçalho e o valor escrito em cada linha da tabela.",
    "",
    "Linhas esperadas na tabela:",
    questoes,
    "",
    "Regras de leitura:",
    "- Transcreva exatamente o que está escrito, sem corrigir e sem calcular nada.",
    "- Vírgula decimal vira ponto (0,1234 -> 0.1234).",
    '- Se a linha estiver em branco, use "" e confianca "baixa".',
    '- Se você não tiver certeza do dígito, mantenha a leitura e marque confianca "baixa".',
    '- confianca: "alta", "media" ou "baixa".',
    "",
    'Formato: {"aluno": {"nome": "...", "email": "..."}, "respostas": [{"questao": "1", "valor_lido": "0.1234", "confianca": "alta"}], "observacoes": "..."}',
  ].join("\n");
}

async function lerFolhas() {
  const botao = $("#b-ler");
  const status = $("#status-leitura");
  const barra = $("#barra-leitura");
  botao.disabled = true;
  estado.folhas = [];

  for (let i = 0; i < estado.fotos.length; i += 1) {
    const foto = estado.fotos[i];
    status.replaceChildren(
      el("span.carregando", { texto: `lendo ${i + 1} de ${estado.fotos.length}: ${foto.nome}` })
    );
    try {
      const resposta = await chamarProf({
        tarefa: "ex03_corrigir",
        sistema:
          "Você transcreve folhas de resposta manuscritas. Você não resolve a prova, " +
          "não corrige o aluno e não completa valores: transcreve o que está escrito. " +
          "Responda apenas com o JSON pedido.",
        usuario: promptLeitura(),
        imagens: [{ base64: foto.base64, mime: foto.mime }],
        maxTokens: 2000,
      });
      const lido = resposta.dados || {};
      estado.folhas.push({
        arquivo: foto.nome,
        aluno: {
          nome: lido.aluno?.nome || "",
          email: (lido.aluno?.email || "").toLowerCase().trim(),
        },
        respostas: Object.fromEntries(
          (lido.respostas || []).map((r) => [String(r.questao), String(r.valor_lido ?? "")])
        ),
        confianca: Object.fromEntries(
          (lido.respostas || []).map((r) => [String(r.questao), r.confianca || "media"])
        ),
        observacoes: lido.observacoes || "",
      });
    } catch (erro) {
      estado.folhas.push({
        arquivo: foto.nome,
        aluno: { nome: "", email: "" },
        respostas: {},
        confianca: {},
        observacoes: "",
        erro: String(erro.message || erro),
      });
    }
    barra.style.width = `${((i + 1) / estado.fotos.length) * 100}%`;
  }

  status.replaceChildren(
    el("span.etiqueta.ok", { texto: `${estado.folhas.length} folha(s) lida(s)` })
  );
  botao.disabled = false;
  $("#s-revisao").classList.remove("travada");
  desenharRevisao();
}

/* ---------- revisão ----------------------------------------------------- */

function corrigirFolha(folha) {
  let acertos = 0;
  const detalhe = [];
  for (const q of estado.gabarito.questoes) {
    const bruto = (folha.respostas[q.id] ?? "").toString().trim().replace(",", ".");
    const valor = bruto === "" ? null : Number(bruto);
    const valido = valor != null && Number.isFinite(valor);
    const certo = valido && Math.abs(valor - q.resposta) <= q.tolerancia;
    if (certo) acertos += 1;
    detalhe.push({
      questao: q.id,
      tema: q.tema,
      lido: bruto,
      esperado: q.resposta,
      tolerancia: q.tolerancia,
      certo,
      em_branco: bruto === "",
      ilegivel: bruto !== "" && !valido,
    });
  }
  const total = estado.gabarito.questoes.length;
  return { acertos, total, nota: (acertos / total) * 10, detalhe };
}

function desenharRevisao() {
  const alvo = limpar($("#folhas-lidas"));
  estado.folhas.forEach((folha, indice) => {
    const resultado = corrigirFolha(folha);
    const duvida =
      folha.erro ||
      !folha.aluno.email.endsWith("@al.insper.edu.br") ||
      Object.values(folha.confianca).some((c) => c === "baixa");
    const caixa = el(`div.folha-lida.${folha.erro ? "duvida" : duvida ? "duvida" : "ok"}`);

    const campoNome = el("input", { type: "text", value: folha.aluno.nome, placeholder: "nome" });
    campoNome.addEventListener("input", () => (folha.aluno.nome = campoNome.value));
    const campoEmail = el("input", {
      type: "email", value: folha.aluno.email, placeholder: "email@al.insper.edu.br",
    });
    campoEmail.addEventListener("input", () => (folha.aluno.email = campoEmail.value.trim().toLowerCase()));

    const nota = el("span.etiqueta", {
      texto: `${resultado.acertos}/${resultado.total} · nota ${formatar(resultado.nota, 1)}`,
    });

    caixa.append(
      el("div.cabeca", {}, [
        el("span.etiqueta.tipo-id", { texto: folha.arquivo }),
        el("div", { style: "flex:1;min-width:12rem" }, [
          el("span.rotulo", { texto: "nome lido" }),
          campoNome,
        ]),
        el("div", { style: "flex:1;min-width:14rem" }, [
          el("span.rotulo", { texto: "e-mail lido" }),
          campoEmail,
        ]),
        nota,
      ])
    );

    if (folha.erro) {
      caixa.append(aviso("erro", "Falha ao ler esta folha", folha.erro));
    }

    const grade = el("div.respostas-lidas", { style: "margin-top:.6rem" });
    for (const item of resultado.detalhe) {
      const campo = el("input", {
        type: "text", value: item.lido, "aria-label": `resposta da questão ${item.questao}`,
      });
      campo.addEventListener("input", () => {
        folha.respostas[item.questao] = campo.value;
        desenharLinhaNota(indice, nota);
      });
      const confianca = folha.confianca[item.questao];
      grade.append(
        el("div.resposta-lida", {}, [
          el("span.q", { texto: `Q${item.questao}` }),
          campo,
          el("span.marca", {
            texto: item.certo ? "✓" : item.em_branco ? "·" : "✗",
            style: `color:${item.certo ? "#1a8c68" : item.em_branco ? "#808080" : "#e50505"}`,
            title: `esperado ${item.esperado} ± ${item.tolerancia}`,
          }),
          confianca === "baixa" ? el("span.etiqueta.alerta", { texto: "dúvida" }) : null,
        ])
      );
    }
    caixa.append(grade);
    if (folha.observacoes) {
      caixa.append(el("p.miudo", { style: "margin-top:.5rem", texto: `Modelo anotou: ${folha.observacoes}` }));
    }
    alvo.append(caixa);
  });
}

function desenharLinhaNota(indice, etiqueta) {
  const r = corrigirFolha(estado.folhas[indice]);
  etiqueta.textContent = `${r.acertos}/${r.total} · nota ${formatar(r.nota, 1)}`;
}

/* ---------- notas ------------------------------------------------------- */

function fecharNotas() {
  const semEmail = estado.folhas.filter((f) => !f.aluno.email.endsWith("@al.insper.edu.br"));
  if (semEmail.length) {
    toast(`${semEmail.length} folha(s) sem e-mail institucional válido. Corrija antes de fechar.`);
    return;
  }
  $("#s-saida").classList.remove("travada");
  const linhas = estado.folhas.map((folha) => {
    const r = corrigirFolha(folha);
    const linha = {
      email: folha.aluno.email,
      nome: folha.aluno.nome,
      acertos: r.acertos,
      total: r.total,
      nota: Number(r.nota.toFixed(2)),
      em_branco: r.detalhe.filter((d) => d.em_branco).length,
    };
    for (const d of r.detalhe) linha[`q${d.questao}`] = d.certo ? 1 : 0;
    return linha;
  });
  estado.linhas = linhas;

  const colunas = Object.keys(linhas[0] || { email: "" });
  const acertosPorQuestao = estado.gabarito.questoes.map((q) => {
    const certos = estado.folhas.filter((f) => corrigirFolha(f).detalhe.find((d) => d.questao === q.id)?.certo).length;
    return { questao: q.id, tema: q.tema, acertos: certos, de: estado.folhas.length,
      taxa: estado.folhas.length ? Math.round((certos / estado.folhas.length) * 100) + "%" : "—" };
  });

  limpar($("#painel-notas")).append(
    el("h3", { texto: "Notas" }),
    tabela(colunas, linhas, { numericas: colunas.filter((c) => c !== "email" && c !== "nome") }),
    el("h3", { texto: "Acertos por questão (onde a turma travou)" }),
    tabela(["questao", "tema", "acertos", "de", "taxa"], acertosPorQuestao, { numericas: ["acertos", "de"] })
  );
  $("#status-notas").replaceChildren(
    el("span.etiqueta.ok", { texto: `${linhas.length} aluno(s) corrigido(s)` })
  );
}

/* ---------- feedback por aluno ------------------------------------------ */

async function gerarFeedbacks() {
  if (!estado.folhas.length) return toast("Leia as folhas primeiro.");
  const status = $("#status-notas");
  const alvo = limpar($("#painel-feedbacks"));
  $("#s-saida").classList.remove("travada");

  for (let i = 0; i < estado.folhas.length; i += 1) {
    const folha = estado.folhas[i];
    const r = corrigirFolha(folha);
    status.replaceChildren(
      el("span.carregando", { texto: `feedback ${i + 1} de ${estado.folhas.length}` })
    );
    const erradas = r.detalhe.filter((d) => !d.certo);
    const usuario = [
      `Aluno: ${folha.aluno.nome || folha.aluno.email}`,
      `Acertos: ${r.acertos} de ${r.total}.`,
      "",
      "Questões erradas ou em branco (com o que se pedia, a resposta do aluno, a resposta correta e a resolução):",
      ...erradas.map((d) => {
        const q = estado.gabarito.questoes.find((x) => x.id === d.questao);
        return [
          `- Q${d.questao} (${q.tema}): ${q.enunciado}`,
          `  resposta do aluno: ${d.em_branco ? "(em branco)" : d.lido}`,
          `  resposta correta: ${q.resposta} ${q.unidade}`,
          `  resolução: ${q.resolucao}`,
        ].join("\n");
      }),
      "",
      "Questões certas: " + r.detalhe.filter((d) => d.certo).map((d) => `Q${d.questao}`).join(", "),
      "",
      "Escreva um feedback curto (no máximo 200 palavras), em português, dirigido ao aluno:",
      "1. o que ele mostrou dominar;",
      "2. para cada erro, qual foi o provável raciocínio equivocado (não repita a resolução inteira, aponte o passo em que ele se perdeu);",
      "3. um conselho de estudo concreto, ligado ao tipo de erro que ele cometeu.",
      "Se houver padrão nos erros (por exemplo, confundir P(A|B) com P(B|A), ou trocar desvio padrão por erro padrão), nomeie o padrão.",
      "Não use travessões.",
    ].join("\n");

    try {
      const resposta = await chamarProf({
        tarefa: "ex03_feedback",
        sistema:
          "Você é monitor de uma disciplina de estatística aplicada ao Direito. Escreve feedback " +
          "formativo, direto e respeitoso, para o aluno ler sozinho. Responde em texto corrido, " +
          "sem JSON.",
        usuario,
        json: false,
        maxTokens: 700,
      });
      estado.feedbacks[folha.aluno.email || folha.arquivo] = resposta.texto;
      alvo.append(
        el("div.feedback", {}, [
          el("h4", { texto: `${folha.aluno.nome || folha.aluno.email} · ${r.acertos}/${r.total}` }),
          el("div.feedback-aluno", { texto: resposta.texto }),
        ])
      );
    } catch (erro) {
      alvo.append(
        aviso("erro", `Falhou o feedback de ${folha.aluno.email || folha.arquivo}`, String(erro.message || erro))
      );
    }
  }
  status.replaceChildren(el("span.etiqueta.ok", { texto: "feedbacks gerados" }));
}

/* ---------- saída ------------------------------------------------------- */

function baixarCSV() {
  if (!estado.linhas?.length) return toast("Feche as notas primeiro.");
  const colunas = Object.keys(estado.linhas[0]);
  baixar(
    `ex03_notas_${new Date().toISOString().slice(0, 10)}.csv`,
    paraCSV(colunas, estado.linhas),
    "text/csv;charset=utf-8",
    true
  );
}

function baixarMarkdown() {
  const partes = [
    `# Projeto 3 - feedback individual`,
    `Provinha: ${estado.gabarito?.titulo}`,
    `Gerado em ${agora()}`,
    "",
  ];
  for (const folha of estado.folhas) {
    const r = corrigirFolha(folha);
    const chave = folha.aluno.email || folha.arquivo;
    partes.push(
      `## ${folha.aluno.nome || chave}`,
      `- e-mail: ${folha.aluno.email}`,
      `- acertos: ${r.acertos} de ${r.total} (nota ${r.nota.toFixed(1)})`,
      `- erradas: ${r.detalhe.filter((d) => !d.certo).map((d) => "Q" + d.questao).join(", ") || "nenhuma"}`,
      "",
      estado.feedbacks[chave] || "_feedback não gerado_",
      ""
    );
  }
  baixar(`ex03_feedbacks_${new Date().toISOString().slice(0, 10)}.md`, partes.join("\n"),
    "text/markdown;charset=utf-8");
}

async function registrar() {
  if (!estado.folhas.length) return toast("Nada para registrar.");
  const status = $("#status-saida");
  status.replaceChildren(el("span.carregando", { texto: "registrando" }));
  let ok = 0;
  for (const folha of estado.folhas) {
    const r = corrigirFolha(folha);
    const resultado = await registrarSubmissao({
      exercicio: EXERCICIO,
      etapa: "correcao",
      origem: "professor",
      identificacao: { email: folha.aluno.email, grupo: "", integrantes: [folha.aluno.email], em_grupo: false },
      nome_lido: folha.aluno.nome,
      arquivo: folha.arquivo,
      acertos: r.acertos,
      total: r.total,
      nota: Number(r.nota.toFixed(2)),
      por_questao: r.detalhe.map(({ questao, certo, lido, em_branco }) => ({ questao, certo, lido, em_branco })),
      feedback: estado.feedbacks[folha.aluno.email || folha.arquivo] || null,
    });
    if (resultado.ok) ok += 1;
  }
  status.replaceChildren(
    el(`span.etiqueta.${ok === estado.folhas.length ? "ok" : "alerta"}`, {
      texto: `${ok} de ${estado.folhas.length} registrado(s)`,
    })
  );
}

iniciar();
