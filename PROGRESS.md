# Progresso

Diário do projeto. **Mais recente no topo.** Uma entrada por sessão de trabalho
que mudou alguma coisa — não existe mudança pequena demais para registrar.

Formato de cada entrada:

```
## AAAA-MM-DD — título curto do que foi feito

**Feito:** o que existe agora que não existia antes.
**Não funcionou:** o que foi tentado e falhou, e por quê. Não apague depois.
**Medido:** número obtido, com o método. Omitir a linha se não mediu nada.
**Aberto:** o que ficou pendente e qual é o próximo passo concreto.
```

A linha **Não funcionou** é a de maior valor. Caminho descartado sem registro
volta a ser tentado daqui a três semanas.

---

## 2026-08-05 — a suíte de avaliação, e um bug que ela expôs no orquestrador

**Feito:** a suíte de avaliação da ADR 0007, em `src/avaliacao/`, mais o script
`scripts/avaliar.ts`. Doze casos cobrindo o que o `plano.md` §6.2 lista: caminho
feliz, ambiguidade de data, correção no meio, dia fechado, antecedência mínima, fora
de escopo, desistência, tentativa de agendar duas vezes, telefone inválido.

- `tipos.ts` — caso, expectativa e o formato de gravação.
- `gravacao.ts` — `ModeloGravado` (camada 1) e `ModeloGravador` (camada 2), mais a
  assinatura que invalida gravação velha.
- `executor.ts` — roda um caso contra o duplo em memória, com relógio congelado.
- `casos.ts` — o catálogo.

Cada caso afirma **o que o agente fez** — qual ferramenta, com quais argumentos, e
quantos agendamentos existem no fim — nunca o texto que ele produziu. Um caso que
afirmasse texto quebraria na primeira vez que o modelo trocasse uma palavra.

**O relógio congelado não é conveniência, é requisito**, e por dois motivos que só
apareceram ao escrever: "quinta que vem" precisa resolver para a mesma data em toda
execução, e o prompt de sistema carrega a data de hoje — com o relógio solto, a
assinatura da gravação mudaria à meia-noite e toda gravação seria considerada
desatualizada no dia seguinte. Um teste existe só para fixar essa propriedade.

**Não funcionou — e o achado vale mais que o código:**

- O orquestrador degradava em **qualquer** exceção do modelo. Parecia certo: falha do
  provedor não pode derrubar a ligação (§6.5). Mas isso engolia também a
  `GravacaoDesatualizada` da suite — uma gravação velha virava "turno degradado" em
  vez de falha, e um caso que espera zero agendamentos **passaria** reproduzindo um
  diálogo que o modelo não produz mais. É exatamente o verde silencioso que a ADR
  0007 foi escrita para impedir, e a implementação da própria ADR o reintroduziu por
  outra porta. Corrigido: degrada só em `ErroModelo`; qualquer outra exceção sobe.
  Dois testes da suíte de avaliação pegaram isso, e um teste novo no orquestrador
  agora fixa a fronteira.
- A primeira versão do caso `telefone-invalido` afirmava a string exata do telefone
  que o modelo repassaria. Frágil: mandar com máscara ou só dígitos são as duas
  formas certas, porque a normalização é do agente. Passou a afirmar o estado final.

**Medido:** 74 casos de teste de unidade, todos passando; `tsc --noEmit` limpo. A
suíte de avaliação reprova 12 de 12 por gravação ausente, com código de saída 1 — que
é o comportamento correto enquanto não houver gravação.

**Aberto:**

1. **Gravar os doze casos** (`npm run avaliar -- --ao-vivo`). Precisa da chave da
   Anthropic. É a primeira coisa a fazer quando ela existir, e produz de uma vez o
   custo por conversa medido e a taxa de aprovação publicável.
2. Ligar a camada 1 no CI. Sem chave e sem rede, é só mais um passo do workflow.
3. Refazer a medição de latência das ferramentas com amostragem maior — pendência de
   duas sessões atrás, ainda aberta. Depende de subir o AgendaFácil local de novo.

## 2026-08-04 — o loop do agente, e o orçamento como restrição de arquitetura

