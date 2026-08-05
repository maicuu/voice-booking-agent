# Recepcionista

Agente de voz que atende, entende e agenda de verdade — o modelo interpreta a
intenção, mas quem responde disponibilidade, preço e confirma a escrita é sempre
uma API real de agendamento.

**Status: Fase 1, em andamento.** O loop está escrito: camada de ferramentas, máquina
de estados do turno, tool calling e a conversa digitada. Nada de áudio ainda — se a
lógica não estiver certa em texto, áudio só esconderia o problema. Falta a suíte de
avaliação, e nada rodou ainda contra o modelo de verdade.

---

## A ideia em uma frase

Um chatbot que conversa é fácil. Um agente que **executa uma ação com efeito
colateral irreversível** — criar um evento na agenda de outra pessoa — obriga a
resolver confirmação explícita, idempotência, tratamento de erro e recuperação de
ambiguidade. É essa parte que este projeto existe para mostrar.

## A decisão de arquitetura central

O LLM **não decide disponibilidade nem preço**. Ele interpreta intenção e
preenche slots; quem responde "tem horário quinta às 15h" é a API. O modelo nunca
inventa dado de negócio porque nunca é ele quem tem o dado.

Registrada em [ADR 0001](docs/adr/0001-llm-nao-e-fonte-de-verdade-de-negocio.md).

## A confirmação não está no prompt

O agente repete o que entendeu e espera confirmação explícita antes de criar o
agendamento. Escrita no prompt, essa regra é uma sugestão: o modelo cumpre na maioria
das conversas e pula em algumas — e as que ele pula são justamente as confusas, onde
confirmar mais importa.

Aqui a ferramenta de escrita **não aceita os dados do agendamento**. Ela aceita só um
comprovante emitido por `preparar_confirmacao`, e só a partir do turno seguinte. Um
comprovante emitido e resgatado no mesmo turno significa que o agente leu a
confirmação em voz alta e respondeu a si mesmo; a guarda recusa.

O código está em [`src/conversa/confirmacao.ts`](src/conversa/confirmacao.ts), e
[três testes](tests/conversa.test.ts) existem só para provar que o caminho não é
contornável — cada um verifica que a agenda continua com zero eventos.

## Números

Este projeto se justifica pelos números medidos, não pela demo. Nenhum deles
existe ainda — nunca preencher com estimativa:

| métrica | valor |
|---|---|
| latência p50 / p95 (fim da fala → 1º áudio) | `[PREENCHER: medir na Fase 2]` |
| latência da consulta de disponibilidade | `[PREENCHER: refazer com amostragem maior]` |
| taxa de aprovação da suíte de avaliação | `[PREENCHER: medir na Fase 3]` |
| taxa de conclusão de tarefa | `[PREENCHER: medir na Fase 3]` |
| custo por conversa | `[PREENCHER: medir na Fase 3]` |

A consulta de disponibilidade já foi medida contra a instância local, mas com 12
amostras — contagem que não sustenta um p95. A ordem de grandeza e o que ela
revelou sobre o gargalo estão em [`PROGRESS.md`](PROGRESS.md); o número só sobe
para esta tabela quando a amostragem justificar.

## Documentação

| arquivo | o que é |
|---|---|
| [`docs/plano.md`](docs/plano.md) | o plano completo: arquitetura, stack, faseamento, custo |
| [`PROGRESS.md`](PROGRESS.md) | diário de progresso, em ordem cronológica inversa |
| [`docs/adr/`](docs/adr/) | decisões de arquitetura, uma por arquivo |
| [`AGENTS.md`](AGENTS.md) | regras de trabalho neste repositório |

## Stack

Node.js 22 executando TypeScript diretamente, sem etapa de build — o `tsc` só
verifica tipos e os testes usam o executor da biblioteca padrão. Nenhuma
dependência de runtime na Fase 1. O motivo, e o que foi recusado, está na
[ADR 0004](docs/adr/0004-stack-node-typescript-sem-framework.md).

## Como rodar

Requer Node 22.18 ou mais novo.

```
npm install
npm run verificar    # tipos e testes
```

Os testes não dependem de nada externo: rodam contra um duplo em memória, sem
banco, sem rede e sem credencial.

O teste de contrato e o medidor de latência precisam de uma instância local do
AgendaFácil, com uma agenda conectada a pelo menos um profissional — sem isso a API
não consulta horário nem escreve. Ambos ficam desligados por padrão e são só
leitura:

```
AGENDA_API_BASE_URL=http://localhost:3000/api AGENDA_TENANT=<slug> npm run contrato
AGENDA_API_BASE_URL=http://localhost:3000/api AGENDA_TENANT=<slug> npm run medir
```

Existe um terceiro, `scripts/verificar-escrita.ts`, que exercita o caminho de
escrita e a política de idempotência de ponta a ponta. Ele **cria um evento real na
agenda de um profissional**, exige a flag `--confirmo` e fica fora da suíte de
propósito: um caso de teste com efeito colateral irreversível é o erro que este
projeto existe para mostrar que se sabe evitar.

A conversa digitada precisa do AgendaFácil local **e** de uma chave da Anthropic em
`.env` (veja [`.env.example`](.env.example)):

```
npm run conversa
```

Ela imprime, a cada turno, a latência, a contagem de tokens que o provedor devolveu e
quais ferramentas foram chamadas.
