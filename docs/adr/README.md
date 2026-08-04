# Decisões de arquitetura (ADR)

Uma decisão por arquivo, numerada em sequência, nunca reescrita depois de aceita.
O valor de um ADR está em registrar **o que foi descartado e por quê** — sem isso
a alternativa descartada volta a ser proposta daqui a três meses.

## Quando escrever um ADR

Escreva quando reverter a decisão depois custar caro:

- escolha de provedor ou biblioteca (STT, TTS, LLM, transporte, banco)
- formato de contrato entre camadas (o que o orquestrador entrega à camada de ferramentas)
- mudança na máquina de estados do turno
- estratégia de idempotência, de confirmação ou de degradação
- qualquer coisa que outra parte do sistema passe a depender

Não escreva para: nome de variável, organização de pastas, ajuste de prompt que a
suíte de avaliação valida sozinha, correção de bug.

Na dúvida: se você precisaria explicar a escolha em uma entrevista, é ADR.

## Como escrever

1. Copie `0000-template.md` para `NNNN-titulo-em-kebab-case.md`, com o próximo
   número livre.
2. Preencha. Curto é melhor — o exemplo abaixo cabe em meia página.
3. Registre a criação na entrada do dia em `PROGRESS.md`.

## Status possíveis

| status | significado |
|---|---|
| **Proposto** | escrito, ainda não vale |
| **Aceito** | vale agora |
| **Substituído por NNNN** | não vale mais; o ADR NNNN explica o que mudou |

Para mudar de ideia sobre um ADR aceito, **escreva o próximo** e marque o antigo
como substituído. A única edição permitida em um ADR aceito é essa linha de status.

## Índice

| # | decisão | status |
|---|---|---|
| [0001](0001-llm-nao-e-fonte-de-verdade-de-negocio.md) | O LLM não é fonte de verdade de negócio | Aceito |
| [0002](0002-transporte-de-audio-abstrato.md) | Transporte de áudio abstrato, WebRTC primeiro | Aceito |
| [0003](0003-contrato-com-a-api-do-agendafacil.md) | Contrato com a API do AgendaFácil, consumida como cliente externo | Aceito |
| [0004](0004-stack-node-typescript-sem-framework.md) | Node.js com TypeScript, sem framework de agente e sem etapa de build | Aceito |
| [0005](0005-idempotencia-por-registro-local-de-intencao.md) | Idempotência por registro local de intenção | Aceito |

## Decisões pendentes

Ainda sem ADR, precisam de um antes da primeira linha de código da fase
correspondente:

- **Provedor de LLM e formato do tool calling** — quais ferramentas o modelo
  enxerga e como a máquina de estados as apresenta — Fase 1.
- **Provedores de STT e TTS** — depende de teste de qualidade em pt-BR com
  sotaque — Fase 2.
- **Armazenamento dos traces** — Fase 3. Provavelmente absorve o registro de
  intenções da ADR 0005.