**Feito:** a camada de conversa inteira, em `src/conversa/` — o loop que o
`plano.md` §3 diz que o projeto existe para mostrar escrito à mão.

- `tipos.ts` — contrato com o modelo, provedor-agnóstico.
- `ferramentas.ts` — as cinco ferramentas que o modelo enxerga e o despachante.
- `confirmacao.ts` — a guarda de confirmação em dois passos.
- `orquestrador.ts` — o laço fala → modelo → ferramentas → modelo.
- `claude.ts` — adaptador da API da Anthropic.
- `prompt.ts`, `modelo-roteirizado.ts` — prompt de sistema e duplo para teste.
- `src/cli.ts` — a conversa digitada, entregável da Fase 1.

ADRs 0006 (modelo e custo) e 0007 (suíte de avaliação em duas camadas).

**O orçamento entrou como restrição de projeto**, não como coisa a medir depois: o
teto declarado é de aproximadamente R$10 para o projeto inteiro. Isso muda uma
decisão de arquitetura, e não só a escolha de modelo.

A conta que importa não é a da conversa avulsa — é `casos × custo por conversa ×
execuções`. O §6.2 do plano pedia 25 a 40 casos de avaliação rodando no CI **a cada
commit**; algumas centenas de commits multiplicam o custo por conversa por cinco
mil. O item mais sênior do plano era também o que consumiria o orçamento inteiro.
Daí a ADR 0007: reprodução gravada a cada commit (custo zero, determinística),
execução ao vivo sob demanda (produz o número publicado e regrava).

**A guarda de confirmação é o pedaço que vale defender.** O §6.4 pede confirmação
explícita antes de escrever. Escrita no prompt, isso é uma sugestão que o modelo
cumpre quase sempre — e pula justamente nas conversas confusas, onde confirmar mais
importa. Aqui a ferramenta de escrita **não aceita os dados do agendamento**: aceita
só um comprovante emitido por `preparar_confirmacao`, e só a partir do turno
seguinte. Um comprovante emitido e resgatado no mesmo turno significa que o agente
leu a confirmação e respondeu a si mesmo; a guarda recusa. Três dos testes existem
só para provar que o caminho não é contornável.

**Não funcionou:**

- A primeira versão do prompt de sistema repetia a regra de confirmação em duas
  frases. Foi removida: dá a impressão de que o prompt é o que sustenta a regra, e
  prompt não sustenta regra — só a torna mais provável. A regra vive na guarda e nas
  descrições das ferramentas.
- Considerado inflar o prompt de sistema até 4096 tokens para ativar o cache de
  prompt do Haiku 4.5. Descartado: pagaria mais tokens do que economizaria, e
  pioraria o comportamento do modelo. O prefixo mínimo de cache **não acompanha a
  ordem de preço** — 4096 tokens no Haiku 4.5 contra 512 nos modelos maiores —, o
  que torna o modelo mais barato por token o que menos se beneficia de cache.
- O helper `montar` dos testes nasceu com um tipo condicional ilegível tentando
  derivar o roteiro da assinatura do modelo. `ConstructorParameters<typeof
  ModeloRoteirizado>[0]` faz o mesmo em uma linha.

**Medido:** 57 casos de teste, todos passando; `tsc --noEmit` limpo. Preço de tabela
do Haiku 4.5 nesta data: US$ 1 por milhão de tokens de entrada, US$ 5 de saída.

**Nenhum número de custo por conversa ainda.** O preço por token é fato de tabela; a
contagem de tokens por conversa não é, e não será até o CLI rodar contra o modelo de
verdade. O CLI já imprime a contagem real que o provedor devolve, por turno e no
total — é a matéria-prima da medição, não a medição.

**Aberto:**

1. **Nada rodou contra o modelo de verdade.** Não há `ANTHROPIC_API_KEY` no
   ambiente, e a chave e o orçamento são do dono do repositório. Até rodar, a camada
   `claude.ts` está verificada só por tipo — o adaptador nunca traduziu uma resposta
   real.
2. Escrever a suíte de avaliação da ADR 0007: os casos, o formato de gravação e o
   hash de prompt que invalida gravação velha.
3. Refazer a medição de latência das ferramentas com amostragem maior (pendência da
   sessão anterior, ainda aberta).

