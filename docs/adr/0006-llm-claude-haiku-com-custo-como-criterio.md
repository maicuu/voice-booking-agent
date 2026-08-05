# ADR 0006: Claude Haiku 4.5 como modelo, com custo por conversa como critério de primeira ordem

**Data:** 2026-08-04
**Status:** Aceito

## Contexto

O `plano.md` §3 pede "modelo rápido e barato com tool calling nativo", com o critério
declarado de que **latência importa mais que capacidade** — o modelo só interpreta
intenção e chama ferramenta, porque a ADR 0001 já tirou dele toda decisão de negócio.
O §8 pede modelar custo por minuto de conversa e publicar o número medido.

O que mudou: existe agora um **orçamento total declarado de aproximadamente R$10**
para o projeto inteiro. Não é um limite mensal — é o teto. Isso promove custo de
"coisa a medir depois" para restrição de projeto, no mesmo nível de latência.

Preços de tabela consultados nesta data, por milhão de tokens:

| modelo | entrada | saída | contexto |
|---|---|---|---|
| Claude Haiku 4.5 | US$ 1 | US$ 5 | 200K |
| Claude Sonnet 5 | US$ 3 (US$ 2 promocional) | US$ 15 (US$ 10) | 1M |
| Claude Opus 5 | US$ 5 | US$ 25 | 1M |

Um detalhe de cache que importa e não é óbvio: o **prefixo mínimo para o cache de
prompt funcionar varia por modelo, e não acompanha a ordem de preço**. No Haiku 4.5
são 4096 tokens; em modelos maiores, 512 ou 1024. Um prompt de sistema abaixo do
mínimo simplesmente não é cacheado — sem erro, sem aviso. O prompt deste agente é
pequeno, então **no Haiku o cache não vai ajudar**, e todo token de entrada é
cobrado cheio.

## Decisão

**Claude Haiku 4.5** (`claude-haiku-4-5`) como modelo do orquestrador, via SDK oficial
da Anthropic. Sem extended thinking: o modelo aqui não raciocina sobre negócio, ele
classifica intenção e preenche slot, e pensamento vira latência pura numa conversa
falada.

**Custo entra como critério de primeira ordem em toda escolha de provedor daqui
para frente**, ao lado de latência e qualidade — e o custo por conversa é calculado
antes de escolher, não depois.

## Alternativas descartadas

- **Sonnet 5 ou Opus 5** — descartadas por preço, não por capacidade: 3x e 5x o custo
  de entrada para uma tarefa que é classificação de intenção com ferramenta. O
  argumento de que "o modelo maior erra menos" não se aplica aqui, porque a ADR 0001
  já garante que ele não tem o que errar sobre disponibilidade ou preço. Se a suíte
  de avaliação mostrar erro de interpretação que o prompt não resolve, o custo de
  subir de modelo passa a ser justificável — e aí é uma decisão com número, não com
  intuição.
- **Modelo local via Ollama, custo zero** — descartada, e é a alternativa que mais
  incomoda descartar, porque zeraria o orçamento. Três motivos: o projeto é sobre
  **latência de voz**, e um modelo pequeno em CPU não entrega o orçamento do §6.1;
  tool calling confiável em pt-BR é justamente onde modelo pequeno quebra, e a
  quebra apareceria como bug do agente, não do modelo; e a máquina de desenvolvimento
  não tem GPU verificada. Volta a valer se o custo medido por conversa inviabilizar o
  desenvolvimento — o `ModeloDeLinguagem` existe como interface exatamente para isso.
- **Cache de prompt como estratégia de economia no Haiku** — descartada porque o
  prefixo mínimo de 4096 tokens não é atingido por este prompt. Inflar o prompt de
  sistema até 4096 tokens para "ativar" o cache pagaria mais tokens do que
  economizaria e pioraria o comportamento do modelo.
- **Extended thinking** — descartada por latência. O modelo não tem decisão de
  negócio para pensar; o que ele decide é qual ferramenta chamar.

## Relação com a ADR 0004

A ADR 0004 decidiu Node com TypeScript **sem nenhuma dependência de runtime**, e
listou como consequência que a superfície de supply chain da Fase 1 seria zero. Esta
ADR encerra essa propriedade: o SDK oficial da Anthropic entra como a primeira — e,
na Fase 1, única — dependência de runtime.

A troca é deliberada. Escrever à mão o cliente HTTP de uma API de terceiro não
demonstra nada que este projeto queira demonstrar (o que ele quer demonstrar é o
loop do agente, e esse continua escrito à mão), e um cliente artesanal erraria em
retry, backoff e classificação de erro — que é precisamente o que o SDK já resolve.
O resto da ADR 0004 continua valendo: Node 22 executando TypeScript direto, sem
etapa de build, testes na biblioteca padrão.

## Consequências

- **O agente fica preso ao mínimo de cache de 4096 tokens do Haiku 4.5.** Todo token
  de entrada é cobrado cheio, e o custo por conversa cresce com o número de turnos,
  porque o histórico é reenviado a cada chamada. Conversa longa custa
  desproporcionalmente mais que conversa curta — o que, por acaso, alinha custo com
  a experiência que se quer (conversa curta é conversa boa).
- **O custo por conversa ainda não é conhecido.** O preço por token é fato de tabela;
  a contagem de tokens por conversa não é. Fica `[PREENCHER: medir tokens por
  conversa com a suíte de avaliação, e derivar o custo]` — a aritmética só vale
  depois da medição, e trocar isso por um valor plausível apagaria o motivo de o
  projeto existir.
- **A suíte de avaliação passa a ser o maior item de custo do projeto**, não as
  conversas de desenvolvimento. Dezenas de casos vezes centenas de commits domina
  qualquer conta. É o que a ADR 0007 trata.
- **Uma dependência de runtime a manter**, com o custo de supply chain que vem junto.
- O `ModeloDeLinguagem` é uma interface, e nada acima dela sabe que existe Anthropic
  do outro lado. Trocar de provedor é escrever outra implementação — mesma fronteira
  da ADR 0003 com a API de agendamento.

## Como saberei que errei

Se o custo por conversa medido, multiplicado pelo uso previsto da demo pública,
consumir o orçamento antes de a Fase 3 fechar, o modelo pago não se sustenta e a
alternativa local descartada acima volta à mesa.

E se a suíte de avaliação mostrar o Haiku 4.5 errando **interpretação de intenção**
— chamando a ferramenta errada, preenchendo o slot errado — em taxa que o prompt não
derruba, então o critério "latência importa mais que capacidade" estava errado para
este domínio, e a diferença de preço para o Sonnet passa a ser dinheiro bem gasto.
