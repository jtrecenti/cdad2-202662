/* ==========================================================================
   Quest do planejamento (aula 12), na tela do grupo.

   Cada grupo pega um problema e uma pergunta ruim, e constrói a pesquisa em
   sete etapas, na ordem do Projeto 4. Cada etapa ensina antes de pedir: a
   explicação vem aberta, em texto corrido e com exemplos, e só depois, abaixo
   de uma régua, a tarefa. Quem julga cada etapa é a IA, no Worker: o app só
   mostra o que o servidor decidiu, e por isso não há como passar de etapa
   editando a página.

   Ganha quem foi barrado menos vezes. O tempo só desempata, e o placar das
   barradas fica escondido até o fim: o telão mostra só a etapa de cada grupo.
   Ao terminar, o grupo abre os slides gerados do próprio plano e, quando o
   professor abre a troca, avalia o plano de outro grupo pelos sete critérios
   do Projeto 4.

   Sem guardrails: a quest é atividade de aula, sem nota individual, e o grupo
   precisa colar o código que o juscraper-app gera. Copiar e colar é livre, e
   nada é monitorado.
   ========================================================================== */

import { CONFIG } from "../_shared/config.js";
import { exigirIdentificacao } from "../_shared/identidade.js";
import { exigirLiberacao, garantirModoProfessor, senhaProfessor } from "../_shared/liberacao.js";
import { $, el, limpar, aviso, toast, montarTopo } from "../_shared/ui.js";
import { respostasExemplo } from "./exemplo.js";

const EXERCICIO = "quest";
const CHAVE_GRUPO = "cdad2:quest:grupo";
const PARAMS = new URLSearchParams(location.search);
const TESTE = PARAMS.get("teste") === "1";
// ?previa=1 abre a prévia navegável dos enunciados, para o professor revisar.
// Com ?prof=1 e a senha da equipe, cada etapa mostra também o critério do juiz
// e o gabarito do tema.
const PREVIA = PARAMS.get("previa") === "1";
// Os slides abrem em outra página: leva junto o ?proxy de quem está testando.
const PROXY_NA_URL = PARAMS.get("proxy") ? `&proxy=${encodeURIComponent(PARAMS.get("proxy"))}` : "";
const GRUPO_TESTE = 20;
const JUSCRAPER_APP = "https://lab-dados.github.io/juscraper-app/";
const INTERVALO_TROCA_MS = 6000;

const TIPOS = [
  "identificador", "categórica nominal", "categórica ordinal", "categórica binária",
  "numérica discreta", "numérica contínua", "data",
];
const PAPEIS = ["identifica o caso", "desfecho", "pode explicar", "define quem entra"];

/*
 * As etapas. Os ids são os do Worker, que é quem guarda o critério de cada uma.
 * `conceito` e `tarefa` são HTML escrito aqui, e não vindo de fora: é o
 * material de leitura da etapa.
 */