## 2026-08-04 — camada de ferramentas da Fase 1, e as três ADRs que a destravavam

**Feito:** mapeamento da API do AgendaFácil lendo o código dela, as três decisões
pendentes viraram ADR, e a camada de ferramentas está escrita e testada.

ADRs 0003 (contrato com a API), 0004 (stack) e 0005 (idempotência). O índice em
`docs/adr/README.md` foi atualizado e a lista de pendências agora só tem LLM,
STT/TTS e traces.

Código, em `src/agenda/`:

- `tipos.ts` — o vocabulário da camada. O formato bruto da API (`_id`, `name`,
  `nomeExibicao`, `horariosPorDia`) para na implementação HTTP e não sobe.
- `http.ts` — cliente contra o AgendaFácil: tradução, classificação de erro por
  status e cache da configuração.
- `memoria.ts` — duplo com as mesmas regras observáveis, e injeção de falha.
- `idempotencia.ts` — a política da ADR 0005.
- `registro.ts` — registro de intenções, em memória e em arquivo append-only.
- `telefone.ts`, `datas.ts` — normalização E.164 e datas no fuso da barbearia.

Stack conforme ADR 0004: Node 22 executando TypeScript direto, sem etapa de build.
`tsc` só verifica tipos; testes em `node:test`. Zero dependência de runtime.

**O que o mapeamento da API achou**, e que não estava previsto no plano:

1. `POST /schedule` exige `cfToken` do Cloudflare Turnstile — desafio de navegador
   que um processo server-side não produz. A escrita estava bloqueada. Resolvido
   sem tocar em produção: o `.env.example` do AgendaFácil já documenta a secret de
   teste da Cloudflare, que aprova qualquer token, e a Fase 1 roda local.
2. `POST /schedule` responde `{ success: true }`, sem id do evento, e não há
   leitura pública de agendamentos. O agente não tem como verificar o que
   escreveu. É a ADR 0005 inteira.
3. `/slots` é por profissional, por serviço e por dia — "quinta de tarde com
   qualquer um" vira N chamadas.
4. `[]` significa tanto "fechado" quanto "lotado". Desambiguado em
   `desambiguarVazio`, cruzando com `horariosPorDia`.

**Não funcionou:**

- `node --test tests/` falha com `MODULE_NOT_FOUND`: o executor trata o argumento
  como módulo, não como diretório a varrer. A descoberta automática de `node --test`,
  sem argumento, acha os `*.test.ts` sozinha. O script no `package.json` ficou assim.
- Primeira versão de `traduzirProfissional` usava o mesmo auxiliar de lista para
  `barbers` e para `serviceIds`. O auxiliar filtra objetos, e `serviceIds` é lista
  de strings — o vínculo entre profissional e serviço saía vazio, silenciosamente. O
  teste de tradução pegou. Virou `listaDeIds`, que aceita as duas formas, porque o
  Mongo serializa como string ou como objeto dependendo de a consulta popular ou não.
- Considerado e descartado tratar `409` no reenvio como confirmação. É o caminho
  confortável e está errado: `409` também acontece quando um terceiro pegou o slot, e
  os dois casos são indistinguíveis pela API. O motivo completo está na ADR 0005 —
  vale reler antes de propor isso de novo, porque a tentação volta.

**Verificado contra a API de verdade.** O AgendaFácil subiu local — MongoDB já
rodava como serviço, o banco é `agendamento_db_teste` e não produção, e há
profissionais com agenda Google conectada e token válido. A API foi iniciada com
`TURNSTILE_SECRET_KEY` da Cloudflare de teste passada por ambiente, sem alterar o
`.env` do outro repositório, porque o `dotenv` não sobrescreve variável já presente.

O teste de contrato (`tests/contrato.test.ts`) passou nos 6 casos. O mapeamento da
ADR 0003 deixou de ser leitura de código e passou a ser fato verificado, incluindo
que a rota pública não vaza `googleRefreshToken`.

**Medido:**

