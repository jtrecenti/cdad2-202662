# Gincana do Pipeline (aula 5)

App de apoio a uma atividade que acontece **no papel**. Cada mesa monta o
encadeamento com um baralho de 40 cartas; o app faz as três coisas que o papel
não faz sozinho:

1. dá **o mesmo cronômetro** para a sala inteira, disparado pelo professor;
2. **recolhe a ordem** de cada grupo, e recusa o que chega fora do tempo;
3. **roda o código** que aquela ordem produz, no navegador, para a turma ver.

O material impresso (cartas, tabuleiro, gabarito) é gerado em outro repositório,
por `atividades/gerar_gincana.py`, e o roteiro da aula está em
`atividades/roteiro_aula05.md`.

## Como roda a aula

**Antes de começar**, na tela do professor: aperte *Carregar o Python agora*. O
Pyodide com pandas e plotnine leva mais de dois minutos para baixar na primeira
vez, e dois minutos de tela parada no meio de uma rodada custam caro.

Na tela do aluno o download começa sozinho quando a página abre, com um atraso
sorteado de até 15 segundos para a turma inteira não pedir os mesmos 40 MB no
mesmo instante. Por isso o roteiro pede que **abram o app no início da aula**:
assim ele carrega durante os slides e está pronto na primeira rodada.

| quem | o que faz |
|---|---|
| professor | abre `?prof=1`, informa a senha, escolhe a rodada e os minutos, e clica na rodada |
| alunos | abrem a página, veem o problema e o cronômetro |
| alunos | montam no tabuleiro, depois digitam os códigos das cartas (`P01`, `G09`, …) |
| alunos | conferem o código que aquilo monta e podem **rodar até 5 vezes** para ver o resultado |
| alunos | enviam a ordem antes do alarme |
| professor | depois do alarme, vê os envios e manda **rodar** o de cada grupo |
| professor | se ninguém acertar, roda o **gabarito** e mostra o que era para sair |

A tela do aluno mostra, junto com o código montado, **o que cada carta faz**: é
a mesma frase impressa na carta. Dá para reenviar quantas vezes quiser até o
tempo acabar; vale o último envio.

**As cinco execuções.** O grupo pode rodar o próprio código até cinco vezes por
rodada e ver a tabela, o gráfico ou o erro. O limite é o que separa "testar uma
hipótese" de "tentar até acertar": com 40 cartas e cinco tentativas, força bruta
não fecha, e raciocinar fecha. Uma tentativa que dá erro também conta, senão a
trava não trava nada. A contagem fica no navegador do grupo e vai junto com o
envio, então a sua tela mostra quem fechou de primeira.

Se o professor reabrir a mesma rodada, a contagem recomeça: a chave inclui a
versão da abertura.

O aluno recebe *recebido*, nunca *certo* ou *errado*: ele vê o que o código dele
produz, e não se bate com o gabarito. Quem confere é o Worker, e o veredito (e o
gabarito) só existem na tela do professor.

## Ensaiar sem publicar nada

`?demo=1` roda a gincana inteira no navegador, com o estado no `localStorage` e
sem tocar no Worker:

```
http://127.0.0.1:8123/gincana/index.html?demo=1&prof=1   painel do professor
http://127.0.0.1:8123/gincana/index.html?demo=1          tela do aluno
```

Serve para ensaiar a aula e para desenvolver a tela. **Não serve para a aula**:
o relógio é o da máquina, o gabarito não é conferido e as abas não conversam
entre si.

Para testar de verdade, com duas telas: uma janela normal logada como professor
e uma janela anônima como aluno, as duas apontando para o Worker publicado.

## O que precisa estar no ar

O app é estático, mas depende de duas coisas do Worker.

**1. As rotas.** `proxy/worker.js` ganhou cinco:

| rota | quem chama |
|---|---|
| `GET /gincana/estado` | aluno e professor, de 2 em 2 segundos |
| `POST /gincana/estado` | professor, ao abrir uma rodada |
| `POST /gincana/responder` | aluno, ao enviar |
| `GET /gincana/respostas` | professor |
| `POST /gincana/limpar` | professor, para reaproveitar uma rodada |

Elas usam `RTDB_URL` e `RTDB_SECRET`, que já existem, e o nó
`RTDB_NO_GINCANA` (`cdad2_2026_2_gincana`), declarado em `wrangler.toml`.

**2. O gabarito.** `dados-privados/gincana_gabarito.json` entra no bundle do
Worker, como os gabaritos dos projetos 7 e 8. Sem ele o app funciona, mas a tela
do professor mostra *sem gabarito aqui* em vez do veredito.

```
cd proxy && npx wrangler deploy
cd .. && uv run python scripts/publicar.py
```

As regras do RTDB **não precisam mudar**: o nó da gincana fica fechado para o
cliente, como todo o resto, e quem lê e escreve é o Worker com a credencial de
dono.

## Três decisões que valem explicar

**O relógio é o do servidor.** Cada resposta do Worker traz `agora_ms`, e o
navegador guarda a diferença para o relógio dele. Com o cronômetro rodando só no
cliente, atrasar o relógio da máquina compraria tempo extra.

**A submissão é aceita até 2,5 s depois do fim.** A viagem do pacote não pode
custar a rodada de quem clicou a tempo. O `restante_ms` gravado é o que sobrava
de verdade, e é ele que decide o ponto de velocidade.

**Rodar o código é seguro.** O que roda nunca é texto do aluno: é a concatenação
de cartas conhecidas do baralho, na ordem que ele escolheu. O app monta o
encadeamento, nomeia o último objeto e mostra tabela ou gráfico conforme o tipo.

## Arquivos

```
index.html     a página, nos dois modos
app.js         tudo: aluno, professor, ensaio local e execução do código
cartas.json    as 40 cartas e o enunciado das 10 rodadas (gerado)
figuras/       as imagens-alvo das rodadas de gráfico (geradas)
```

`cartas.json` e `figuras/` são derivados: quem manda é `atividades/gincana.py`,
no repositório privado, e `python exportar_app.py` os regenera. Editar aqui
significa perder a mudança na próxima exportação.

A base fica em `../_shared/dados/criminal.csv`, sem a coluna `ementa`: nenhuma
carta usa o texto do acórdão, e ele responderia por 95% do arquivo.