const ETAPAS = [
  {
    id: "diagnostico",
    curto: "defeito",
    titulo: "Por que essa pergunta não serve?",
    conceito: `
      <p>Toda pesquisa empírica começa com uma pergunta que os dados conseguem responder. Parece
      óbvio, mas muita pergunta interessante do Direito não é desse tipo. "O juiz deveria conceder
      mais liminares?" é uma pergunta sobre como as coisas deveriam ser: a resposta depende do que
      cada um acha justo, e nenhuma planilha encerra essa discussão. Já "em quantos casos o juiz
      concedeu a liminar?" é uma pergunta sobre como as coisas são, e aí os dados têm o que
      dizer.</p>
      <p>Para os dados responderem, a pergunta precisa deixar claro de quais casos está falando
      (ações de despejo? acórdãos de apelação?), de onde e de quando eles são (do TJSP,
      distribuídos em 2024) e o que vai ser observado em cada um (se a liminar foi concedida,
      quantos dias o processo levou). Se falta uma dessas peças, não dá nem para começar a juntar
      os casos.</p>
      <p>Alguns tropeços aparecem muito. Palavras como "deveria", "justo" ou "melhor" puxam a
      pergunta para o terreno da opinião. Verbos como "funciona" ou "é eficiente" soam empíricos,
      mas não dizem o que medir. "Faz com que" e "por causa de" prometem uma relação de causa que
      dados de processos, sozinhos, não conseguem mostrar. Às vezes os dados simplesmente não
      chegam aonde a pergunta quer chegar: acórdãos contam os casos que viraram processo e subiram
      ao tribunal, e não todas as pessoas que passaram pela situação. E há um defeito mais sutil,
      quando o jeito de escolher os casos já decide a resposta: estudar quanto tempo os processos
      demoram olhando só os que já terminaram, que tendem a ser justamente os mais rápidos.</p>`,
    tarefa:
      "Leiam a pergunta ruim do problema e expliquem, com as palavras de vocês, o que nela " +
      "impede a pesquisa. Não basta dizer que é vaga: digam o que falta ou o que está errado.",
    placeholder: "Essa pergunta não serve porque…",
    minimo: 40,
  },
  {
    id: "pergunta",
    curto: "pergunta",
    titulo: "Pergunta de pesquisa",
    conceito: `
      <p>Um jeito de chegar a uma boa pergunta é escrever uma frase que diga de quais casos se
      trata, de onde, de quando, e o que se quer saber sobre eles. Algo como: "Nas ações de
      cobrança de condomínio distribuídas no foro central do TJSP em 2024, em que proporção houve
      acordo nos primeiros seis meses?". Não precisa ser elegante; precisa ser possível de
      responder.</p>
      <p>O "de quando" merece atenção, porque há dois jeitos de dizê-lo, e eles levam a pesquisas
      diferentes. Dá para escolher os casos pela data em que começaram ("processos distribuídos
      em 2024") ou pela data em que foram decididos ("acórdãos julgados em agosto de 2026"). No
      primeiro jeito entram também os processos que ainda estão correndo; no segundo, só os que já
      chegaram a uma decisão. Se a pergunta é sobre quanto tempo os processos levam ou sobre como
      costumam terminar, o primeiro jeito é o que não distorce a resposta. Se é sobre o que o
      tribunal decide, o segundo funciona bem.</p>
      <p>O "de onde" é o recorte geográfico: um tribunal, uma comarca, um grupo de varas. Um
      recorte menor deixa a pesquisa viável e os casos mais parecidos entre si, com o preço de que
      a conclusão vale só para aquele lugar. E vale pensar em qual é a unidade que vocês vão
      contar: um mesmo processo pode gerar vários acórdãos (a apelação, os embargos), e uma mesma
      pessoa pode ter vários processos.</p>`,
    tarefa:
      "Escrevam a pergunta que vocês vão responder sobre o problema: de quais casos, de onde, de " +
      "quando, e o que vão observar em cada um.",
    placeholder: "Nos processos de … distribuídos no … entre … e …, …?",
    minimo: 50,
  },
  {
    id: "fonte",
    curto: "lista",
    titulo: "Lista de processos",
    conceito: `
      <p>Com a pergunta pronta, o próximo passo é descobrir quais processos ela alcança e onde eles
      estão. Essa lista é a base de tudo o que vem depois: é dela que saem os casos que vocês vão
      analisar.</p>
      <p>A escolha da fonte segue o "de quando" da pergunta. Se vocês escolheram os casos pela data
      de entrada, a pesquisa é o que se chama de <b>estudo prospectivo</b>: parte dos processos
      distribuídos num período e acompanha cada um até onde ele chegou, tenha terminado ou não. É o
      desenho certo para perguntas sobre tempo e sobre como os processos terminam. No
      juscraper-app, isso se faz pela aba Processos (DataJud), que lista os processos pela data de
      ajuizamento e traz as movimentações de cada um.</p>
      <p>Se vocês escolheram os casos pela data da decisão, a pesquisa é um <b>estudo
      retrospectivo</b>: olha para trás, a partir de decisões já tomadas, e serve para entender o
      que o tribunal costuma decidir. No app, as abas Jurisprudência (2º grau) e Banco de
      Sentenças (1º grau) fazem esse tipo de busca. O que não dá é misturar os dois: medir o tempo
      dos processos só com os que já têm sentença deixa de fora os mais demorados, e o resultado sai
      mais otimista do que a realidade.</p>
      <p>Duas coisas para ter em mente na hora de buscar. A busca por palavra na jurisprudência
      encontra qualquer decisão que use aquelas palavras, até de outros assuntos, e não encontra os
      processos que nunca tiveram decisão publicada; por isso vale filtrar também pela classe e
      pelo assunto. E toda lista deixa gente de fora: quem não recorreu não aparece no 2º grau,
      quem fez acordo pode nem chegar a uma decisão, processos em segredo de justiça não aparecem, e
      o que foi cadastrado com a classe errada escapa do filtro. Saber o que a lista não vê faz
      parte do plano.</p>`,
    tarefaHtml: `
      <p>Agora é fazer a busca de verdade e trazer o código dela. O caminho no juscraper-app é
      este:</p>
      <ol>
        <li>Abram <a href="${JUSCRAPER_APP}" target="_blank" rel="noopener">o juscraper-app</a> em
        outra aba. Na primeira vez ele demora uns segundos, porque carrega o Python dentro do
        navegador.</li>
        <li>Escolham a aba de acordo com o desenho: Processos (DataJud) para um estudo
        prospectivo; Jurisprudência (2º grau) ou Banco de Sentenças (1º grau) para um
        retrospectivo.</li>
        <li>Escolham o tribunal e preencham o recorte. No DataJud, são as datas de ajuizamento e o
        código da classe processual; se a lista de códigos não abrir, dá para digitar o código
        direto, e o link "Consultar os códigos na TPU", logo abaixo do campo, ajuda a encontrá-lo.
        Na jurisprudência, são o termo de busca e as datas de julgamento, e, se quiserem, a
        classe.</li>
        <li>Cliquem em "Calcular e estimar" e anotem quantos processos (no DataJud) ou quantas
        páginas de 20 decisões (na jurisprudência) apareceram. Se passar do limite do app (10.000
        processos, ou 5.000 com movimentações), diminuam o período.</li>
        <li>Baixem a lista (vocês vão precisar de um processo dela na próxima etapa).</li>
        <li>Logo abaixo do botão fica a caixa "Código equivalente". Cliquem em "Copiar código" e
        colem no primeiro campo aqui embaixo.</li>
      </ol>`,
    minimo: 60,
    campos: "fonte",
  },
  {
    id: "consulta",
    curto: "consulta",
    titulo: "Consulta",
    conceito: `
      <p>A lista diz quais são os processos. Para saber o que aconteceu em cada um, é preciso
      abri-lo, e é aí que se descobre se a pesquisa é mesmo viável: a informação que a pergunta
      pede está lá? Cada fonte mostra um pedaço diferente do processo. O DataJud mostra a classe, o
      assunto, a vara e as movimentações, cada uma com data e código, mas não traz o texto das
      decisões, os nomes das partes nem o valor da causa. A consulta processual do próprio tribunal
      (no TJSP, o e-SAJ) mostra as partes, os advogados, as movimentações e as decisões. A
      jurisprudência e o banco de sentenças trazem o texto do acórdão ou da sentença. E o jus.br, da
      Plataforma Digital do Poder Judiciário, reúne a consulta de vários tribunais e mostra os
      documentos públicos dos autos, com login gov.br.</p>
      <p>As fontes nem sempre concordam. O DataJud às vezes para de atualizar um processo: a
      sentença aparece no e-SAJ e não chega à lista, ou um processo com a distribuição cancelada
      fica no DataJud como se ainda estivesse correndo. Abrir alguns processos no e-SAJ é o jeito
      de descobrir isso antes de confiar nos números.</p>
      <p>Nem tudo é aberto. Qualquer pessoa, sem login, pode ver o número, a classe, o assunto, as
      partes e os advogados, as movimentações e a íntegra das decisões (Resolução CNJ 121/2010,
      art. 2º). Com login gov.br, o jus.br mostra também os documentos públicos dos autos. Já o
      processo inteiro, com petições, contratos e provas, fica restrito a quem atua nele:
      advogados, partes e Ministério Público (art. 3º). Pesquisadores costumam conseguir esse
      acesso por convênio com o tribunal. E os processos de família e da infância correm em
      segredo de justiça (CPC, art. 189), longe de qualquer consulta aberta.</p>
      <p>Parte do que a pesquisa precisa já vem pronta, como a data de uma movimentação. Outra
      parte vocês vão construir lendo o texto: o motivo pelo qual um processo foi extinto, se o
      acórdão fala em transação fora do perfil do cliente. Uma IA pode fazer essa leitura em
      escala, desde que o texto exista e esteja acessível, e desde que alguém confira à mão uma
      parte do que ela extraiu.</p>`,
    tarefaHtml: `
      <p>Escolham um processo de verdade da lista que vocês baixaram (de preferência um do meio da
      lista, e não o primeiro) e abram esse processo. Os caminhos:</p>
      <ul>
        <li>a consulta processual do TJSP, aberta a qualquer pessoa:
        <a href="https://esaj.tjsp.jus.br/cpopg/open.do" target="_blank" rel="noopener">1º grau</a>
        e <a href="https://esaj.tjsp.jus.br/cposg/open.do" target="_blank" rel="noopener">2º
        grau</a>. Colem o número no campo "Número do processo" e cliquem em "Consultar". No 2º
        grau, se abrir a tela "Selecione o processo", cliquem na apelação (ou no agravo);</li>
        <li>as decisões de 1º grau: na página do processo, abram a lista completa de
        movimentações. O lançamento da sentença (e o "Remetido ao DJE", com o teor do ato) traz o
        texto da decisão;</li>
        <li>o acórdão inteiro: na aba Jurisprudência do juscraper-app vem a ementa; o PDF da
        íntegra abre pelo link do acórdão na <a href="https://esaj.tjsp.jus.br/cjsg/consultaCompleta.do"
        target="_blank" rel="noopener">consulta de jurisprudência do TJSP</a>, sem login;</li>
        <li>o <a href="https://www.jus.br" target="_blank" rel="noopener">jus.br</a> ("Consultar
        processo") reúne os tribunais, mas pede login gov.br.</li>
      </ul>
      <p>Anotem abaixo o número do processo, o que encontraram nele que ajuda a responder à
      pergunta de vocês (e qual seria o valor do desfecho nesse caso), e onde estava cada
      informação.</p>`,
    campos: "consulta",
  },
  {
    id: "variaveis",
    curto: "variáveis",
    titulo: "Variáveis",
    conceito: `
      <p>Vocês já fizeram isso nas três primeiras aulas da disciplina, quando classificaram as
      variáveis de uma base de processos. Aqui o exercício é o mesmo, só que para a pesquisa de
      vocês: cada informação que vocês vão anotar sobre um processo vira uma coluna da tabela, e
      cada coluna precisa estar bem definida, para que duas pessoas olhando o mesmo processo
      anotem a mesma coisa.</p>
      <p>Comecem pelo nome, curto e sem espaços, como <code>dias_ate_liminar</code>. Depois
      vem o tipo: o número do processo é um identificador; categorias sem ordem, como a comarca,
      são categóricas nominais; categorias com ordem, como "baixo, médio, alto", são ordinais; sim
      ou não é binária; contagens são numéricas discretas; valores e tempos são numéricas
      contínuas; e datas são datas.</p>
      <p>Em seguida, o papel da variável na pergunta. Uma delas é o desfecho, aquilo que vocês
      querem explicar. Outras podem ajudar a explicá-lo. Algumas servem só para definir quais casos
      entram, como o período. E o número do processo serve para identificar o caso. Por último,
      digam como medir: em que parte do processo a informação está e que valores ela pode ter. O
      caso que vocês abriram na etapa anterior ajuda a escrever isso. Por exemplo:
      <code>dias_ate_sentenca</code>, numérica contínua, desfecho, "a data da primeira
      movimentação de sentença menos a data de distribuição; fica vazia se não houver sentença até
      a coleta".</p>
      <p>Três cuidados. Uma pesquisa tem um desfecho só: dois desfechos são duas pesquisas. A mesma
      variável não pode ser, ao mesmo tempo, o desfecho e o que o explica. E o que só acontece
      depois do desfecho não pode explicá-lo: o valor de uma condenação não explica se houve
      condenação.</p>`,
    tarefa:
      "Declarem pelo menos quatro variáveis, com tipo, papel e como medir: o identificador, um " +
      "desfecho, e pelo menos uma que possa ajudar a explicar o desfecho.",
    minimo: 4,
  },
  {
    id: "hipotese",
    curto: "hipóteses",
    titulo: "Hipóteses",
    conceito: `
      <p>A hipótese é o que vocês esperam encontrar, dito de um jeito que os dados possam
      confirmar ou desmentir. Na estatística, ela costuma vir em par. A <b>hipótese nula</b> (H0)
      diz que não há diferença nem relação nenhuma: é o ponto de partida cético. A <b>hipótese
      alternativa</b> (H1) diz o que vocês esperam encontrar, com direção. A pesquisa olha os dados
      para ver se eles se afastam da H0 na direção da H1. Alguns exemplos:</p>
      <ul>
        <li>H0: a proporção de liminares concedidas é a mesma na capital e no interior.<br>H1: a
        proporção é maior no interior.</li>
        <li>H0: o tempo mediano até a sentença é o mesmo nas ações com e sem perícia.<br>H1: o tempo
        mediano é maior nas ações com perícia.</li>
        <li>H0: a proporção de mandados de segurança concedidos não muda conforme a fase em que o
        candidato foi eliminado.<br>H1: a proporção é maior quando a eliminação foi na investigação
        social do que no teste físico.</li>
        <li>H0: o valor da indenização não acompanha o tempo em que o nome ficou negativado.<br>H1:
        quanto mais dias negativado, maior o valor.</li>
      </ul>
      <p>Uma hipótese que não pode dar errado ("o resultado pode variar conforme o caso") não serve,
      porque qualquer dado combina com ela.</p>
      <p>O jeito de olhar os dados depende dos tipos das variáveis. Se o desfecho é uma categoria
      (concedida ou não) e o que pode explicar também é (capital ou interior), comparem a proporção
      do desfecho em cada grupo, numa tabela de dupla entrada, e mostrem num gráfico de barras
      empilhadas. Se o desfecho é um número (dias até a sentença) e o que explica é uma categoria,
      comparem a mediana de cada grupo e mostrem num boxplot. Se os dois são números, um gráfico de
      dispersão mostra como um acompanha o outro. Os testes que dizem se a diferença é grande o
      bastante para rejeitar a H0 vêm depois da prova; por enquanto, basta dizer que tabela ou
      gráfico vai mostrar isso.</p>
      <p>Um cuidado com perguntas sobre tempo: se parte dos processos ainda não terminou, a média
      calculada só com os que terminaram engana. Uma saída simples é olhar a proporção que terminou
      em até 12 ou 24 meses.</p>`,
    tarefa:
      "Escrevam a hipótese nula (H0) e a alternativa (H1), usando as variáveis que vocês " +
      "declararam, e digam que tabela ou gráfico vai mostrar se os dados se afastam da H0.",
    placeholder: "H0: …\nH1: …\nPara ver isso: …",
    minimo: 60,
  },
  {
    id: "limites",
    curto: "limitações",
    titulo: "Limitações",
    conceito: `
      <p>Nenhuma pesquisa responde tudo, e um bom plano diz, desde o começo, onde ela pode falhar.
      As limitações costumam aparecer em dois lugares.</p>
      <p>O primeiro é o método de coleta dos dados: como a lista foi montada e quem ficou de fora
      dela. Quem não recorreu não aparece na jurisprudência de 2º grau; quem fez acordo pode nem
      chegar a uma decisão; processos em segredo de justiça não aparecem; o que foi cadastrado com
      a classe errada escapa do filtro; e o DataJud chega com algumas semanas de atraso. Vale dizer
      também para que lado isso pode puxar o resultado.</p>
      <p>O segundo é o método de mensuração das variáveis: como cada informação vai ser medida.
      Cartórios diferentes lançam as movimentações de jeitos diferentes; a ementa às vezes omite
      justamente o que vocês procuram; a IA pode errar na extração; e uma categoria mal definida
      faz duas pessoas anotarem coisas diferentes no mesmo processo.</p>
      <p>Uma limitação bem escrita é concreta. Em vez de "a amostra pode ter problemas", algo como
      "os processos ainda sem sentença são os mais lentos, então o tempo que vamos calcular fica
      abaixo do real", ou "quando a ementa não diz se o tratamento está no rol, vamos marcar 'não
      informado', e esses casos podem ser diferentes dos outros".</p>`,
    tarefa:
      "Escrevam pelo menos duas limitações concretas da pesquisa de vocês: pelo menos uma ligada " +
      "ao método de coleta dos dados (como a lista foi montada e quem ficou de fora) e uma ligada " +
      "ao método de mensuração das variáveis (como cada informação vai ser medida). Se puderem, " +
      "digam para que lado cada uma pode puxar o resultado.",
    placeholder: "Na coleta dos dados: …\nNa mensuração das variáveis: …",
    minimo: 60,
  },
];