- 41 casos de unidade e 6 de contrato, todos passando; `tsc --noEmit` limpo.
- Latência da camada de ferramentas, com `scripts/medir-ferramentas.ts`, 12
  amostras por linha, contra a instância local, consultando o dia seguinte na
  Barbearia do Koala (2 profissionais com agenda conectada, serviço de 40 min):

  | chamada | p50 | p95 | máx |
  |---|---|---|---|
  | `/config` sem cache | 10 ms | 13 ms | 13 ms |
  | `/slots`, 1 profissional | 451 ms | 867 ms | 867 ms |
  | leque de 2 profissionais em paralelo | 441 ms | 853 ms | 853 ms |

  Ressalva de método: 12 amostras não sustentam um p95 — com essa contagem ele é
  praticamente o máximo observado. Serve como ordem de grandeza, não como número
  de publicação. Refazer com amostragem maior antes de entrar no README.

**O número contradisse a previsão, e não do jeito esperado.** A ADR 0003 supôs que
o custo estaria no leque de consultas, e declarou que passar de ~400 ms no p95
invalidaria consultar por profissional. O p95 está em 853 ms, acima do limite — mas
**o leque não é a causa**: dois profissionais em paralelo custam o mesmo que um
(441 ms contra 451 ms no p50). O custo é a latência de base do `/slots`, que
consulta o Google Agenda a cada chamada.

A consequência prática inverte a mitigação: uma rota agregada na API, que era a
saída prevista, não resolveria nada — o Google continuaria sendo consultado. O que
resolveria é cache de disponibilidade com validade curta, ou uma consulta única ao
Google cobrindo vários profissionais. Nenhuma das duas é decisão para tomar com 12
amostras e sem o resto do orçamento de latência existir.

**Aberto:**

1. Refazer a medição com amostragem maior e com os 3 profissionais da outra
   unidade, para saber se o leque continua grátis quando cresce. Só então decidir
   mitigação — e, se ela mudar a fronteira com a API, vira ADR.
2. Máquina de estados do turno, ferramentas expostas ao modelo e o laço de tool
   calling. É o resto da Fase 1, e precisa da ADR de LLM antes.
3. CLI de conversa digitada — o entregável declarado da Fase 1. O agendamento real
   já acontece; falta a conversa que o produz.

**A escrita foi exercida contra a API real.** `scripts/verificar-escrita.ts`, com
autorização explícita e a flag `--confirmo`, criou um agendamento de verdade na
agenda Google de um profissional do banco de teste. Ele cria **um** evento e prova
o resto por recusa:

| verificação | resultado |
|---|---|
| a API confirmou a primeira escrita | confirmado, não reaproveitado |
| o horário sumiu de `/slots` | 15 → 14 horários livres |
| reentrega com a mesma chave | respondeu do registro, sem segunda escrita |
| outro telefone no mesmo horário | recusado com `slot_ocupado` |
| escrita extra depois das recusas | nenhuma |

A terceira linha é a que sustenta a ADR 0005: a chave era **outra**, então o
registro local não barrou nada — quem recusou foi a revalidação do servidor contra
o Google. É exatamente a camada em que a política de reenvio se apoia, e agora está
confirmada em vez de suposta. O registro em arquivo também foi exercido, gravando
em `local/`.

Com isso, "agendamento criado de verdade a partir do agente" deixou de ser
hipótese. O entregável da Fase 1 pede que ele venha de uma conversa digitada, o que
ainda não existe — mas a metade difícil, a que tem efeito colateral irreversível,
está funcionando e verificada.

## 2026-08-04 — repositório criado

**Feito:** estrutura inicial do projeto — `README.md`, `AGENTS.md`, `CLAUDE.md`,
plano em `docs/plano.md`, `docs/adr/` com template e as duas decisões que o plano
já fixava (ADR 0001 e 0002), `.gitignore` e `.env.example`. Repositório Git
inicializado, sem commit. A análise contratual do plano original ficou fora deste
repositório de propósito — ele é público.

**Aberto:** nada de código ainda. Próximo passo é a Fase 1 do plano — o loop em
texto contra a API do AgendaFácil, sem áudio nenhum: máquina de estados, tool
calling, confirmação explícita e idempotência. Antes disso, decidir a stack
(`docs/plano.md` §3) e mapear os endpoints da API que o agente vai consumir,
o que provavelmente vira a ADR 0003.
