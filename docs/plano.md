# Plano — agente de voz que agenda de verdade

Documento canônico do projeto. Origem: `materiais-carreira/docs/projeto-agente-voz.md`
(repositório privado). A seção de limites contratuais daquele documento **não foi
copiada para cá** — ela cita cláusulas e contexto de emprego, e este repositório é
público. O que sobrou dela virou a regra 5 do `AGENTS.md`, em linguagem genérica.

Objetivo: transformar "sei fazer agente virtual" — hoje inverificável, porque está
preso em cláusula de confidencialidade — em código público, demonstrável em um
clique e com números medidos.

---

## 1. A ideia

**Um agente de voz que atende, entende e agenda — plugado na API do AgendaFácil.**

Por que esta e não outra:

- **A ferramenta já existe e é minha.** O AgendaFácil já calcula disponibilidade
  ao vivo, valida serviço e profissional, e escreve o agendamento. O agente não
  precisa de backend de mentira: chama uma API real, em produção. Isso elimina o
  cheiro de projeto-tutorial.
- **É a parte difícil de verdade.** Um chatbot que conversa é fácil. Um agente que
  **executa uma ação com efeito colateral irreversível** — criar um evento no
  calendário de outra pessoa — obriga a resolver confirmação, idempotência,
  tratamento de erro e recuperação de ambiguidade. É o que separa demo de sistema.
- **Compõe portfólio em vez de somar item.** Vira o projeto que conversa com outro
  projeto: deixa de ser um conjunto de produtos soltos e passa a ser um ecossistema.
- **Domínio distante de qualquer trabalho contratado.** Ver `AGENTS.md` regra 5.

---

## 2. Arquitetura

```
Navegador (WebRTC)  ──┐
                      ├──►  Gateway de áudio  ──►  VAD  ──►  STT streaming
Telefonia (SIP/Twilio)┘                                            │
                                                                   ▼
                                              ┌──── Orquestrador de turno ────┐
                                              │  máquina de estados + guardas  │
                                              │  histórico + slots preenchidos │
                                              └────┬───────────────────┬──────┘
                                                   │                   │
                                                   ▼                   ▼
                                            LLM (tool calling)   Camada de ferramentas
                                                   │             (API AgendaFácil)
                                                   ▼                   │
                                            TTS streaming ◄────────────┘
                                                   │
                                                   ▼
                                         áudio de volta ao usuário

        Tudo instrumentado: trace por turno, latência por etapa, custo por chamada
```

**Decisão de arquitetura que vale defender:** o LLM **não decide disponibilidade
nem preço**. Ele interpreta intenção e preenche slots; quem responde "tem horário
quinta às 15h" é sempre a API. O modelo nunca inventa dado de negócio porque nunca
é ele quem tem o dado. Isso vai no README — é a primeira coisa que um entrevistador
sênior vai querer ouvir.

Registrada em [ADR 0001](adr/0001-llm-nao-e-fonte-de-verdade-de-negocio.md).

---

## 3. Stack

Proposta, com o critério ao lado. Trocar é permitido; manter o critério, não.
Nada aqui está decidido — cada escolha vira ADR quando for feita.

| Camada | Escolha proposta | Por quê |
|---|---|---|
| Orquestrador | **Node.js + TypeScript**, escrito à mão | Streaming de áudio é I/O puro, e casa com o AgendaFácil (mesmo ecossistema). Framework pronto de agente de voz entrega mais rápido e **prova menos** — o ponto do projeto é mostrar que sei montar o loop. |
| Transporte | **WebRTC no navegador** (principal) + telefonia (secundário) | Ver seção 4. |
| VAD | Silero VAD ou WebRTC VAD | Detecção de fim de fala é o que define a sensação de latência. |
| STT | Deepgram ou AssemblyAI streaming; alternativa local: `faster-whisper` | Precisa ser **streaming**, com resultados parciais. Whisper batch mata a experiência. Testar qualidade em pt-BR com sotaque — é onde a maioria das demos quebra. |
| LLM | Modelo rápido e barato com tool calling nativo | Latência importa mais que capacidade aqui. O modelo só interpreta e chama ferramenta. Conferir os modelos e preços atuais na hora de decidir. |
| TTS | ElevenLabs (melhor pt-BR) ou Piper local (grátis, aceitável) | Precisa suportar streaming, senão o áudio inteiro vira latência. |
| Ferramentas | API pública do AgendaFácil | Já existe. |
| Observabilidade | Traces próprios em Postgres/SQLite + dashboard simples | Ver seção 6 — é o diferencial. |

---

## 4. A decisão de produto que mais importa

**Priorizar o demo no navegador, não o telefone.**

Parece menos impressionante, mas: um recrutador em São Paulo, ou um recrutador de
fora do Brasil, **não vai discar um número brasileiro** para testar o projeto. Vai
clicar num link, falar dez segundos e fechar. Se a porta de entrada for um número
de telefone, o projeto tem taxa de uso próxima de zero — e projeto que ninguém abre
não prova nada.

1. **Camada de transporte abstrata desde o dia 1.** `AudioTransport` como interface;
   WebRTC e SIP são implementações. É bom design *e* rende conversa em entrevista.
2. **Entregar primeiro o WebRTC**, com um botão "falar com o agente" na página do
   projeto.
3. **Depois plugar telefonia** e gravar um vídeo de 40 segundos de uma ligação real.
   O vídeo entra no README e no LinkedIn — prova telefonia sem exigir que ninguém ligue.

Registrada em [ADR 0002](adr/0002-transporte-de-audio-abstrato.md).

---

## 5. Limites de origem