const CRITERIOS_TROCA = [
  { id: "pergunta", nome: "pergunta", ajuda: "Tem população, recorte e desfecho? Dá para responder com dados, sem opinião?" },
  { id: "fonte", nome: "a lista e o que ela não vê", ajuda: "A busca combina com a pergunta (prospectivo ou retrospectivo)? O grupo disse que casos ela não vê?" },
  { id: "variaveis", nome: "variáveis e tipos", ajuda: "Os tipos estão certos? Outra pessoa conseguiria aplicar o \"como medir\"?" },
  { id: "papeis", nome: "papéis", ajuda: "Há um desfecho só? Alguma variável que só existe depois do desfecho está explicando o desfecho?" },
  { id: "hipotese", nome: "hipóteses", ajuda: "H0 e H1 estão no lugar certo, a H1 tem direção e as duas falam das variáveis declaradas?" },
  { id: "analise", nome: "análise", ajuda: "A tabela ou o gráfico combinam com os tipos?" },
  { id: "limites", nome: "limitações", ajuda: "Há uma limitação concreta da coleta dos dados e uma da mensuração das variáveis?" },
];
const NOTAS = [["atende", "atende"], ["em parte", "em parte"], ["nao", "não"]];

const estado = {
  identidade: null,
  temas: [],
  grupo: null,
  dados: null,
  ocupado: false,
  rascunhos: {},
  trocaMontada: false,
  relogio: null,
};

