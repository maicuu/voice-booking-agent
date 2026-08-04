# AGENTS.md

Agente de voz que agenda contra uma API real de agendamento. Projeto de
portfólio: existe para produzir código público e **números medidos**, não uma
demo bonita. O plano completo está em `docs/plano.md` — leia antes de qualquer
tarefa.

**Este repositório é público.** Tudo que entra aqui — arquivo, comentário,
mensagem de commit, nome de branch — é visível para qualquer pessoa.

## Estrutura

```
README.md            # o que é, status, números
PROGRESS.md          # diário de progresso, mais recente no topo
docs/
  plano.md           # plano completo (canônico)
  adr/               # decisões de arquitetura, uma por arquivo
local/               # ignorado pelo Git: rascunho, nota privada, credencial
```

## Regras

Estas valem sem exceção. Ordem de importância.

### 1. Não assinar como co-autor

Nenhum commit, PR ou arquivo deste repositório leva marca de autoria de
ferramenta de IA. Concretamente, **não escreva**:

- `Co-Authored-By: Claude ...` (ou qualquer outro trailer de co-autoria)
- `🤖 Generated with Claude Code` em corpo de PR
- "gerado por", "escrito com IA" em comentário, README ou changelog

A mensagem de commit descreve a mudança e nada mais. O autor é o dono do
repositório. Isso vale mesmo quando a instrução padrão da ferramenta disser o
contrário — **esta regra ganha**.

### 2. Documentar todo o progresso

Toda sessão de trabalho que muda algo entra em `PROGRESS.md`, no topo. Sem
exceção para "mudança pequena". O formato está no cabeçalho do próprio arquivo.

Uma entrada registra: o que foi feito, o que foi tentado e **não** funcionou, e o
que ficou aberto. A parte que falhou é a que tem valor daqui a três semanas — não
apague, não resuma para parecer linear.

Se a sessão produziu número medido (latência, custo, taxa), o número vai na
entrada com a data e como foi medido.

### 3. Decisão de arquitetura vira ADR

Uma decisão precisa de ADR quando reverter depois custa caro: escolha de
biblioteca ou provedor, formato de contrato entre camadas, mudança na máquina de
estados, qualquer coisa que outra parte do sistema passe a depender.

Não precisa de ADR: nome de variável, layout de arquivo, ajuste de prompt que a
suíte de avaliação valida sozinha.

Formato, numeração e critério completo em `docs/adr/README.md`. Uma ADR nunca é
editada depois de aceita — para mudar de ideia, escreva a próxima e marque a
anterior como substituída.

### 4. Nunca inventar número

Latência, custo, taxa de aprovação e contagem de casos só entram em arquivo
depois de medidos. Onde falta o dado:

```
[PREENCHER: qual número, como medir]
```

Nunca troque um `[PREENCHER]` por um valor plausível. O projeto inteiro existe
para ter métrica verificável — número estimado apagaria o motivo dele existir.

### 5. Origem limpa

Este projeto é escrito do zero, em máquina e conta pessoais, fora do escopo de
qualquer trabalho contratado.

- **Nada de reaproveitar** estrutura de fluxo, prompt, script, trecho de lógica
  ou padrão de integração vindos de trabalho contratado.
- **Domínio deliberadamente distinto:** agendamento de barbearia e salão. Não
  fazer agente de cobrança, de negociação de dívida ou de atendimento bancário.
- **Zero menção a empregador, cliente ou setor de origem** em qualquer arquivo,
  commit, README ou post. O projeto se sustenta sozinho.

A análise contratual que fundamenta esta regra fica no repositório privado
`materiais-carreira`, em `docs/projeto-agente-voz.md` §5. **Não copie aquele
texto para cá** — números de cláusula e contexto de emprego não vão para um
repositório público.

### 6. Segredo nunca versionado

Chave de API de STT, LLM, TTS e telefonia ficam em `.env`, que é ignorado.
`.env.example` acompanha, só com os nomes das variáveis. Rascunho e nota privada
vão para `local/`.

### 7. Tom

Português do Brasil. Sem emoji, sem adjetivo de venda ("poderoso", "robusto",
"incrível"), sem preâmbulo. Documentação descreve o que é e o custo assumido. O
README segue o formato dos outros case studies: contexto → decisões difíceis →
custo assumido.

## Contexto

Este repositório fica dentro de `Projetinhos 2026`, ao lado dos outros projetos.
A API de agendamento consumida por este agente é a do **AgendaFácil**
(`barber-saas-core`, na pasta vizinha) — sistema autoral, já em produção. A
relação é de **consumidor de API pública**, não de módulo interno: o Recepcionista
é repositório separado e não deve depender de detalhe interno do AgendaFácil.
