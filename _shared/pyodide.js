/* ==========================================================================
   Carregamento do Pyodide (Python no navegador).

   Os apps que rodam análise de verdade (projetos 2, 5 e 8) usam o mesmo
   pandas/scipy/statsmodels que o aluno usa no Colab, compilado para
   WebAssembly. Nada vai para servidor: a análise acontece na máquina do aluno.
   ========================================================================== */

const VERSAO = "0.28.0";
const CDN = `https://cdn.jsdelivr.net/pyodide/v${VERSAO}/full/`;

let promessa = null;

/**
 * carregar({ pacotes, viaMicropip, aoProgresso })
 *   pacotes: pacotes que já vêm compilados com o Pyodide (pandas, scipy, ...)
 *   viaMicropip: wheels puro-python do PyPI (plotnine, mizani, ...)
 */
export function carregar({ pacotes = [], viaMicropip = [], aoProgresso = () => {} } = {}) {
  if (promessa) return promessa;
  promessa = (async () => {
    aoProgresso("carregando o Python do navegador", 0.05);
    if (!window.loadPyodide) {
      await new Promise((ok, erro) => {
        const s = document.createElement("script");
        s.src = `${CDN}pyodide.js`;
        s.onload = ok;
        s.onerror = () => erro(new Error("não consegui carregar o Pyodide"));
        document.head.append(s);
      });
    }
    const py = await window.loadPyodide({ indexURL: CDN });
    aoProgresso("Python pronto", 0.25);

    if (pacotes.length) {
      aoProgresso(`instalando ${pacotes.join(", ")}`, 0.35);
      await py.loadPackage(pacotes);
    }
    if (viaMicropip.length) {
      aoProgresso(`instalando ${viaMicropip.join(", ")}`, 0.7);
      await py.loadPackage("micropip");
      const micropip = py.pyimport("micropip");
      await micropip.install(viaMicropip);
    }
    aoProgresso("ambiente pronto", 1);
    return py;
  })();
  return promessa;
}

/**
 * Roda código e devolve o resultado convertido para JS (dicts -> objetos).
 *
 * Sem `globais`, roda no escopo global do intérprete, então o que uma chamada
 * define (a base carregada, por exemplo) continua valendo na próxima. Passar
 * `globais` cria um escopo isolado, e aí nada de antes existe.
 */
export async function rodar(py, codigo, globais = null) {
  const opcoes = globais ? { globals: py.toPy(globais) } : undefined;
  const resultado = await py.runPythonAsync(codigo, opcoes);
  if (resultado && typeof resultado.toJs === "function") {
    const js = resultado.toJs({ dict_converter: Object.fromEntries });
    resultado.destroy?.();
    return js;
  }
  return resultado;
}

/** Injeta um CSV (texto) como DataFrame no ambiente Python. */
export async function carregarCSV(py, nome, textoCSV, variavel) {
  py.FS.writeFile(`/${nome}`, textoCSV);
  await py.runPythonAsync(
    `import pandas as pd\n${variavel} = pd.read_csv("/${nome}")\n${variavel}.shape`
  );
}