async function pedir(caminho, opcoes = {}) {
  const r = await fetch(`${CONFIG.proxy}${caminho}`, {
    ...opcoes,
    headers: { "Content-Type": "application/json", ...(opcoes.headers || {}) },
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    const erro = new Error(dados.erro || `erro ${r.status}`);
    erro.status = r.status;
    erro.dados = dados;
    throw erro;
  }
  return dados;
}

const temaDe = (id) => estado.temas.find((t) => t.id === id) || null;

/* ---------- arranque ------------------------------------------------------ */

async function iniciar() {
  montarTopo({ exercicio: "Quest", aula: "aula 12", titulo: "Planejamento de pesquisa" });
  const liberacao = await exigirLiberacao(EXERCICIO);
  if (!liberacao.liberado) return;

  estado.identidade = await exigirIdentificacao({
    exercicio: EXERCICIO,
    emGrupo: true,
    titulo: "Quest · quem está no grupo",
    explicacao: "Um computador por grupo. Coloque o seu e-mail e os e-mails do grupo.",
  });

  estado.temas = (await fetch("temas.json").then((r) => r.json())).temas || [];
  const salvo = Number(sessionStorage.getItem(CHAVE_GRUPO));
  if (salvo) {
    estado.grupo = salvo;
    await carregar();
  } else {
    await telaEscolha();
  }
}

/* ---------- grupo e tema -------------------------------------------------- */

async function telaEscolha() {
  const palco = limpar($("#palco"));
  const ocupacao = {};
  try {
    const painel = await pedir("/quest/painel");
    for (const g of painel.grupos || []) {
      if (g.grupo !== GRUPO_TESTE) ocupacao[g.tema] = (ocupacao[g.tema] || 0) + 1;
    }
  } catch {
    /* sem o painel, os cartões saem sem a contagem de vagas */
  }

  const numeros = Array.from({ length: 14 }, (_, i) => i + 1).concat(TESTE ? [GRUPO_TESTE] : []);
  const seletor = el("select", { id: "q-grupo" }, [
    el("option", { value: "", texto: "escolham o número do grupo" }),
    ...numeros.map((n) =>
      el("option", { value: String(n), texto: n === GRUPO_TESTE ? "20 (teste)" : `Grupo ${n}` })
    ),
  ]);
  let temaEscolhido = null;
  const cartoes = estado.temas.map((t) => {
    const usados = ocupacao[t.id] || 0;
    const cartao = el("label.cartao-tema", { for: `t-${t.id}` }, [
      el("span.vagas", { texto: usados ? `${usados} ${usados === 1 ? "grupo" : "grupos"}` : "" }),
      el("div.area", { texto: t.area }),
      el("h4", {}, [
        el("input", { type: "radio", name: "tema", id: `t-${t.id}`, value: t.id }),
        t.titulo,
      ]),
    ]);
    cartao.addEventListener("change", () => {
      temaEscolhido = t.id;
      palco.querySelectorAll(".cartao-tema").forEach((c) => c.classList.remove("marcado"));
      cartao.classList.add("marcado");
    });
    return cartao;
  });

  const erro = el("div");
  const botao = el("button.principal", { type: "button", texto: "começar a quest" });
  botao.addEventListener("click", async () => {
    const grupo = Number(seletor.value);
    if (!grupo) return limpar(erro).append(aviso("erro", null, "Escolham o número do grupo."));
    if (!temaEscolhido) return limpar(erro).append(aviso("erro", null, "Escolham um tema."));
    botao.disabled = true;
    try {
      const r = await pedir("/quest/entrar", {
        method: "POST",
        body: JSON.stringify({ grupo, tema: temaEscolhido, integrantes: estado.identidade.integrantes }),
      });
      sessionStorage.setItem(CHAVE_GRUPO, String(grupo));
      estado.grupo = grupo;
      if (r.retomou && r.grupo.tema !== temaEscolhido) {
        toast(`O grupo ${grupo} já tinha começado, com o tema "${temaDe(r.grupo.tema)?.titulo}".`, 5000);
      }
      await carregar();
    } catch (e) {
      limpar(erro).append(aviso("erro", null, e.message));
      botao.disabled = false;
    }
  });

  palco.append(
    el("section.secao", {}, [
      el("header", {}, [el("span.n", { texto: "00" }), el("h2", { texto: "O grupo e o tema" })]),
      el("div.corpo", {}, [
        el("div.campo", {}, [el("label.rotulo", { for: "q-grupo", texto: "grupo" }), seletor]),
        el("p.enunciado", { texto: "Escolham um tema." }),
        ...cartoes,
        erro,
        el("div.acoes", {}, [botao]),
      ]),
    ])
  );
}

async function carregar() {
  try {
    const r = await pedir(`/quest/estado?grupo=${estado.grupo}`);
    if (!r.existe) {
      sessionStorage.removeItem(CHAVE_GRUPO);
      estado.grupo = null;
      return telaEscolha();
    }
    estado.dados = r;
    render();
  } catch (e) {
    limpar($("#palco")).append(aviso("erro", "Não consegui falar com o servidor.", e.message));
  }
}

/* ---------- a quest ------------------------------------------------------- */

function render() {
  const g = estado.dados.grupo;
  const tema = temaDe(g.tema);
  const palco = limpar($("#palco"));
  palco.append(
    cartaoProblema(tema),
    trilha(g),
    historico(g),
    g.etapa < ETAPAS.length ? cartaoEtapa(g) : cartaoFim(g)
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cartaoProblema(tema) {
  if (!tema) return aviso("erro", null, "Tema desconhecido: chamem o professor.");
  return el("div.problema", {}, [
    el("div.area", { texto: `${PREVIA ? "prévia" : `grupo ${estado.grupo}`} · ${tema.area}` }),
    el("h3", { texto: tema.titulo }),
    el("div", { texto: tema.problema }),
    el("div.pergunta-ruim", {}, [el("b", { texto: "A pergunta ruim: " }), tema.pergunta_errada]),
  ]);
}

function trilha(g) {
  // "etapas-quest", e não "trilha": .trilha é a linha de cima do cabeçalho
  // compartilhado, e o replaceWith trocava o cabeçalho no lugar desta barra.
  return el("div.etapas-quest", {}, [
    ...ETAPAS.map((e, i) =>
      el(`span${i < g.etapa ? ".feita" : i === g.etapa ? ".agora" : ""}`, {
        texto: `${i + 1} · ${e.curto}`,
      })
    ),
    el("span.placar", {
      texto: `${g.barrados} ${g.barrados === 1 ? "barrada" : "barradas"} em ${g.tentativas} ${g.tentativas === 1 ? "envio" : "envios"}`,
    }),
  ]);
}

function campoTexto(e) {
  const area = el("textarea", { rows: "5", placeholder: e.placeholder || "", spellcheck: "true" });
  area.value = estado.rascunhos[e.id] || "";
  area.addEventListener("input", () => {
    estado.rascunhos[e.id] = area.value;
  });
  return area;
}

/** A etapa da lista: o código colado do juscraper-app, quantos voltaram e a explicação. */
function camposFonte() {
  const r = (estado.rascunhos.fonte ||= { codigo: "", quantidade: "", explicacao: "" });
  const codigo = el("textarea.codigo", {
    id: "q-codigo",
    rows: "9",
    spellcheck: "false",
    placeholder: "# pip install juscraper\nimport juscraper as jus\n…  (colem aqui o código inteiro)",
  });
  const quantidade = el("input", {
    id: "q-quantidade",
    type: "text",
    placeholder: "ex.: 1.136 processos, ou 18 páginas de 20 acórdãos",
  });
  const explicacao = el("textarea", {
    id: "q-explicacao",
    rows: "5",
    spellcheck: "true",
    placeholder:
      "O estudo é prospectivo (ou retrospectivo) porque… Essa lista responde à pergunta porque… " +
      "Ela não vê…",
  });
  codigo.value = r.codigo;
  quantidade.value = r.quantidade;
  explicacao.value = r.explicacao;
  codigo.addEventListener("input", () => { r.codigo = codigo.value; });
  quantidade.addEventListener("input", () => { r.quantidade = quantidade.value; });
  explicacao.addEventListener("input", () => { r.explicacao = explicacao.value; });
  return el("div", {}, [
    el("div.campo", {}, [el("label.rotulo", { for: "q-codigo", texto: "1. o código da busca (Copiar código, no juscraper-app)" }), codigo]),
    el("div.campo", {}, [el("label.rotulo", { for: "q-quantidade", texto: "2. quantos voltaram" }), quantidade]),
    el("div.campo", {}, [
      el("label.rotulo", {
        for: "q-explicacao",
        texto: "3. prospectivo ou retrospectivo, por que essa lista responde à pergunta, e o que ela não vê",
      }),
      explicacao,
    ]),
  ]);
}

/** A etapa da consulta: um processo real da lista, o que se viu nele e onde. */
function camposConsulta() {
  const r = (estado.rascunhos.consulta ||= { numero: "", encontrado: "", acesso: "" });
  const numero = el("input", {
    id: "q-numero",
    type: "text",
    spellcheck: "false",
    placeholder: "ex.: 1001234-56.2024.8.26.0100",
  });
  const encontrado = el("textarea", {
    id: "q-encontrado",
    rows: "6",
    spellcheck: "true",
    placeholder:
      "Datas, movimentações, o resultado, um trecho da decisão… Nesse processo, o desfecho da " +
      "nossa pergunta seria… (ou: ainda não existe, porque…)",
  });
  const acesso = el("textarea", {
    id: "q-acesso",
    rows: "4",
    spellcheck: "true",
    placeholder:
      "A data de … estava no e-SAJ, aberta a qualquer pessoa; o texto da sentença, no Banco de " +
      "Sentenças; … só com login / só quem atua no processo. A IA extrairia do texto…",
  });
  numero.value = r.numero;
  encontrado.value = r.encontrado;
  acesso.value = r.acesso;
  numero.addEventListener("input", () => { r.numero = numero.value; });
  encontrado.addEventListener("input", () => { r.encontrado = encontrado.value; });
  acesso.addEventListener("input", () => { r.acesso = acesso.value; });
  return el("div", {}, [
    el("div.campo", {}, [el("label.rotulo", { for: "q-numero", texto: "1. o número do processo" }), numero]),
    el("div.campo", {}, [
      el("label.rotulo", {
        for: "q-encontrado",
        texto: "2. o que vocês encontraram nele que ajuda a responder à pergunta, e o valor do desfecho",
      }),
      encontrado,
    ]),
    el("div.campo", {}, [
      el("label.rotulo", { for: "q-acesso", texto: "3. onde estava cada informação, e com que acesso" }),
      acesso,
    ]),
  ]);
}

function editorVariaveis() {
  if (!Array.isArray(estado.rascunhos.variaveis)) {
    estado.rascunhos.variaveis = Array.from({ length: 4 }, () => ({ nome: "", tipo: "", papel: "", como_medir: "" }));
  }
  const caixa = el("div");
  const desenhar = () => {
    limpar(caixa);
    estado.rascunhos.variaveis.forEach((v, i) => {
      const nome = el("input", { type: "text", placeholder: "nome (ex.: tempo_ate_sentenca)", value: v.nome });
      const tipo = el("select", {}, [
        el("option", { value: "", texto: "tipo" }),
        ...TIPOS.map((t) => el("option", { value: t, texto: t, selected: v.tipo === t })),
      ]);
      const papel = el("select", {}, [
        el("option", { value: "", texto: "papel" }),
        ...PAPEIS.map((p) => el("option", { value: p, texto: p, selected: v.papel === p })),
      ]);
      const medir = el("input", { type: "text", placeholder: "como medir: onde está e que valores tem", value: v.como_medir });
      const tirar = el("button.secundario", { type: "button", texto: "tirar", title: "tirar esta variável" });
      nome.addEventListener("input", () => { v.nome = nome.value; });
      tipo.addEventListener("change", () => { v.tipo = tipo.value; });
      papel.addEventListener("change", () => { v.papel = papel.value; });
      medir.addEventListener("input", () => { v.como_medir = medir.value; });
      tirar.addEventListener("click", () => {
        estado.rascunhos.variaveis.splice(i, 1);
        desenhar();
      });
      caixa.append(el("div.var-linha", {}, [nome, tipo, papel, medir, tirar]));
    });
    const mais = el("button.secundario", { type: "button", texto: "+ variável" });
    mais.addEventListener("click", () => {
      if (estado.rascunhos.variaveis.length >= 10) return toast("No máximo dez variáveis.");
      estado.rascunhos.variaveis.push({ nome: "", tipo: "", papel: "", como_medir: "" });
      desenhar();
    });
    caixa.append(el("div.acoes", { style: "margin-top:0" }, [mais]));
  };
  desenhar();
  return caixa;
}

function resposta(e) {
  if (e.id === "variaveis") {
    return (estado.rascunhos.variaveis || [])
      .map((v) => ({ ...v, nome: v.nome.trim(), como_medir: v.como_medir.trim() }))
      .filter((v) => v.nome);
  }
  if (e.id === "fonte") {
    const r = estado.rascunhos.fonte || {};
    return {
      codigo: String(r.codigo || "").trim(),
      quantidade: String(r.quantidade || "").trim(),
      explicacao: String(r.explicacao || "").trim(),
    };
  }
  if (e.id === "consulta") {
    const r = estado.rascunhos.consulta || {};
    return {
      numero: String(r.numero || "").trim(),
      encontrado: String(r.encontrado || "").trim(),
      acesso: String(r.acesso || "").trim(),
    };
  }
  return String(estado.rascunhos[e.id] || "").trim();
}

/** O que dá para conferir sem gastar uma tentativa: campo vazio ou curto demais. */
function conferirLocal(e, r) {
  if (e.id === "variaveis") {
    if (r.length < e.minimo) return `Declarem pelo menos ${e.minimo} variáveis.`;
    const incompleta = r.find((v) => !v.tipo || !v.papel || !v.como_medir);
    if (incompleta) return `Completem tipo, papel e como medir da variável "${incompleta.nome}".`;
    return null;
  }
  if (e.id === "fonte") {
    if (r.codigo.length < 30 || !/scraper|import/.test(r.codigo)) {
      return "Colem o código que o juscraper-app gera em \"Código equivalente\" (botão Copiar código).";
    }
    if (!r.quantidade) return "Digam quantos processos ou páginas voltaram.";
    if (r.explicacao.length < e.minimo) return "A explicação está curta demais para a IA julgar.";
    return null;
  }
  if (e.id === "consulta") {
    if (r.numero.replace(/\D/g, "").length < 15) {
      return "Coloquem o número completo do processo que vocês abriram (20 dígitos, no formato CNJ).";
    }
    if (r.encontrado.length < 30) return "Contem o que vocês encontraram no processo.";
    if (r.acesso.length < 20) return "Digam onde estava cada informação e com que acesso.";
    return null;
  }
  if (r.length < e.minimo) return "A resposta está curta demais para a IA julgar. Escrevam mais um pouco.";
  return null;
}

function veredito(aprovado, texto) {
  return el(`div.veredito${aprovado ? ".ok" : ".barrado"}`, {}, [
    el("b", { texto: aprovado ? "Passou." : "Barrada. Leiam o feedback e tentem de novo." }),
    el("div", { texto: texto || "" }),
  ]);
}

function cartaoEtapa(g, { previa = false } = {}) {
  const i = g.etapa;
  const e = ETAPAS[i];
  const retorno = el("div");
  if (g.ultimo && g.ultimo.etapa === e.id && !g.ultimo.aprovado) {
    retorno.append(veredito(false, g.ultimo.feedback));
  }
  const botao = el("button.principal", {
    type: "button",
    texto: "mandar para a IA",
    disabled: previa,
    title: previa ? "na prévia, o envio está desligado" : null,
  });
  const situacao = el("span.miudo", { texto: previa ? "na prévia, nada é enviado" : "" });
  if (!previa) botao.addEventListener("click", () => enviar(e, botao, situacao, retorno));
  const entrada =
    e.id === "variaveis" ? editorVariaveis()
    : e.campos === "fonte" ? camposFonte()
    : e.campos === "consulta" ? camposConsulta()
    : campoTexto(e);
  return el("section.secao", {}, [
    el("header", {}, [
      el("span.n", { texto: String(i + 1).padStart(2, "0") }),
      el("h2", { texto: e.titulo }),
      el("span.dica", { texto: `etapa ${i + 1} de ${ETAPAS.length}` }),
    ]),
    el("div.corpo", {}, [
      el("div.conceito", { html: e.conceito }),
      el("div.tarefa", {}, [
        e.tarefaHtml ? el("div", { html: e.tarefaHtml }) : el("p.enunciado", { texto: e.tarefa }),
      ]),
      entrada,
      el("div.acoes", {}, [botao, situacao]),
      retorno,
    ]),
  ]);
}

async function enviar(e, botao, situacao, retorno) {
  if (estado.ocupado) return;
  const r = resposta(e);
  const problema = conferirLocal(e, r);
  if (problema) {
    limpar(retorno).append(aviso("erro", null, `${problema} (Isso não conta como barrada.)`));
    return;
  }
  estado.ocupado = true;
  botao.disabled = true;
  situacao.textContent = "a IA está lendo a resposta de vocês…";
  try {
    const dados = await pedir("/quest/responder", {
      method: "POST",
      body: JSON.stringify({ grupo: estado.grupo, etapa: e.id, resposta: r }),
    });
    estado.dados.grupo = dados.grupo;
    situacao.textContent = "";
    limpar(retorno).append(veredito(dados.aprovado, dados.feedback));
    $(".etapas-quest")?.replaceWith(trilha(dados.grupo));
    if (dados.aprovado) {
      botao.remove();
      const ultima = dados.grupo.etapa >= ETAPAS.length;
      retorno.append(
        el("div.acoes", {}, [
          el("button.principal", {
            type: "button",
            texto: ultima ? "ver o fim da quest" : "próxima etapa",
            onclick: () => render(),
          }),
        ])
      );
    } else {
      botao.disabled = false;
    }
  } catch (erro) {
    situacao.textContent = "";
    if (erro.status === 409 && erro.dados?.grupo) {
      estado.dados.grupo = erro.dados.grupo;
      toast(erro.message, 5000);
      render();
    } else {
      limpar(retorno).append(aviso("erro", null, `${erro.message} (Isso não conta como barrada.)`));
      botao.disabled = false;
    }
  } finally {
    estado.ocupado = false;
  }
}

/* ---------- o que já passou ---------------------------------------------- */

function textoResposta(id, valor) {
  if (id === "variaveis") {
    return el("ul", {}, (valor || []).map((v) =>
      el("li", { texto: `${v.nome} (${v.tipo}, ${v.papel}): ${v.como_medir}` })
    ));
  }
  if (id === "fonte" && valor && typeof valor === "object") {
    return el("div", {}, [
      el("pre.codigo-colado", { texto: valor.codigo || "" }),
      el("div", {}, [el("b", { texto: "voltaram: " }), valor.quantidade || ""]),
      el("div", { style: "white-space:pre-wrap", texto: valor.explicacao || "" }),
    ]);
  }
  if (id === "consulta" && valor && typeof valor === "object") {
    return el("div", {}, [
      el("div", {}, [el("b", { texto: "processo: " }), valor.numero || ""]),
      el("div", { style: "white-space:pre-wrap", texto: valor.encontrado || "" }),
      el("div", { style: "white-space:pre-wrap; margin-top:.3rem" }, [el("b", { texto: "onde e com que acesso: " }), valor.acesso || ""]),
    ]);
  }
  return el("div", { style: "white-space:pre-wrap", texto: valor || "" });
}

/**
 * As respostas aprovadas até aqui, uma por etapa e dobradas: o grupo abre a que
 * quiser rever antes de responder a próxima. Na prévia, são as respostas de
 * exemplo tiradas do gabarito.
 */
function historico(g, { exemplo = false } = {}) {
  const aprovadas = ETAPAS.filter((e) => g.respostas?.[e.id] !== undefined);
  if (!aprovadas.length) return el("div");
  return el("div.historico", {}, [
    el("div.rotulo", {
      texto: exemplo
        ? "as respostas até aqui (exemplo tirado do gabarito)"
        : `o que vocês já responderam (${aprovadas.length} de ${ETAPAS.length})`,
    }),
    ...aprovadas.map((e) =>
      el("details", {}, [
        el("summary", { texto: `${ETAPAS.indexOf(e) + 1} · ${e.titulo}` }),
        el("div.resposta", {}, [textoResposta(e.id, g.respostas[e.id])]),
      ])
    ),
  ]);
}

/* ---------- o fim e a troca ------------------------------------------------ */

function cartaoFim(g) {
  const troca = el("div", { id: "troca" });
  estado.trocaMontada = false;
  acompanharTroca(troca);
  return el("section.secao.concluida", {}, [
    // a seção concluída já ganha o sinal de visto pelo CSS compartilhado
    el("header", {}, [el("span.n", { texto: "07" }), el("h2", { texto: "Pesquisa completa" })]),
    el("div.corpo", {}, [
      el("p.enunciado", {
        texto:
          `Vocês terminaram com ${g.tentativas} envios e ${g.barrados} ` +
          `${g.barrados === 1 ? "barrada" : "barradas"}. O placar da sala sai no fim, no telão.`,
      }),
      el("div.acoes", {}, [
        el("a.botao", {
          href: `slides.html?grupo=${estado.grupo}${PROXY_NA_URL}`,
          target: "_blank",
          rel: "noopener",
          texto: "abrir os slides do grupo",
        }),
      ]),
      el("p.miudo", {
        texto:
          "Os três primeiros grupos a terminar apresentam com esses slides. Eles saem das respostas " +
          "de vocês, enxugadas pela IA.",
      }),
      troca,
    ]),
  ]);
}

function acompanharTroca(alvo) {
  clearInterval(estado.relogio);
  const passo = async () => {
    try {
      const r = await pedir(`/quest/estado?grupo=${estado.grupo}`);
      estado.dados = r;
      await desenharTroca(alvo, r);
    } catch {
      /* rede instável: tenta de novo no próximo ciclo */
    }
  };
  passo();
  estado.relogio = setInterval(passo, INTERVALO_TROCA_MS);
}

async function desenharTroca(alvo, r) {
  const recebidas = r.troca?.recebidas || [];
  const blocoRecebidas = recebidas.length
    ? el("div", { style: "margin-top:1rem" }, [
        el("h3", { texto: "O que o outro grupo disse do plano de vocês" }),
        ...recebidas.map((a) =>
          el("div.recebida", {}, [
            el("div.miudo", {
              texto: CRITERIOS_TROCA.map((c) => `${c.nome}: ${NOTAS.find((n) => n[0] === a.criterios?.[c.id])?.[1] || "?"}`).join(" · "),
            }),
            el("div", {}, [el("b", { texto: "defeito mais grave: " }), a.defeito]),
            el("div", {}, [el("b", { texto: "sugestão: " }), a.sugestao]),
          ])
        ),
      ])
    : null;

  if (!r.controle?.troca) {
    estado.trocaMontada = false;
    limpar(alvo).append(
      el("p.miudo", {
        texto: "Quando o professor abrir a troca, o plano de outro grupo aparece aqui para vocês avaliarem.",
      }),
      blocoRecebidas || ""
    );
    return;
  }
  if (!r.troca?.alvo) {
    limpar(alvo).append(el("p.miudo", { texto: "A troca começou, mas este grupo não recebeu plano para avaliar." }), blocoRecebidas || "");
    return;
  }
  if (r.troca.feita) {
    estado.trocaMontada = false;
    limpar(alvo).append(
      aviso("ok", null, `Avaliação do plano do grupo ${r.troca.alvo} enviada.`),
      blocoRecebidas || ""
    );
    return;
  }
  // Não redesenha o formulário enquanto o grupo escreve nele.
  if (estado.trocaMontada) return;
  estado.trocaMontada = true;
  try {
    const plano = await pedir(`/quest/troca?grupo=${estado.grupo}`);
    limpar(alvo).append(formularioTroca(plano), blocoRecebidas || "");
  } catch (e) {
    estado.trocaMontada = false;
    limpar(alvo).append(aviso("erro", null, e.message));
  }
}

function formularioTroca(plano) {
  const notas = {};
  const defeito = el("textarea", { rows: "3", placeholder: "O que, se não for consertado, faz a pesquisa responder a outra pergunta ou a nenhuma." });
  const sugestao = el("textarea", { rows: "3", placeholder: "Uma sugestão concreta para consertar." });
  const erro = el("div");
  const botao = el("button.principal", { type: "button", texto: "enviar a avaliação" });
  botao.addEventListener("click", async () => {
    if (CRITERIOS_TROCA.some((c) => !notas[c.id])) {
      return limpar(erro).append(aviso("erro", null, "Marquem os sete critérios."));
    }
    botao.disabled = true;
    try {
      await pedir("/quest/troca/avaliar", {
        method: "POST",
        body: JSON.stringify({ grupo: estado.grupo, criterios: notas, defeito: defeito.value, sugestao: sugestao.value }),
      });
      estado.trocaMontada = false;
      toast("Avaliação enviada.");
    } catch (e) {
      limpar(erro).append(aviso("erro", null, e.message));
      botao.disabled = false;
    }
  });

  const r = plano.respostas || {};
  return el("div", { style: "margin-top:1rem" }, [
    el("h3", { texto: `A troca: o plano do grupo ${plano.alvo}` }),
    el("div.plano-alvo", {}, [
      el("div.miudo", { texto: plano.tema?.titulo || "" }),
      ...ETAPAS.filter((e) => e.id !== "diagnostico").map((e) =>
        el("div", {}, [el("h4", { texto: e.titulo }), textoResposta(e.id, r[e.id])])
      ),
    ]),
    ...CRITERIOS_TROCA.map((c) =>
      el("div.criterio", {}, [
        el("div", {}, [el("b", { texto: c.nome }), el("div.miudo", { texto: c.ajuda })]),
        el("div.opcoes", {}, NOTAS.map(([valor, rotulo]) => {
          const id = `n-${c.id}-${valor.replace(/\s/g, "")}`;
          const radio = el("input", { type: "radio", name: `n-${c.id}`, id, value: valor });
          radio.addEventListener("change", () => { notas[c.id] = valor; });
          return el("label", { for: id }, [radio, rotulo]);
        })),
      ])
    ),
    el("div.campo", {}, [el("label.rotulo", { texto: "o defeito mais grave, e por quê" }), defeito]),
    el("div.campo", {}, [el("label.rotulo", { texto: "uma sugestão concreta" }), sugestao]),
    erro,
    el("div.acoes", {}, [botao]),
  ]);
}

/* ---------- a prévia do professor ----------------------------------------- */

/*
 * Todas as telas da quest, navegáveis, sem enviar nada: a escolha do tema, as
 * oito etapas e o fim. O professor troca de tema e de tela para revisar os
 * enunciados. Com a senha da equipe, cada etapa mostra embaixo o critério que
 * o juiz usa e a parte do gabarito do tema que vale para ela.
 */

const TELAS = ["tema", ...ETAPAS.map((e, i) => `${i + 1} · ${e.curto}`), "fim"];

const CAMPOS_GABARITO = {
  diagnostico: [["defeitos_da_pergunta_errada", "defeitos que o grupo precisa achar"]],
  pergunta: [["exemplo_pergunta_boa", "exemplo de pergunta boa"]],
  fonte: [["desenho", "desenho"], ["fonte_no_app", "a busca conferida no juscraper-app"]],
  consulta: [
    ["caso_exemplo", "um caso real conferido"],
    ["viabilidade", "o que a conferência de casos reais mostrou (14/09)"],
    ["casos_conferidos", "outros processos conferidos"],
    ["consulta", "o que olhar e com que acesso"],
    ["extracao_ia", "extração por IA"],
  ],
  variaveis: [["variaveis_exemplo", "variáveis de exemplo"]],
  hipotese: [["hipotese_exemplo", "hipóteses de exemplo"]],
  limites: [["limites_exemplo", "limitações de exemplo"]],
};

async function iniciarPrevia() {
  montarTopo({ exercicio: "Quest", aula: "aula 12", titulo: "Prévia dos enunciados" });
  estado.temas = (await fetch("temas.json").then((r) => r.json())).temas || [];
  estado.previa = { tema: estado.temas[0]?.id, tela: 0, gabarito: null };
  const prof = await garantirModoProfessor();
  if (prof && senhaProfessor()) {
    try {
      estado.previa.gabarito = await pedir("/quest/gabarito", {
        headers: { "X-Prof-Token": senhaProfessor() },
      });
    } catch (e) {
      toast(`Gabarito indisponível: ${e.message}`, 5000);
    }
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.target.closest?.("input, textarea, select")) return;
    if (ev.key === "ArrowRight") irPrevia(1);
    if (ev.key === "ArrowLeft") irPrevia(-1);
  });
  desenharPrevia();
}

function irPrevia(passo) {
  estado.previa.tela = Math.min(TELAS.length - 1, Math.max(0, estado.previa.tela + passo));
  desenharPrevia();
}

function barraPrevia() {
  const seletor = el("select", { "aria-label": "tema" },
    estado.temas.map((t) => el("option", { value: t.id, texto: t.titulo, selected: t.id === estado.previa.tema })));
  seletor.addEventListener("change", () => {
    estado.previa.tema = seletor.value;
    desenharPrevia();
  });
  return el("div.barra-previa", {}, [
    el("div.linha", {}, [
      el("b", { texto: "Prévia" }),
      seletor,
      el("button.secundario", { type: "button", texto: "←", title: "tela anterior (seta para a esquerda)", onclick: () => irPrevia(-1) }),
      el("button.secundario", { type: "button", texto: "→", title: "próxima tela (seta para a direita)", onclick: () => irPrevia(1) }),
    ]),
    el("div.linha", {}, TELAS.map((nome, i) =>
      el(`button${i === estado.previa.tela ? ".atual" : ""}`, {
        type: "button",
        texto: nome,
        onclick: () => { estado.previa.tela = i; desenharPrevia(); },
      })
    )),
    el("div.miudo", {
      texto: estado.previa.gabarito
        ? "Nada é enviado. O quadro amarelo, embaixo de cada etapa, é o que só o professor vê: o critério do juiz e o gabarito do tema."
        : "Nada é enviado. Para ver também o critério do juiz e o gabarito, abra com ?previa=1&prof=1 e a senha da equipe.",
    }),
  ]);
}

function desenharPrevia() {
  const { tela } = estado.previa;
  const tema = temaDe(estado.previa.tema);
  const palco = limpar($("#palco"));
  palco.append(barraPrevia());
  if (tela === 0) {
    palco.append(previaEscolha());
  } else if (tela <= ETAPAS.length) {
    const g = { etapa: tela - 1, barrados: 0, tentativas: 0, respostas: exemploAte(tema, tela - 1) };
    palco.append(
      cartaoProblema(tema),
      trilha(g),
      historico(g, { exemplo: true }),
      cartaoEtapa(g, { previa: true }),
      gabaritoDaEtapa(tema, ETAPAS[tela - 1])
    );
  } else {
    const g = { etapa: ETAPAS.length, barrados: 0, tentativas: 0, respostas: exemploAte(tema, ETAPAS.length) };
    palco.append(cartaoProblema(tema), trilha(g), historico(g, { exemplo: true }), previaFim());
  }
}

/** As respostas de exemplo das etapas anteriores a `ate`, tiradas do gabarito do tema. */
function exemploAte(tema, ate) {
  const completo = (estado.previa.gabarito?.temas || []).find((t) => t.id === tema?.id);
  if (!completo) return {};
  const todas = respostasExemplo(completo);
  return Object.fromEntries(ETAPAS.slice(0, ate).map((e) => [e.id, todas[e.id]]));
}

function previaEscolha() {
  return el("section.secao", {}, [
    el("header", {}, [el("span.n", { texto: "00" }), el("h2", { texto: "O grupo e o tema" })]),
    el("div.corpo", {}, [
      el("p.enunciado", {
        texto:
          "Na atividade, o grupo escolhe o número e um destes temas (qualquer um, sem limite por tema) e só " +
          "vê a área e o título. Abaixo, o problema e a pergunta ruim de cada um, para revisar.",
      }),
      ...estado.temas.map((t) =>
        el("div.problema", {}, [
          el("div.area", { texto: t.area }),
          el("h3", { texto: t.titulo }),
          el("div", { texto: t.problema }),
          el("div.pergunta-ruim", {}, [el("b", { texto: "A pergunta ruim: " }), t.pergunta_errada]),
        ])
      ),
    ]),
  ]);
}

function previaFim() {
  return el("section.secao", {}, [
    el("header", {}, [el("span.n", { texto: "07" }), el("h2", { texto: "Pesquisa completa" })]),
    el("div.corpo", {}, [
      el("p.enunciado", {
        texto:
          "Vocês terminaram com 9 envios e 1 barrada. O placar da sala sai no fim, no telão. " +
          "(Na quest, os números são os do grupo.)",
      }),
      el("div.acoes", {}, [
        // sem "noopener": a aba nova herda a sessão, e com ela a senha que o
        // slides.html usa para buscar o gabarito do tema
        el("button.principal", {
          type: "button",
          texto: "abrir os slides do grupo (exemplo)",
          onclick: () =>
            window.open(`slides.html?previa=1&tema=${encodeURIComponent(estado.previa.tema)}${PROXY_NA_URL}`, "_blank"),
        }),
      ]),
      el("p.miudo", {
        texto:
          "Os três primeiros grupos a terminar apresentam com esses slides. Eles saem das respostas " +
          "de vocês, enxugadas pela IA.",
      }),
      el("h3", { texto: "Quando o professor abre a troca, o grupo vê o plano de outro e marca:" }),
      el("ul", {}, CRITERIOS_TROCA.map((c) => el("li", {}, [el("b", { texto: `${c.nome}: ` }), c.ajuda]))),
      el("p.enunciado", { texto: "E escreve o defeito mais grave, e por quê, e uma sugestão concreta." }),
    ]),
  ]);
}

function valorGabarito(v) {
  if (v == null || v === "") return el("div.miudo", { texto: "(sem)" });
  if (typeof v === "string") return el("div", { style: "white-space:pre-wrap", texto: v });
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === "object") {
      return el("table", {}, [
        el("tr", {}, ["nome", "tipo", "papel", "como medir"].map((c) => el("th", { texto: c }))),
        ...v.map((x) => el("tr", {}, [x.nome, x.tipo, x.papel, x.como_medir].map((c) => el("td", { texto: c || "" })))),
      ]);
    }
    return el("ul", {}, v.map((x) => el("li", { texto: String(x) })));
  }
  // objetos do gabarito (a busca conferida, o caso real): links viram links, e
  // listas e objetos aninhados viram sublistas, em vez de JSON cru
  const item = (x) => {
    if (Array.isArray(x) && x.every((s) => typeof s === "string" && /^https?:/.test(s))) {
      return el("span", {}, x.flatMap((u, i) => [
        i ? " · " : "",
        el("a", { href: u, target: "_blank", rel: "noopener", texto: u.includes("getArquivo") ? "inteiro teor" : "e-SAJ" }),
      ]));
    }
    if (x && typeof x === "object") return valorGabarito(x);
    return String(x);
  };
  return el("ul", {}, Object.entries(v).map(([k, x]) =>
    el("li", {}, [el("b", { texto: `${k}: ` }), item(x)])
  ));
}

function gabaritoDaEtapa(tema, etapa) {
  const g = estado.previa.gabarito;
  if (!g) return el("div");
  const completo = (g.temas || []).find((t) => t.id === tema?.id) || {};
  const criterio = (g.etapas || []).find((e) => e.id === etapa.id)?.criterio || "";
  return el("div.gabarito", {}, [
    el("span.rotulo", { texto: "só o professor vê" }),
    el("h4", { texto: "O critério do juiz nesta etapa" }),
    el("div", { texto: criterio }),
    ...(CAMPOS_GABARITO[etapa.id] || []).flatMap(([campo, rotulo]) => [
      el("h4", { texto: `Gabarito: ${rotulo}` }),
      valorGabarito(completo[campo]),
    ]),
    el("h4", { texto: "Armadilhas deste tema, que o juiz barra" }),
    valorGabarito(completo.armadilhas),
  ]);
}

if (PREVIA) iniciarPrevia();
else iniciar();
