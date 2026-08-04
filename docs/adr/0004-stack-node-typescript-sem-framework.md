# ADR 0004: Node.js com TypeScript, sem framework de agente e sem etapa de build

**Data:** 2026-08-04
**Status:** Aceito

## Contexto

A Fase 1 precisa de uma stack antes da primeira linha de código. O `plano.md` §3
propõe Node.js com TypeScript escrito à mão, com o critério declarado: streaming de
áudio é I/O puro, o AgendaFácil é do mesmo ecossistema, e framework pronto de agente
de voz **entrega mais rápido e prova menos** — o objetivo do projeto é mostrar que
sei montar o loop, não que sei configurar um.

Fatos do ambiente:

- Node 22 executa TypeScript diretamente, removendo os tipos em tempo de carga, sem
  transpilador. Não precisa de bundler nem de etapa de build para rodar.
- Node 22 traz um executor de testes na biblioteca padrão (`node:test`).
- A Fase 1 é texto puro: um cliente HTTP, uma máquina de estados e uma chamada de
  LLM com tool calling. Nada aqui pede framework web.

## Decisão

Node.js 22 com TypeScript, **sem etapa de build** — o código roda direto, e o
`tsc` entra apenas como verificador de tipos. Testes com `node:test`. Nenhuma
dependência de runtime na Fase 1; TypeScript é a única dependência de
desenvolvimento.

A camada de ferramentas é definida por uma interface (`AgendaClient`) com duas
implementações: a que fala HTTP com o AgendaFácil e um duplo em memória com o mesmo
contrato. Nada acima dessa interface sabe qual das duas está em uso.

## Alternativas descartadas

- **Framework pronto de agente de voz** (LiveKit Agents, Pipecat, Vapi) — descartada
  porque resolve exatamente a parte que o projeto existe para demonstrar. O loop
  VAD → STT → LLM → ferramenta → TTS entregue por configuração não sustenta nenhuma
  das perguntas de entrevista que o `plano.md` §6 lista. Custo assumido: mais
  trabalho na Fase 2, e barge-in escrito à mão.
- **Python no orquestrador** — descartada apesar do ecossistema mais maduro de STT e
  VAD locais. Custa duas linguagens no repositório, afasta do AgendaFácil e não paga
  na Fase 1, que não tem áudio nenhum. Se a Fase 2 mostrar que o VAD em Node é ruim,
  a decisão certa é isolar o VAD num processo separado — não reescrever o
  orquestrador.
- **Etapa de build com bundler** — descartada porque acrescenta configuração,
  artefato e uma classe inteira de erro ("rodou o build antigo") a um projeto que o
  runtime já executa direto. Volta a valer no dia em que algo precisar rodar no
  navegador, e aí só o cliente é empacotado.
- **Framework HTTP (Express, Fastify) desde já** — descartada porque a Fase 1 não
  expõe rota nenhuma: a interface é uma conversa digitada no terminal. Entra na
  Fase 2, quando existir a página com o botão de falar.
- **Testes com Vitest ou Jest** — descartada porque o executor da biblioteca padrão
  cobre o que a suíte precisa, e uma dependência a menos é uma decisão a menos de
  explicar. Muda se a suíte de avaliação (§6.2) exigir algo que ele não faz.

## Consequências

- **O TypeScript fica restrito ao que se apaga sem transformar.** Sem `enum`, sem
  `namespace`, sem decorator, e `import` de arquivo `.ts` precisa da extensão
  explícita. São restrições reais; em troca, não existe build para dessincronizar.
- **`tsc --noEmit` passa a ser obrigatório antes de commit**, porque o runtime
  ignora os tipos: um erro de tipo não impede a execução, só aparece na verificação.
- **A interface `AgendaClient` vira contrato interno.** Mudança nela é mudança de
  contrato entre camadas e, pelo critério do `docs/adr/README.md`, pede ADR.
- **Sem dependência de runtime, a superfície de supply chain na Fase 1 é zero.**
  Isso muda na Fase 2 (STT, TTS) e o custo volta.
- **Escrever o loop à mão custa fins de semana** que um framework economizaria. É o
  custo aceito de forma consciente, e é o mesmo argumento da ADR 0002.

## Como saberei que errei

Se, na Fase 2, o VAD ou o STT em Node exigirem contorcionismo — processo auxiliar em
outra linguagem, binário compilado à parte, latência pior que a de referência — o
critério "mesmo ecossistema do AgendaFácil" terá pesado mais do que devia, e o
orquestrador deveria ter nascido em Python.

E se o número de linhas escritas à mão para chegar ao primeiro áudio for tão grande
que a Fase 2 não fechar em três fins de semana, a recusa a framework terá custado o
projeto inteiro em vez de custar uma decisão.
