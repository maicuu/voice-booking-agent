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