Movido para `AGENTS.md`, regra 5. Resumo: projeto escrito do zero em máquina e conta
pessoais; nada reaproveitado de trabalho contratado; domínio deliberadamente distinto
(barbearia e salão); zero menção a empregador, cliente ou setor de origem em qualquer
arquivo público.

---

## 6. O que separa isto de mais uma demo

Estes seis itens **são** o projeto. Sem eles, sobra um tutorial bonito.

### 6.1 Orçamento de latência medido e publicado

Voz é um problema de latência antes de ser um problema de IA. Acima de ~1,5 s de
silêncio a pessoa acha que caiu a ligação. Instrumentar cada etapa e publicar a
tabela no README:

```
fim da fala detectado (VAD)      →  transcrição final     :  __ ms
transcrição final                →  1º token do LLM       :  __ ms
1º token                         →  1º chunk de áudio TTS :  __ ms
                                                    p50 / p95 total
```

Depois otimizar e mostrar o antes/depois. **Um gráfico de p95 caindo de 2,1 s para
900 ms é a coisa mais persuasiva que pode entrar neste repositório** — e é métrica
própria, verificável.

### 6.2 Suíte de avaliação rodando em CI

Quase ninguém faz, e é o item mais sênior da lista. 25 a 40 conversas de teste, em
áudio ou em texto sintetizado:

- caminho feliz ("quero cortar cabelo quinta de tarde")
- ambiguidade ("quinta que vem" — qual quinta?)
- correção no meio ("não, sexta, não quinta")
- horário indisponível → agente precisa oferecer alternativa
- fora de escopo ("vocês vendem pomada?")
- ruído e sotaque
- usuário desiste no meio
- tentativa de agendar duas vezes

Cada caso declara o resultado esperado: qual ferramenta deveria ser chamada, com
quais argumentos, e se o agendamento deveria existir no fim. Rodar no CI a cada
commit e publicar a taxa de aprovação. Quando o prompt mudar, a suíte diz se
melhorou ou quebrou — que é exatamente o argumento de tratar agente como software,
não como adivinhação.

### 6.3 Idempotência na ação com efeito colateral

Agendar duas vezes é o bug clássico. Chave de idempotência derivada de
(telefone + serviço + horário), verificação antes da escrita, e comportamento
definido para reentrega.

### 6.4 Confirmação antes de escrever

O agente repete o que entendeu e espera confirmação explícita antes de criar o
agendamento. Parece detalhe de UX; é decisão de segurança de sistema autônomo, e é
o que separa quem já colocou agente em produção de quem leu sobre.

### 6.5 Degradação em vez de queda

STT falhou, LLM estourou timeout, API fora do ar: cada caso tem caminho definido —
repetir a pergunta, oferecer callback, encerrar com elegância. Nunca silêncio, nunca
stack trace no áudio.

### 6.6 Trace completo por conversa

Cada ligação gera: transcrição, estados percorridos, ferramentas chamadas com
argumentos, latências por etapa e custo estimado. Uma tela simples listando
conversas e permitindo abrir uma. Isso responde "como você depura um agente?" —
pergunta certa em qualquer entrevista da área — mostrando, em vez de explicando.

---

## 7. Faseamento

Escopo pensado para caber ao lado de um trabalho de tempo integral.

**Fase 1 — o loop, em texto (1 a 2 fins de semana)**
Orquestrador, máquina de estados, tool calling contra a API do AgendaFácil,
confirmação e idempotência. Sem áudio nenhum. Se a lógica não estiver certa em
texto, áudio só vai esconder o problema.
*Entregável: agendamento criado de verdade a partir de uma conversa digitada.*

**Fase 2 — voz no navegador (2 a 3 fins de semana)**
VAD, STT streaming, TTS streaming, interrupção (barge-in), instrumentação de
latência. Página pública com o botão de falar.
*Entregável: link que qualquer pessoa abre e usa.*

**Fase 3 — o que prova senioridade (2 fins de semana)**
Suíte de avaliação no CI, dashboard de traces, otimização de latência com
antes/depois documentado, README no formato de case study (contexto → decisões
difíceis → custo assumido).
*Entregável: os números.*

**Fase 4 — opcional, alto retorno de imagem**
Telefonia real via SIP/Twilio e um vídeo curto de ligação. Vale o esforço quando as
fases 1–3 estiverem fechadas.

Se der para fazer só uma coisa: **fase 1 + fase 3**. Um agente de texto com suíte de
avaliação e traces prova mais engenharia que um agente de voz sem nada disso.

---

## 8. Custo

Modelar por minuto de conversa, porque é assim que se raciocina em produção:
`STT + LLM (entrada/saída) + TTS + telefonia`. TTS e telefonia costumam dominar;
LLM, com modelo pequeno, costuma ser a menor parcela.

Para manter perto de zero durante o desenvolvimento: STT local (`faster-whisper`) e
TTS local (Piper). Subir para serviço pago só na versão pública, com limite de
duração e de sessões por dia na demo — o que, aliás, é mais um detalhe que mostra
maturidade operacional.

Conferir os preços atuais de cada provedor antes de publicar; eles mudam com
frequência. E **publicar o custo por conversa medido no README** — métrica que
praticamente nenhum projeto de portfólio traz.

---

## 9. O que isso destrava

Depois da Fase 3, passam a existir números próprios e verificáveis:

- latência p50 e p95 de resposta do agente
- taxa de aprovação da suíte de avaliação, com número de casos
- taxa de conclusão de tarefa (conversas que terminaram em agendamento válido)
- custo por conversa

Resolve, ao mesmo tempo, as duas maiores fraquezas do material de carreira: a
ausência de métricas e a impossibilidade de verificar experiência com agentes. E
resolve **sem depender de autorização, referência ou confirmação de ninguém**.
